import { Hono } from "hono";
import { Connection, PublicKey, type Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { ReadOnlyWallet, Percentage } from "@orca-so/common-sdk";
import {
  WhirlpoolContext,
  buildWhirlpoolClient,
  increaseLiquidityQuoteByInputTokenWithParams,
  TokenExtensionUtil,
  PriceMath,
  TickUtil,
  MIN_TICK_INDEX,
  MAX_TICK_INDEX,
} from "@orca-so/whirlpools-sdk";

export const solanaLpRouter = new Hono();

let connection: Connection | null = null;
function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed");
  }
  return connection;
}

// Read-only context — never used to sign the real transaction (we only ever
// call tx.build(), never tx.buildAndExecute()). ReadOnlyWallet's publicKey is
// set to the connected user's real pubkey purely so the built transaction's
// feePayer slot matches what their wallet will actually sign client-side.
function getContext(ownerPubkey: PublicKey): WhirlpoolContext {
  return WhirlpoolContext.from(getConnection(), new ReadOnlyWallet(ownerPubkey));
}

function validateTicks(tickLower: number, tickUpper: number, tickSpacing: number): string | null {
  if (!Number.isInteger(tickLower) || !Number.isInteger(tickUpper)) return "tickLower/tickUpper must be integers";
  if (tickLower >= tickUpper) return "tickLower must be less than tickUpper";
  if (tickLower < MIN_TICK_INDEX || tickUpper > MAX_TICK_INDEX) return `Ticks must be within [${MIN_TICK_INDEX}, ${MAX_TICK_INDEX}]`;
  if (!TickUtil.isTickInitializable(tickLower, tickSpacing) || !TickUtil.isTickInitializable(tickUpper, tickSpacing)) {
    return `Ticks must be initializable for tickSpacing (${tickSpacing})`;
  }
  return null;
}

// ── GET /solana-lp/quote — read-only liquidity-math preview, never returns a transaction ──
solanaLpRouter.get("/quote", async (c) => {
  const whirlpoolAddress = c.req.query("whirlpoolAddress");
  const tickLower = Number(c.req.query("tickLower"));
  const tickUpper = Number(c.req.query("tickUpper"));
  const amountARaw = c.req.query("amountA");
  const amountBRaw = c.req.query("amountB");

  if (!whirlpoolAddress || Number.isNaN(tickLower) || Number.isNaN(tickUpper)) {
    return c.json({ error: "Missing or invalid whirlpoolAddress/tickLower/tickUpper" }, 400);
  }

  let whirlpoolPubkey: PublicKey;
  try {
    whirlpoolPubkey = new PublicKey(whirlpoolAddress);
  } catch {
    return c.json({ error: "Invalid whirlpoolAddress" }, 400);
  }

  try {
    const ctx = getContext(PublicKey.default);
    const client = buildWhirlpoolClient(ctx);
    const whirlpool = await client.getPool(whirlpoolPubkey);
    const data = whirlpool.getData();

    const tickError = validateTicks(tickLower, tickUpper, data.tickSpacing);
    if (tickError) return c.json({ error: tickError }, 400);

    let tokenEstA = "0";
    let tokenEstB = "0";
    let liquidityEstimate = "0";

    if (amountARaw || amountBRaw) {
      const tokenExtensionCtx = await TokenExtensionUtil.buildTokenExtensionContext(ctx.fetcher, data);
      const quote = increaseLiquidityQuoteByInputTokenWithParams({
        inputTokenAmount: new BN(amountARaw ?? amountBRaw!),
        inputTokenMint: amountARaw ? data.tokenMintA : data.tokenMintB,
        tokenMintA: data.tokenMintA,
        tokenMintB: data.tokenMintB,
        tickCurrentIndex: data.tickCurrentIndex,
        sqrtPrice: data.sqrtPrice,
        tickLowerIndex: tickLower,
        tickUpperIndex: tickUpper,
        tokenExtensionCtx,
        slippageTolerance: Percentage.fromFraction(50, 10_000),
      });
      tokenEstA = quote.tokenEstA.toString();
      tokenEstB = quote.tokenEstB.toString();
      liquidityEstimate = quote.liquidityAmount.toString();
    }
    // else: neither amount supplied — "probe" call used only to learn currentTick/sqrtPrice
    // for client-side range-preset tick math, before the user has typed anything.

    return c.json({
      tokenEstA, tokenEstB, liquidityEstimate,
      currentTick: data.tickCurrentIndex,
      sqrtPrice: data.sqrtPrice.toString(),
      tickSpacing: data.tickSpacing,
      decimalsA: whirlpool.getTokenAInfo().decimals,
      decimalsB: whirlpool.getTokenBInfo().decimals,
    });
  } catch (err) {
    return c.json({ error: "Liquidity quote failed", detail: err instanceof Error ? err.message : String(err) }, 502);
  }
});

interface BuildSolanaLpBody {
  whirlpoolAddress: string;
  tickLower: number;
  tickUpper: number;
  amountA: string;
  amountB: string;
  owner: string;
  slippageBps?: number;
}

// ── POST /solana-lp/build — encode an openPosition transaction, partial-signed ──
// only with the freshly generated position-mint keypair (never the user's key).
// The user's own signature is added client-side by their connected wallet.
solanaLpRouter.post("/build", async (c) => {
  const body = await c.req.json<Partial<BuildSolanaLpBody>>().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const { whirlpoolAddress, tickLower, tickUpper, amountA, amountB, owner, slippageBps } = body;

  if (!whirlpoolAddress || tickLower === undefined || tickUpper === undefined || !amountA || !amountB || !owner) {
    return c.json({ error: "Missing whirlpoolAddress/tickLower/tickUpper/amountA/amountB/owner" }, 400);
  }

  let whirlpoolPubkey: PublicKey;
  let ownerPubkey: PublicKey;
  try {
    whirlpoolPubkey = new PublicKey(whirlpoolAddress);
    ownerPubkey = new PublicKey(owner);
  } catch {
    return c.json({ error: "Invalid whirlpoolAddress or owner address" }, 400);
  }

  try {
    new BN(amountA);
    new BN(amountB);
  } catch {
    return c.json({ error: "amountA/amountB must be integer strings" }, 400);
  }

  try {
    const ctx = getContext(ownerPubkey);
    const client = buildWhirlpoolClient(ctx);
    const whirlpool = await client.getPool(whirlpoolPubkey);
    const data = whirlpool.getData();

    const tickError = validateTicks(tickLower, tickUpper, data.tickSpacing);
    if (tickError) return c.json({ error: tickError }, 400);

    // Trust the client's final (post-auto-balance) amounts directly, same trust
    // boundary lp.ts's /build already uses for a client-supplied minAmountOut.
    const priceDeviation = Percentage.fromFraction(slippageBps ?? 100, 10_000);
    const { lowerBound: [minSqrtPrice], upperBound: [maxSqrtPrice] } = PriceMath.getSlippageBoundForSqrtPrice(data.sqrtPrice, priceDeviation);

    const { positionMint, tx } = await whirlpool.openPositionWithMetadata(tickLower, tickUpper, {
      tokenMaxA: new BN(amountA),
      tokenMaxB: new BN(amountB),
      minSqrtPrice,
      maxSqrtPrice,
    }, ownerPubkey, ownerPubkey);
    const payload = await tx.build({ maxSupportedTransactionVersion: "legacy", blockhashCommitment: "confirmed" });

    // maxSupportedTransactionVersion: "legacy" guarantees a classic Transaction,
    // never a VersionedTransaction — required for partialSign/serialize below
    // and for compatibility with the wallet adapter's v1-based sendTransaction.
    const transaction = payload.transaction as Transaction;

    // payload.signers is the ephemeral, freshly generated position-mint keypair —
    // safe to sign with server-side since it's not the user's key. The user's
    // own signature (feePayer slot) is still missing and gets added client-side.
    if (payload.signers.length > 0) {
      transaction.partialSign(...payload.signers);
    }
    const serialized = transaction.serialize({ requireAllSignatures: false });

    return c.json({
      transactionBase64: serialized.toString("base64"),
      positionMint: positionMint.toBase58(),
    });
  } catch (err) {
    return c.json({ error: "Build failed", detail: err instanceof Error ? err.message : String(err) }, 502);
  }
});
