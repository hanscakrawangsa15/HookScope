import { Hono } from "hono";
import { Connection, PublicKey, type Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import BN from "bn.js";
import { Raydium, TxVersion, Token, TokenAmount, Percent } from "@raydium-io/raydium-sdk-v2";

export const raydiumAmmLpRouter = new Hono();

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

// ── GET /raydium-amm-lp/quote — read-only liquidity-math preview, never returns a transaction ──
// Plain constant-product AMM — no tick range, just an auto-balanced two-token deposit.
raydiumAmmLpRouter.get("/quote", async (c) => {
  const poolId = c.req.query("poolId");
  const amountA = c.req.query("amountA");
  const amountB = c.req.query("amountB");

  if (!poolId || (!amountA && !amountB)) {
    return c.json({ error: "Missing poolId or amountA/amountB" }, 400);
  }

  try {
    const raydium = await getRaydium(PublicKey.default);
    const { poolInfo } = await raydium.liquidity.getPoolInfoFromRpc({ poolId });

    const baseIn = !!amountA;
    // computePairAmount takes a human-readable decimal amount string, not raw units —
    // verified directly against a live pool: amount: "1" on a WSOL/USDC pool returned
    // ~69 USDC, matching the pool's live price.
    const pair = raydium.liquidity.computePairAmount({
      poolInfo,
      amount: baseIn ? amountA! : amountB!,
      slippage: new Percent(0, 100),
      baseIn,
    });

    const tokenEstA = baseIn
      ? new BN(Math.round(Number(amountA) * 10 ** poolInfo.mintA.decimals)).toString()
      : pair.anotherAmount.raw.toString();
    const tokenEstB = baseIn
      ? pair.anotherAmount.raw.toString()
      : new BN(Math.round(Number(amountB) * 10 ** poolInfo.mintB.decimals)).toString();

    return c.json({
      tokenEstA,
      tokenEstB,
      decimalsA: poolInfo.mintA.decimals,
      decimalsB: poolInfo.mintB.decimals,
      price: poolInfo.price,
    });
  } catch (err) {
    return c.json({ error: "Liquidity quote failed", detail: err instanceof Error ? err.message : String(err) }, 502);
  }
});

interface BuildRaydiumAmmLpBody {
  poolId: string;
  amountA: string;
  amountB: string;
  owner: string;
  slippageBps?: number;
}

// ── POST /raydium-amm-lp/build — encode an addLiquidity transaction ──
// No ephemeral signers needed — AMM v4 LP mints to the owner's own ATA, not an NFT position.
raydiumAmmLpRouter.post("/build", async (c) => {
  const body = await c.req.json<Partial<BuildRaydiumAmmLpBody>>().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const { poolId, amountA, amountB, owner, slippageBps } = body;

  if (!poolId || !amountA || !amountB || !owner) {
    return c.json({ error: "Missing poolId/amountA/amountB/owner" }, 400);
  }

  let ownerPubkey: PublicKey;
  try {
    ownerPubkey = new PublicKey(owner);
  } catch {
    return c.json({ error: "Invalid owner address" }, 400);
  }

  let rawAmountA: BN;
  let rawAmountB: BN;
  try {
    rawAmountA = new BN(amountA);
    rawAmountB = new BN(amountB);
  } catch {
    return c.json({ error: "amountA/amountB must be integer strings" }, 400);
  }

  try {
    const raydium = await getRaydium(ownerPubkey);
    const { poolInfo, poolKeys } = await raydium.liquidity.getPoolInfoFromRpc({ poolId });

    // addLiquidity() has a pre-flight guard requiring at least one of the two
    // mints to already have an existing token account in the wallet — verified
    // directly against the installed SDK source (raydium/liquidity/liquidity.ts).
    // A genuinely fresh wallet (no token accounts at all) fails this guard even
    // though the rest of the flow (handleTokenAccount) would happily create
    // both ATAs. Pre-register synthetic empty-balance entries via the SDK's own
    // public account.updateTokenAccount() so the guard passes; the real ATAs
    // are then created on-chain by handleTokenAccount as normal.
    const real = await raydium.account.fetchWalletTokenAccounts();
    const extraTokenAccounts = [];
    const extraRawInfos = [];
    for (const mintInfo of [poolInfo.mintA, poolInfo.mintB]) {
      const hasExisting = real.tokenAccountRawInfos.some((i) => i.accountInfo.mint.toBase58() === mintInfo.address);
      if (hasExisting) continue;
      const mint = new PublicKey(mintInfo.address);
      const tokenProgram = new PublicKey(mintInfo.programId);
      const ata = getAssociatedTokenAddressSync(mint, ownerPubkey, true, tokenProgram);
      extraTokenAccounts.push({ publicKey: ata, mint, isAssociated: true, amount: new BN(0), isNative: false, programId: tokenProgram });
      extraRawInfos.push({
        programId: tokenProgram,
        pubkey: ata,
        accountInfo: {
          mint, owner: ownerPubkey, amount: new BN(0),
          delegateOption: 0, delegate: PublicKey.default,
          state: 1, isNativeOption: 0, isNative: new BN(0),
          delegatedAmount: new BN(0), closeAuthorityOption: 0, closeAuthority: PublicKey.default,
        },
      });
    }
    if (extraRawInfos.length > 0) {
      raydium.account.updateTokenAccount({
        tokenAccounts: [...real.tokenAccounts, ...extraTokenAccounts],
        tokenAccountRawInfos: [...real.tokenAccountRawInfos, ...extraRawInfos],
      });
    }

    const tokenA = new Token({ mint: poolInfo.mintA.address, decimals: poolInfo.mintA.decimals, symbol: poolInfo.mintA.symbol });
    const tokenB = new Token({ mint: poolInfo.mintB.address, decimals: poolInfo.mintB.decimals, symbol: poolInfo.mintB.symbol });
    const amountInA = new TokenAmount(tokenA, rawAmountA, true);
    const amountInB = new TokenAmount(tokenB, rawAmountB, true);

    // Trust the client's final (post-auto-balance) amounts directly, same trust
    // boundary as the Raydium CLMM LP route — amountB is exact, otherAmountMin
    // deflates it by slippageBps as the floor the pool will accept.
    const slippageBpsVal = slippageBps ?? 100;
    const otherAmountMinRaw = rawAmountB.mul(new BN(10_000 - slippageBpsVal)).div(new BN(10_000));
    const otherAmountMin = new TokenAmount(tokenB, otherAmountMinRaw, true);

    const result = await raydium.liquidity.addLiquidity({
      poolInfo,
      poolKeys,
      amountInA,
      amountInB,
      otherAmountMin,
      fixedSide: "a",
      config: { checkCreateATAOwner: true },
      txVersion: TxVersion.LEGACY,
    });

    const transaction = result.transaction as Transaction;
    const { blockhash } = await getConnection().getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    if (result.signers.length > 0) {
      transaction.partialSign(...result.signers);
    }
    const serialized = transaction.serialize({ requireAllSignatures: false });

    return c.json({ transactionBase64: serialized.toString("base64") });
  } catch (err) {
    return c.json({ error: "Build failed", detail: err instanceof Error ? err.message : String(err) }, 502);
  }
});
