import { Hono } from "hono";
import { Connection, PublicKey, type Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { ReadOnlyWallet, Percentage } from "@orca-so/common-sdk";
import { WhirlpoolContext, buildWhirlpoolClient, swapQuoteByInputToken } from "@orca-so/whirlpools-sdk";

export const orcaSwapRouter = new Hono();

let connection: Connection | null = null;
function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed");
  }
  return connection;
}

function getContext(ownerPubkey: PublicKey): WhirlpoolContext {
  return WhirlpoolContext.from(getConnection(), new ReadOnlyWallet(ownerPubkey));
}

// ── GET /orca-swap/quote — read-only swap preview, never returns a transaction ──
orcaSwapRouter.get("/quote", async (c) => {
  const whirlpoolAddress = c.req.query("whirlpoolAddress");
  const inputMint = c.req.query("inputMint");
  const amountInRaw = c.req.query("amountIn");
  const slippageBps = Number(c.req.query("slippageBps") ?? "100");

  if (!whirlpoolAddress || !inputMint || !amountInRaw) {
    return c.json({ error: "Missing whirlpoolAddress/inputMint/amountIn" }, 400);
  }

  let whirlpoolPubkey: PublicKey;
  let inputMintPubkey: PublicKey;
  try {
    whirlpoolPubkey = new PublicKey(whirlpoolAddress);
    inputMintPubkey = new PublicKey(inputMint);
  } catch {
    return c.json({ error: "Invalid whirlpoolAddress or inputMint" }, 400);
  }

  let amountIn: BN;
  try {
    amountIn = new BN(amountInRaw);
  } catch {
    return c.json({ error: "amountIn must be an integer string" }, 400);
  }

  try {
    const ctx = getContext(PublicKey.default);
    const client = buildWhirlpoolClient(ctx);
    const whirlpool = await client.getPool(whirlpoolPubkey);

    const quote = await swapQuoteByInputToken(
      whirlpool,
      inputMintPubkey,
      amountIn,
      Percentage.fromFraction(slippageBps, 10_000),
      ctx.program.programId,
      ctx.fetcher
    );

    return c.json({
      estimatedAmountIn: quote.estimatedAmountIn.toString(),
      estimatedAmountOut: quote.estimatedAmountOut.toString(),
      aToB: quote.aToB,
      decimalsA: whirlpool.getTokenAInfo().decimals,
      decimalsB: whirlpool.getTokenBInfo().decimals,
    });
  } catch (err) {
    return c.json({ error: "Swap quote failed", detail: err instanceof Error ? err.message : String(err) }, 502);
  }
});

interface BuildOrcaSwapBody {
  whirlpoolAddress: string;
  inputMint: string;
  amountIn: string;
  slippageBps?: number;
  owner: string;
}

// ── POST /orca-swap/build — encode a swap transaction, partial-signed only ──
// with any ephemeral signers the SDK generates (e.g. ATA-creation helper accounts).
// The user's own signature is added client-side by their connected wallet.
orcaSwapRouter.post("/build", async (c) => {
  const body = await c.req.json<Partial<BuildOrcaSwapBody>>().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const { whirlpoolAddress, inputMint, amountIn: amountInRaw, slippageBps, owner } = body;

  if (!whirlpoolAddress || !inputMint || !amountInRaw || !owner) {
    return c.json({ error: "Missing whirlpoolAddress/inputMint/amountIn/owner" }, 400);
  }

  let whirlpoolPubkey: PublicKey;
  let inputMintPubkey: PublicKey;
  let ownerPubkey: PublicKey;
  try {
    whirlpoolPubkey = new PublicKey(whirlpoolAddress);
    inputMintPubkey = new PublicKey(inputMint);
    ownerPubkey = new PublicKey(owner);
  } catch {
    return c.json({ error: "Invalid whirlpoolAddress, inputMint, or owner address" }, 400);
  }

  let amountIn: BN;
  try {
    amountIn = new BN(amountInRaw);
  } catch {
    return c.json({ error: "amountIn must be an integer string" }, 400);
  }

  try {
    const ctx = getContext(ownerPubkey);
    const client = buildWhirlpoolClient(ctx);
    const whirlpool = await client.getPool(whirlpoolPubkey);

    // Re-derive the quote server-side from the live pool — never trust a
    // client-cached quote, same trust boundary as the existing LP /build route.
    const quote = await swapQuoteByInputToken(
      whirlpool,
      inputMintPubkey,
      amountIn,
      Percentage.fromFraction(slippageBps ?? 100, 10_000),
      ctx.program.programId,
      ctx.fetcher
    );

    const txBuilder = await whirlpool.swap(quote, ownerPubkey);
    const payload = await txBuilder.build({ maxSupportedTransactionVersion: "legacy", blockhashCommitment: "confirmed" });

    const transaction = payload.transaction as Transaction;
    if (payload.signers.length > 0) {
      transaction.partialSign(...payload.signers);
    }
    const serialized = transaction.serialize({ requireAllSignatures: false });

    return c.json({ transactionBase64: serialized.toString("base64") });
  } catch (err) {
    return c.json({ error: "Build failed", detail: err instanceof Error ? err.message : String(err) }, 502);
  }
});
