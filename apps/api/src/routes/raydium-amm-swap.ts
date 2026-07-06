import { Hono } from "hono";
import { Connection, PublicKey, type Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { Raydium, TxVersion } from "@raydium-io/raydium-sdk-v2";

export const raydiumAmmSwapRouter = new Hono();

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

// ── GET /raydium-amm-swap/quote — read-only swap preview, never returns a transaction ──
raydiumAmmSwapRouter.get("/quote", async (c) => {
  const poolId = c.req.query("poolId");
  const inputMint = c.req.query("inputMint");
  const amountInRaw = c.req.query("amountIn");
  const slippageBps = c.req.query("slippageBps");

  if (!poolId || !inputMint || !amountInRaw) {
    return c.json({ error: "Missing poolId/inputMint/amountIn" }, 400);
  }

  let amountIn: BN;
  try {
    amountIn = new BN(amountInRaw);
  } catch {
    return c.json({ error: "amountIn must be an integer string" }, 400);
  }

  try {
    const raydium = await getRaydium(PublicKey.default);
    const { poolInfo } = await raydium.liquidity.getPoolInfoFromRpc({ poolId });
    const mintOut = inputMint === poolInfo.mintA.address ? poolInfo.mintB.address : poolInfo.mintA.address;

    const out = raydium.liquidity.computeAmountOut({
      poolInfo,
      mintIn: inputMint,
      mintOut,
      amountIn,
      slippage: (Number(slippageBps) || 100) / 10_000,
    });

    return c.json({
      estimatedAmountIn: amountIn.toString(),
      estimatedAmountOut: out.amountOut.toString(),
      decimalsA: poolInfo.mintA.decimals,
      decimalsB: poolInfo.mintB.decimals,
    });
  } catch (err) {
    return c.json({ error: "Swap quote failed", detail: err instanceof Error ? err.message : String(err) }, 502);
  }
});

interface BuildRaydiumAmmSwapBody {
  poolId: string;
  inputMint: string;
  amountIn: string;
  slippageBps?: number;
  owner: string;
}

// ── POST /raydium-amm-swap/build — encode a swap transaction; the SDK bundles ──
// any ATA-creation instructions automatically. The user's own signature is
// added client-side by their connected wallet.
raydiumAmmSwapRouter.post("/build", async (c) => {
  const body = await c.req.json<Partial<BuildRaydiumAmmSwapBody>>().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const { poolId, inputMint, amountIn: amountInRaw, slippageBps, owner } = body;

  if (!poolId || !inputMint || !amountInRaw || !owner) {
    return c.json({ error: "Missing poolId/inputMint/amountIn/owner" }, 400);
  }

  let ownerPubkey: PublicKey;
  try {
    ownerPubkey = new PublicKey(owner);
  } catch {
    return c.json({ error: "Invalid owner address" }, 400);
  }

  let amountIn: BN;
  try {
    amountIn = new BN(amountInRaw);
  } catch {
    return c.json({ error: "amountIn must be an integer string" }, 400);
  }

  try {
    const raydium = await getRaydium(ownerPubkey);
    const { poolInfo, poolKeys } = await raydium.liquidity.getPoolInfoFromRpc({ poolId });
    const mintOut = inputMint === poolInfo.mintA.address ? poolInfo.mintB.address : poolInfo.mintA.address;

    // Re-run the simulation server-side from the live pool — never trust a
    // client-supplied amountOutMin, same trust boundary as the CLMM swap route.
    const out = raydium.liquidity.computeAmountOut({
      poolInfo,
      mintIn: inputMint,
      mintOut,
      amountIn,
      slippage: (slippageBps ?? 100) / 10_000,
    });

    const result = await raydium.liquidity.swap({
      poolInfo,
      poolKeys,
      amountIn,
      amountOut: out.minAmountOut,
      inputMint,
      fixedSide: "in",
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
