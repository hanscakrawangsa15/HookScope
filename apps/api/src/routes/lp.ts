import { Hono } from "hono";
import { createRequire } from "node:module";
import {
  createPublicClient,
  http,
  encodeAbiParameters,
  keccak256,
  type Address,
  type Chain,
} from "viem";
import { mainnet, base, arbitrum, optimism, sepolia, baseSepolia, anvil } from "viem/chains";
import {
  V4_POSITION_MANAGER_ADDRESSES,
  V4_STATE_VIEW_ADDRESSES,
  V4_STATE_VIEW_ABI,
  MIN_TICK,
  MAX_TICK,
} from "@hookscope/shared";

// Same broken-ESM-build workaround already used in swap.ts — both v4-sdk and
// sdk-core's published ESM builds use extension-less relative imports that
// Node's native resolver rejects. Their CJS builds are fine.
const require = createRequire(import.meta.url);
const { Pool, Position, V4PositionManager } = require("@uniswap/v4-sdk") as typeof import("@uniswap/v4-sdk");
const { Token, Ether, Percent } = require("@uniswap/sdk-core") as typeof import("@uniswap/sdk-core");

export const lpRouter = new Hono();

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ── viem clients per chain — mainnets + testnets (Sepolia, Base Sepolia) ─────
const VIEM_CHAINS: Record<number, ReturnType<typeof createPublicClient>> = {};

export function getClient(chainId: number) {
  if (VIEM_CHAINS[chainId]) return VIEM_CHAINS[chainId];
  const cfg: Record<number, { chain: Chain; rpc: string }> = {
    1:        { chain: mainnet,     rpc: process.env.ETHEREUM_RPC_URL     ?? "https://ethereum.publicnode.com" },
    8453:     { chain: base,        rpc: process.env.BASE_RPC_URL         ?? "https://mainnet.base.org" },
    42161:    { chain: arbitrum,    rpc: process.env.ARBITRUM_RPC_URL     ?? "https://arb1.arbitrum.io/rpc" },
    10:       { chain: optimism,    rpc: process.env.OPTIMISM_RPC_URL     ?? "https://mainnet.optimism.io" },
    11155111: { chain: sepolia,     rpc: process.env.SEPOLIA_RPC_URL      ?? "https://rpc.sepolia.org" },
    84532:    { chain: baseSepolia, rpc: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org" },
    31337:    { chain: anvil,       rpc: process.env.ANVIL_RPC_URL        ?? "http://127.0.0.1:8545" },
  };
  const c = cfg[chainId];
  if (!c) return null;
  VIEM_CHAINS[chainId] = createPublicClient({ chain: c.chain, transport: http(c.rpc, { retryCount: 2, retryDelay: 500, timeout: 6_000 }) });
  return VIEM_CHAINS[chainId];
}

export interface PoolKeyInput {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

const POOL_KEY_TUPLE = {
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
} as const;

// PoolId = keccak256(abi.encode(poolKey)) — matches v4-core's PoolIdLibrary.toId()
export function computePoolId(poolKey: PoolKeyInput): `0x${string}` {
  return keccak256(encodeAbiParameters([POOL_KEY_TUPLE], [poolKey]));
}

function parsePoolKey(q: {
  currency0?: string; currency1?: string; fee?: string; tickSpacing?: string; hooks?: string;
}): PoolKeyInput | null {
  const { currency0, currency1, fee, tickSpacing, hooks } = q;
  if (!currency0 || !currency1 || fee === undefined || tickSpacing === undefined || !hooks) return null;
  return {
    currency0: currency0 as Address,
    currency1: currency1 as Address,
    fee: Number(fee),
    tickSpacing: Number(tickSpacing),
    hooks: hooks as Address,
  };
}

function validateTicks(tickLower: number, tickUpper: number, tickSpacing: number): string | null {
  if (!Number.isInteger(tickLower) || !Number.isInteger(tickUpper)) return "tickLower/tickUpper must be integers";
  if (tickLower >= tickUpper) return "tickLower must be less than tickUpper";
  if (tickLower < MIN_TICK || tickUpper > MAX_TICK) return `Ticks must be within [${MIN_TICK}, ${MAX_TICK}]`;
  if (tickLower % tickSpacing !== 0 || tickUpper % tickSpacing !== 0) return `Ticks must be multiples of tickSpacing (${tickSpacing})`;
  return null;
}

const ERC20_DECIMALS_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
] as const;

// Viem's raw error for a rate-limited RPC is a multi-line dump (request body, raw
// call args, contract call, docs link...) — not useful in an inline UI error. Detect
// it and return a short, honest, retry-friendly message instead of the full dump.
function describeRpcError(err: unknown, chainId?: number): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Detect Anvil-specific connection failures first
  if (chainId === 31337 && (/ECONNREFUSED|fetch failed|HTTP request failed/i.test(msg))) {
    return "Anvil is not running. Run: pnpm anvil:start — then refresh the page.";
  }
  if (/rate limit/i.test(msg)) {
    return "RPC provider is rate-limiting requests right now — wait a few seconds and try again.";
  }
  if (/ECONNREFUSED|fetch failed/i.test(msg)) {
    return "Cannot connect to RPC endpoint. Check your connection or update ETHEREUM_RPC_URL in .env.";
  }
  return msg.split("\n")[0].slice(0, 300);
}

export async function readDecimals(client: NonNullable<ReturnType<typeof getClient>>, address: Address): Promise<number> {
  if (address.toLowerCase() === ZERO_ADDRESS) return 18;
  return Number(await client.readContract({ address, abi: ERC20_DECIMALS_ABI, functionName: "decimals" }));
}

interface LiveState { sqrtPriceX96: bigint; tick: number; liquidity: bigint }

// Reads via the official StateView lens contract, NOT PoolManager directly —
// PoolManager itself doesn't expose getSlot0/getLiquidity as callable external
// functions (verified against v4-core source: it only inherits Extsload/Exttload;
// these names are StateLibrary functions meant to be called from within another
// contract, not via a plain eth_call). Returns null if the pool has never been
// initialized (sqrtPriceX96 === 0 — StateView's reads don't revert for that case).
export async function readLiveState(
  client: NonNullable<ReturnType<typeof getClient>>, stateViewAddr: Address, poolId: `0x${string}`,
): Promise<LiveState | null> {
  const [slot0, liquidity] = await Promise.all([
    client.readContract({ address: stateViewAddr, abi: V4_STATE_VIEW_ABI, functionName: "getSlot0", args: [poolId] }),
    client.readContract({ address: stateViewAddr, abi: V4_STATE_VIEW_ABI, functionName: "getLiquidity", args: [poolId] }),
  ]);
  const [sqrtPriceX96, tick] = slot0;
  if (sqrtPriceX96 === 0n) return null;
  return { sqrtPriceX96, tick, liquidity };
}

function buildCurrency(chainId: number, address: Address, decimals: number) {
  return address.toLowerCase() === ZERO_ADDRESS ? Ether.onChain(chainId) : new Token(chainId, address, decimals);
}

// ── GET /lp/quote — read-only liquidity-math preview, never returns calldata ─
lpRouter.get("/quote", async (c) => {
  const chainId = Number(c.req.query("chainId"));
  const poolKey = parsePoolKey({
    currency0: c.req.query("currency0"),
    currency1: c.req.query("currency1"),
    fee: c.req.query("fee"),
    tickSpacing: c.req.query("tickSpacing"),
    hooks: c.req.query("hooks"),
  });
  const tickLower = Number(c.req.query("tickLower"));
  const tickUpper = Number(c.req.query("tickUpper"));
  const amount0Raw = c.req.query("amount0");
  const amount1Raw = c.req.query("amount1");

  if (!chainId || !poolKey || Number.isNaN(tickLower) || Number.isNaN(tickUpper)) {
    return c.json({ error: "Missing or invalid chainId/poolKey/tickLower/tickUpper" }, 400);
  }
  const tickError = validateTicks(tickLower, tickUpper, poolKey.tickSpacing);
  if (tickError) return c.json({ error: tickError }, 400);

  const client = getClient(chainId);
  const stateViewAddr = V4_STATE_VIEW_ADDRESSES[chainId];
  if (!client || !stateViewAddr) return c.json({ error: `Unsupported chainId: ${chainId}` }, 400);

  try {
    const poolId = computePoolId(poolKey);
    const [decimals0, decimals1] = await Promise.all([
      readDecimals(client, poolKey.currency0),
      readDecimals(client, poolKey.currency1),
    ]);
    const state = await readLiveState(client, stateViewAddr, poolId);
    if (!state) return c.json({ error: "This pool has not been initialized on-chain yet." }, 502);

    const currency0 = buildCurrency(chainId, poolKey.currency0, decimals0);
    const currency1 = buildCurrency(chainId, poolKey.currency1, decimals1);
    const pool = new Pool(
      currency0, currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks,
      state.sqrtPriceX96.toString(), state.liquidity.toString(), state.tick,
    );
    if (pool.poolId.toLowerCase() !== poolId.toLowerCase()) {
      return c.json({ error: "PoolKey identity mismatch — refusing to compute liquidity math." }, 400);
    }

    let amount0 = "0";
    let amount1 = "0";
    let liquidity = "0";

    if (amount0Raw && amount1Raw) {
      const position = Position.fromAmounts({ pool, tickLower, tickUpper, amount0: amount0Raw, amount1: amount1Raw, useFullPrecision: true });
      liquidity = position.liquidity.toString();
      amount0 = position.mintAmounts.amount0.toString();
      amount1 = position.mintAmounts.amount1.toString();
    } else if (amount0Raw) {
      const position = Position.fromAmount0({ pool, tickLower, tickUpper, amount0: amount0Raw, useFullPrecision: true });
      liquidity = position.liquidity.toString();
      amount0 = position.mintAmounts.amount0.toString();
      amount1 = position.mintAmounts.amount1.toString();
    } else if (amount1Raw) {
      const position = Position.fromAmount1({ pool, tickLower, tickUpper, amount1: amount1Raw });
      liquidity = position.liquidity.toString();
      amount0 = position.mintAmounts.amount0.toString();
      amount1 = position.mintAmounts.amount1.toString();
    }
    // else: neither amount supplied — "probe" call used only to learn currentTick/sqrtPriceX96
    // for client-side range-preset tick math, before the user has typed anything.

    return c.json({
      amount0, amount1, liquidity,
      currentTick: state.tick,
      sqrtPriceX96: state.sqrtPriceX96.toString(),
      tickSpacing: poolKey.tickSpacing,
      token0Decimals: decimals0,
      token1Decimals: decimals1,
    });
  } catch (err) {
    return c.json({ error: "Liquidity quote failed", detail: describeRpcError(err, chainId) }, 502);
  }
});

interface BuildLpBody {
  chainId: number;
  poolKey: PoolKeyInput;
  tickLower: number;
  tickUpper: number;
  amount0: string;
  amount1: string;
  recipient: string;
  slippageBps?: number;
  deadlineSeconds?: number;
}

// ── POST /lp/build — encode PositionManager mint calldata, no key touches this ──
lpRouter.post("/build", async (c) => {
  const body = await c.req.json<Partial<BuildLpBody>>().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const {
    chainId, poolKey, tickLower, tickUpper,
    amount0: amount0Raw, amount1: amount1Raw, recipient, slippageBps, deadlineSeconds,
  } = body;

  if (!chainId || !poolKey || tickLower === undefined || tickUpper === undefined || !amount0Raw || !amount1Raw || !recipient) {
    return c.json({ error: "Missing chainId/poolKey/tickLower/tickUpper/amount0/amount1/recipient" }, 400);
  }
  const tickError = validateTicks(tickLower, tickUpper, poolKey.tickSpacing);
  if (tickError) return c.json({ error: tickError }, 400);

  const positionManagerAddr = V4_POSITION_MANAGER_ADDRESSES[chainId];
  const client = getClient(chainId);
  const stateViewAddr = V4_STATE_VIEW_ADDRESSES[chainId];
  if (!client || !stateViewAddr || !positionManagerAddr) return c.json({ error: `Unsupported chainId: ${chainId}` }, 400);

  try {
    BigInt(amount0Raw);
    BigInt(amount1Raw);
  } catch {
    return c.json({ error: "amount0/amount1 must be integer strings" }, 400);
  }

  try {
    const poolId = computePoolId(poolKey);
    const [decimals0, decimals1] = await Promise.all([
      readDecimals(client, poolKey.currency0),
      readDecimals(client, poolKey.currency1),
    ]);
    const state = await readLiveState(client, stateViewAddr, poolId);
    if (!state) return c.json({ error: "This pool has not been initialized on-chain yet." }, 502);

    const currency0 = buildCurrency(chainId, poolKey.currency0, decimals0);
    const currency1 = buildCurrency(chainId, poolKey.currency1, decimals1);
    const pool = new Pool(
      currency0, currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks,
      state.sqrtPriceX96.toString(), state.liquidity.toString(), state.tick,
    );
    if (pool.poolId.toLowerCase() !== poolId.toLowerCase()) {
      return c.json({ error: "PoolKey identity mismatch — refusing to build a transaction." }, 400);
    }

    // Trust the client's final (post-auto-balance) amounts directly, same trust
    // boundary swap.ts's /build already uses for a client-supplied minAmountOut.
    const position = Position.fromAmounts({ pool, tickLower, tickUpper, amount0: amount0Raw, amount1: amount1Raw, useFullPrecision: true });

    const isNative0 = poolKey.currency0.toLowerCase() === ZERO_ADDRESS;
    const isNative1 = poolKey.currency1.toLowerCase() === ZERO_ADDRESS;
    // For Anvil (Demo Mode): use the current block timestamp + 7 days so the
    // deadline never expires during a testing session, regardless of clock drift
    // between the API server and Anvil's block timestamps.
    let deadline: number;
    if (chainId === 31337) {
      const block = await client.getBlock({ blockTag: "latest" });
      deadline = Number(block.timestamp) + 7 * 24 * 3600;
    } else {
      deadline = Math.floor(Date.now() / 1000) + (deadlineSeconds ?? 1200);
    }

    const { calldata, value } = V4PositionManager.addCallParameters(position, {
      recipient,
      createPool: false,
      slippageTolerance: new Percent(slippageBps ?? 50, 10_000),
      deadline,
      ...((isNative0 || isNative1) ? { useNative: Ether.onChain(chainId) } : {}),
    });

    return c.json({
      to: positionManagerAddr,
      data: calldata,
      value,
      permit2Address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      deadline: deadline.toString(),
    });
  } catch (err) {
    return c.json({ error: "Build failed", detail: describeRpcError(err, chainId) }, 502);
  }
});
