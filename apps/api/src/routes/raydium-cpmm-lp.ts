import { Hono } from "hono";
import { Connection, PublicKey, type Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import BN from "bn.js";
import { Raydium, TxVersion, Percent } from "@raydium-io/raydium-sdk-v2";

const NATIVE_MINT_ADDRESS = "So11111111111111111111111111111111111111112";

export const raydiumCpmmLpRouter = new Hono();

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

// ── GET /raydium-cpmm-lp/quote — read-only liquidity-math preview, never returns a transaction ──
raydiumCpmmLpRouter.get("/quote", async (c) => {
  const poolId = c.req.query("poolId");
  const amountA = c.req.query("amountA");
  const amountB = c.req.query("amountB");

  if (!poolId || (!amountA && !amountB)) {
    return c.json({ error: "Missing poolId or amountA/amountB" }, 400);
  }

  try {
    const raydium = await getRaydium(PublicKey.default);
    const { poolInfo, rpcData } = await raydium.cpmm.getPoolInfoFromRpc(poolId);
    const epochInfo = await getConnection().getEpochInfo();

    const baseIn = !!amountA;
    const pair = raydium.cpmm.computePairAmount({
      poolInfo,
      baseReserve: rpcData.baseReserve,
      quoteReserve: rpcData.quoteReserve,
      amount: baseIn ? amountA! : amountB!,
      slippage: new Percent(0, 100),
      epochInfo,
      baseIn,
    });

    const tokenEstA = baseIn
      ? new BN(Math.round(Number(amountA) * 10 ** poolInfo.mintA.decimals)).toString()
      : pair.anotherAmount.amount.toString();
    const tokenEstB = baseIn
      ? pair.anotherAmount.amount.toString()
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

interface BuildRaydiumCpmmLpBody {
  poolId: string;
  amountA: string;
  amountB: string;
  owner: string;
  slippageBps?: number;
}

// ── POST /raydium-cpmm-lp/build — encode an addLiquidity transaction ──
// No ephemeral signers needed — CPMM LP mints to the owner's own ATA, not an NFT position.
raydiumCpmmLpRouter.post("/build", async (c) => {
  const body = await c.req.json<Partial<BuildRaydiumCpmmLpBody>>().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const { poolId, amountA, owner, slippageBps } = body;

  if (!poolId || !amountA || !owner) {
    return c.json({ error: "Missing poolId/amountA/owner" }, 400);
  }

  let ownerPubkey: PublicKey;
  try {
    ownerPubkey = new PublicKey(owner);
  } catch {
    return c.json({ error: "Invalid owner address" }, 400);
  }

  let inputAmount: BN;
  try {
    inputAmount = new BN(amountA);
  } catch {
    return c.json({ error: "amountA must an integer string" }, 400);
  }

  try {
    const raydium = await getRaydium(ownerPubkey);
    const { poolInfo, poolKeys } = await raydium.cpmm.getPoolInfoFromRpc(poolId);

    // CPMM's addLiquidity (unlike AMM v4's) only auto-creates an ATA for the
    // SOL-wrapped side — verified directly against the installed SDK source
    // (raydium/cpmm/cpmm.ts): the non-SOL "other" side's createInfo stays
    // undefined whenever its amount is non-zero, so getOrCreateTokenAccount
    // returns {} and the deposit instruction ends up with an undefined account
    // key for any wallet that has never held that mint. Fix: pre-create the
    // missing ATA ourselves and register it in the SDK's own account cache
    // (account.updateTokenAccount is the public, sanctioned way to do this —
    // it's the same path apps use when they fetch wallet balances themselves).
    const real = await raydium.account.fetchWalletTokenAccounts();
    const preInstructions = [];
    const extraTokenAccounts = [];
    const extraRawInfos = [];

    for (const mintInfo of [poolInfo.mintA, poolInfo.mintB]) {
      if (mintInfo.address === NATIVE_MINT_ADDRESS) continue;
      const hasExisting = real.tokenAccountRawInfos.some((i) => i.accountInfo.mint.toBase58() === mintInfo.address);
      if (hasExisting) continue;

      const mint = new PublicKey(mintInfo.address);
      const tokenProgram = new PublicKey(mintInfo.programId);
      const ata = getAssociatedTokenAddressSync(mint, ownerPubkey, true, tokenProgram);

      preInstructions.push(createAssociatedTokenAccountIdempotentInstruction(ownerPubkey, ata, ownerPubkey, mint, tokenProgram));
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

    const result = await raydium.cpmm.addLiquidity({
      poolInfo,
      poolKeys,
      inputAmount,
      baseIn: true,
      slippage: new Percent(slippageBps ?? 100, 10_000),
      config: { checkCreateATAOwner: true },
      txVersion: TxVersion.LEGACY,
    });

    const transaction = result.transaction as Transaction;
    if (preInstructions.length > 0) {
      transaction.instructions.unshift(...preInstructions);
    }
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
