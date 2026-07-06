import { Hono } from "hono";
import { Connection, PublicKey, type Transaction } from "@solana/web3.js";
import BN from "bn.js";
import {
  Raydium, TxVersion, swapInternal, getPdaExBitmapAccount, TickArrayBitmapExtensionLayout,
} from "@raydium-io/raydium-sdk-v2";

export const raydiumSwapRouter = new Hono();

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

// Runs the same on-chain swap simulation the Raydium SDK's own demo uses to
// derive `accounts`/`amountCalculated` ahead of building a real swap — every
// piece here (getSwapPoolInfo, getPdaExBitmapAccount, swapInternal) is a
// public SDK export, not an internal implementation detail.
async function simulateSwap(raydium: Raydium, poolId: string, zeroForOne: boolean, amountIn: BN) {
  const { poolInfo, rpcData, configInfo, tickArrays } = await raydium.clmm.getSwapPoolInfo(poolId, zeroForOne);
  const programId = new PublicKey(poolInfo.programId);
  const poolIdPub = new PublicKey(poolInfo.id);

  const tickArrayBitmapExtension = getPdaExBitmapAccount(programId, poolIdPub).publicKey;
  const exBitmapAccountInfo = await raydium.connection.getAccountInfo(tickArrayBitmapExtension);
  if (!exBitmapAccountInfo) throw new Error("Tick array bitmap extension account not found");

  const simulation = swapInternal({
    programId,
    poolId: poolIdPub,
    poolInfo: rpcData,
    tickArrays,
    configInfo,
    tickarrayBitmapExtension: TickArrayBitmapExtensionLayout.decode(exBitmapAccountInfo.data),
    amountSpecified: amountIn,
    sqrtPriceLimitX64: new BN(0),
    zeroForOne,
    isBaseInput: true,
    blockTimestamp: Math.floor(Date.now() / 1000),
    includeExtraTickArrays: true,
  });

  return { poolInfo, rpcData, simulation };
}

// ── GET /raydium-swap/quote — read-only swap preview, never returns a transaction ──
raydiumSwapRouter.get("/quote", async (c) => {
  const poolId = c.req.query("poolId");
  const inputMint = c.req.query("inputMint");
  const amountInRaw = c.req.query("amountIn");

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
    const { poolInfo: simplePoolInfo } = await raydium.clmm.getSimplePoolInfo(poolId);
    const zeroForOne = inputMint === simplePoolInfo.mintA.address;

    const { simulation } = await simulateSwap(raydium, poolId, zeroForOne, amountIn);

    return c.json({
      estimatedAmountIn: amountIn.toString(),
      estimatedAmountOut: simulation.amountCalculated.toString(),
      decimalsA: simplePoolInfo.mintA.decimals,
      decimalsB: simplePoolInfo.mintB.decimals,
    });
  } catch (err) {
    return c.json({ error: "Swap quote failed", detail: err instanceof Error ? err.message : String(err) }, 502);
  }
});

interface BuildRaydiumSwapBody {
  poolId: string;
  inputMint: string;
  amountIn: string;
  slippageBps?: number;
  owner: string;
}

// ── POST /raydium-swap/build — encode a swap transaction; the SDK bundles ──
// any ATA-creation instructions automatically. The user's own signature is
// added client-side by their connected wallet.
raydiumSwapRouter.post("/build", async (c) => {
  const body = await c.req.json<Partial<BuildRaydiumSwapBody>>().catch(() => null);
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
    const { poolInfo: simplePoolInfo } = await raydium.clmm.getSimplePoolInfo(poolId);
    const zeroForOne = inputMint === simplePoolInfo.mintA.address;

    // Re-run the simulation server-side from the live pool — never trust a
    // client-supplied amountOutMin, same trust boundary as the Orca swap route.
    const { poolInfo, rpcData, simulation } = await simulateSwap(raydium, poolId, zeroForOne, amountIn);
    const amountOutMin = simulation.amountCalculated.mul(new BN(10_000 - (slippageBps ?? 100))).div(new BN(10_000));

    const result = await raydium.clmm.swap({
      poolInfo,
      inputMint,
      amountIn,
      amountOutMin,
      observationId: rpcData.observationId,
      ownerInfo: { useSOLBalance: true },
      remainingAccounts: simulation.accounts,
      // Without this, the SDK requires the owner to already hold an ATA for
      // the output mint and throws instead of creating one.
      checkCreateATAOwner: true,
      txVersion: TxVersion.LEGACY,
    });

    const transaction = result.transaction as Transaction;
    // Raydium's legacy build() never sets recentBlockhash itself (only its
    // execute() path does, which we never call) — must fetch it ourselves.
    const { blockhash } = await raydium.connection.getLatestBlockhash("confirmed");
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
