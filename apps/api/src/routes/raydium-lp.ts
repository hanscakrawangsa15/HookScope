import { Hono } from "hono";
import { Connection, PublicKey, type Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { Raydium, TxVersion, LiquidityMathUtil, TickUtil, MIN_TICK, MAX_TICK } from "@raydium-io/raydium-sdk-v2";

export const raydiumLpRouter = new Hono();

let connection: Connection | null = null;
function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed");
  }
  return connection;
}

function getRaydium(ownerPubkey: PublicKey) {
  return Raydium.load({ connection: getConnection(), owner: ownerPubkey, disableLoadToken: true });
}

function validateTicks(tickLower: number, tickUpper: number, tickSpacing: number): string | null {
  if (!Number.isInteger(tickLower) || !Number.isInteger(tickUpper)) return "tickLower/tickUpper must be integers";
  if (tickLower >= tickUpper) return "tickLower must be less than tickUpper";
  if (tickLower < MIN_TICK || tickUpper > MAX_TICK) return `Ticks must be within [${MIN_TICK}, ${MAX_TICK}]`;
  if (tickLower % tickSpacing !== 0 || tickUpper % tickSpacing !== 0) {
    return `Ticks must be a multiple of tickSpacing (${tickSpacing})`;
  }
  return null;
}

// ── GET /raydium-lp/quote — read-only liquidity-math preview, never returns a transaction ──
raydiumLpRouter.get("/quote", async (c) => {
  const poolId = c.req.query("poolId");
  const tickLower = Number(c.req.query("tickLower"));
  const tickUpper = Number(c.req.query("tickUpper"));
  const amountARaw = c.req.query("amountA");
  const amountBRaw = c.req.query("amountB");

  if (!poolId || Number.isNaN(tickLower) || Number.isNaN(tickUpper)) {
    return c.json({ error: "Missing or invalid poolId/tickLower/tickUpper" }, 400);
  }

  try {
    const raydium = await getRaydium(PublicKey.default);
    const { poolInfo, rpcData } = await raydium.clmm.getSimplePoolInfo(poolId);

    const tickSpacing = poolInfo.config.tickSpacing;
    const tickError = validateTicks(tickLower, tickUpper, tickSpacing);
    if (tickError) return c.json({ error: tickError }, 400);

    let tokenEstA = "0";
    let tokenEstB = "0";
    let liquidityEstimate = "0";

    if (amountARaw || amountBRaw) {
      const sqrtPriceCurrentX64 = rpcData.sqrtPriceX64;
      const sqrtPriceLowerX64 = TickUtil.getSqrtPriceAtTick(tickLower);
      const sqrtPriceUpperX64 = TickUtil.getSqrtPriceAtTick(tickUpper);

      // Not using LiquidityMathUtil.getLiquidityAndAmountsFromAmount() here —
      // verified directly (scratch script against this same SDK version) that
      // its final getAmountsForLiquidity() call passes the raw input amount
      // instead of the liquidity it just computed, producing wildly wrong
      // amounts. Computing liquidity then amounts as two separate, individually
      // correct calls avoids that bug.
      const liquidity = amountARaw
        ? (sqrtPriceCurrentX64.gte(sqrtPriceUpperX64)
          ? new BN(0)
          : LiquidityMathUtil.getLiquidityFromAmountA(BN.max(sqrtPriceCurrentX64, sqrtPriceLowerX64), sqrtPriceUpperX64, new BN(amountARaw)))
        : (sqrtPriceCurrentX64.lte(sqrtPriceLowerX64)
          ? new BN(0)
          : LiquidityMathUtil.getLiquidityFromAmountB(sqrtPriceLowerX64, BN.min(sqrtPriceCurrentX64, sqrtPriceUpperX64), new BN(amountBRaw!)));
      const amounts = LiquidityMathUtil.getAmountsForLiquidity(sqrtPriceCurrentX64, sqrtPriceLowerX64, sqrtPriceUpperX64, liquidity, true);

      tokenEstA = amounts.amountA.toString();
      tokenEstB = amounts.amountB.toString();
      liquidityEstimate = liquidity.toString();
    }
    // else: neither amount supplied — "probe" call used only to learn currentTick/sqrtPrice
    // for client-side range-preset tick math, before the user has typed anything.

    return c.json({
      tokenEstA, tokenEstB, liquidityEstimate,
      currentTick: rpcData.tickCurrent,
      sqrtPrice: rpcData.sqrtPriceX64.toString(),
      tickSpacing,
      decimalsA: poolInfo.mintA.decimals,
      decimalsB: poolInfo.mintB.decimals,
    });
  } catch (err) {
    return c.json({ error: "Liquidity quote failed", detail: err instanceof Error ? err.message : String(err) }, 502);
  }
});

interface BuildRaydiumLpBody {
  poolId: string;
  tickLower: number;
  tickUpper: number;
  amountA: string;
  amountB: string;
  owner: string;
  slippageBps?: number;
}

// ── POST /raydium-lp/build — encode an openPosition transaction, partial-signed ──
// only with the freshly generated position-NFT keypair (never the user's key).
// The user's own signature is added client-side by their connected wallet.
raydiumLpRouter.post("/build", async (c) => {
  const body = await c.req.json<Partial<BuildRaydiumLpBody>>().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const { poolId, tickLower, tickUpper, amountA, amountB, owner, slippageBps } = body;

  if (!poolId || tickLower === undefined || tickUpper === undefined || !amountA || !amountB || !owner) {
    return c.json({ error: "Missing poolId/tickLower/tickUpper/amountA/amountB/owner" }, 400);
  }

  let ownerPubkey: PublicKey;
  try {
    ownerPubkey = new PublicKey(owner);
  } catch {
    return c.json({ error: "Invalid owner address" }, 400);
  }

  let baseAmount: BN;
  let otherAmount: BN;
  try {
    baseAmount = new BN(amountA);
    otherAmount = new BN(amountB);
  } catch {
    return c.json({ error: "amountA/amountB must be integer strings" }, 400);
  }

  try {
    const raydium = await getRaydium(ownerPubkey);
    const { poolInfo } = await raydium.clmm.getSimplePoolInfo(poolId);

    const tickSpacing = poolInfo.config.tickSpacing;
    const tickError = validateTicks(tickLower, tickUpper, tickSpacing);
    if (tickError) return c.json({ error: tickError }, 400);

    // Trust the client's final (post-auto-balance) amounts directly, same trust
    // boundary the Orca LP /build route already uses — amountA is exact (the
    // "base" side), amountB is inflated by slippageBps as the max the position
    // will accept of the other token.
    const slippageBpsVal = slippageBps ?? 100;
    const otherAmountMax = otherAmount.mul(new BN(10_000 + slippageBpsVal)).div(new BN(10_000));

    const result = await raydium.clmm.openPositionFromBase({
      poolInfo,
      ownerInfo: { useSOLBalance: true },
      tickLower,
      tickUpper,
      base: "MintA",
      baseAmount,
      otherAmountMax,
      // Without this, the SDK requires the owner to already hold an ATA for
      // each mint and throws "cannot found target token accounts" instead of
      // creating one — verified directly against a real pool during testing.
      checkCreateATAOwner: true,
      txVersion: TxVersion.LEGACY,
    });

    const transaction = result.transaction as Transaction;
    // Unlike Orca's TransactionBuilder.build(), Raydium's legacy build() never
    // sets recentBlockhash itself (only its execute() path does, which we
    // never call) — verified directly by hitting "Transaction recentBlockhash
    // required" during testing. Must fetch and assign it ourselves.
    const { blockhash } = await getConnection().getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    if (result.signers.length > 0) {
      transaction.partialSign(...result.signers);
    }
    const serialized = transaction.serialize({ requireAllSignatures: false });

    return c.json({
      transactionBase64: serialized.toString("base64"),
      positionMint: result.extInfo.nftMint.toBase58(),
    });
  } catch (err) {
    return c.json({ error: "Build failed", detail: err instanceof Error ? err.message : String(err) }, 502);
  }
});
