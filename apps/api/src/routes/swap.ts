import { Hono } from "hono";
import { createRequire } from "node:module";
import {
  createPublicClient,
  http,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  BaseError,
  ContractFunctionRevertedError,
  type Address,
  type Chain,
} from "viem";
import { mainnet, base, arbitrum, optimism, sepolia, baseSepolia, anvil } from "viem/chains";
import { POOL_MANAGER_ADDRESSES, V4_QUOTER_ADDRESSES, V4_QUOTER_ABI } from "@hookscope/shared";

// The Uniswap SDKs' published ESM builds use extension-less relative imports
// (e.g. `export * from './entities'`), which Node's native ESM resolver rejects
// (ERR_UNSUPPORTED_DIR_IMPORT / ERR_MODULE_NOT_FOUND). Their CJS builds are fine —
// load them through createRequire instead of `import` to dodge the broken ESM build.
const require = createRequire(import.meta.url);
const { V4Planner, Actions, URVersion } = require("@uniswap/v4-sdk") as typeof import("@uniswap/v4-sdk");
const { RoutePlanner, CommandType, UNIVERSAL_ROUTER_ADDRESS, UniversalRouterVersion } =
  require("@uniswap/universal-router-sdk") as typeof import("@uniswap/universal-router-sdk");
const { permit2Address } = require("@uniswap/permit2-sdk") as typeof import("@uniswap/permit2-sdk");

export const swapRouter = new Hono();

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ── viem clients per chain — mainnets + testnets (Sepolia, Base Sepolia) ─────
const VIEM_CHAINS: Record<number, ReturnType<typeof createPublicClient>> = {};

function getClient(chainId: number) {
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

interface PoolKeyInput {
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
function computePoolId(poolKey: PoolKeyInput): `0x${string}` {
  return keccak256(encodeAbiParameters([POOL_KEY_TUPLE], [poolKey]));
}

const POOL_MANAGER_SLOT0_ABI = [
  {
    type: "function", name: "getSlot0", stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
] as const;

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

// ── GET /swap/quote — read-only V4Quoter simulation ──────────────────────────
swapRouter.get("/quote", async (c) => {
  const chainId = Number(c.req.query("chainId"));
  const zeroForOne = c.req.query("zeroForOne") === "true";
  const amountInRaw = c.req.query("amountIn");
  const poolKey = parsePoolKey({
    currency0: c.req.query("currency0"),
    currency1: c.req.query("currency1"),
    fee: c.req.query("fee"),
    tickSpacing: c.req.query("tickSpacing"),
    hooks: c.req.query("hooks"),
  });

  if (!chainId || !poolKey || !amountInRaw) {
    return c.json({ error: "Missing or invalid chainId/poolKey/amountIn" }, 400);
  }

  let amountIn: bigint;
  try {
    amountIn = BigInt(amountInRaw);
  } catch {
    return c.json({ error: "amountIn must be an integer string (raw token units)" }, 400);
  }
  if (amountIn <= 0n) return c.json({ error: "amountIn must be positive" }, 400);

  const client = getClient(chainId);
  const quoterAddress = V4_QUOTER_ADDRESSES[chainId];
  if (!client || !quoterAddress) return c.json({ error: `Unsupported chainId: ${chainId}` }, 400);

  try {
    const { result } = await client.simulateContract({
      address: quoterAddress,
      abi: V4_QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args: [{ poolKey, zeroForOne, exactAmount: amountIn, hookData: "0x" }],
    });
    const [amountOut, gasEstimate] = result;

    // Best-effort price-impact estimate from current pool spot price. Informational
    // only — real slippage protection is the minAmountOut passed into /swap/build,
    // not this number, per the "warn only, never block" risk-gating decision.
    let priceImpactBps: number | null = null;
    const pmAddr = POOL_MANAGER_ADDRESSES[chainId];
    if (pmAddr) {
      try {
        const poolId = computePoolId(poolKey);
        const slot0 = await client.readContract({
          address: pmAddr, abi: POOL_MANAGER_SLOT0_ABI, functionName: "getSlot0", args: [poolId],
        });
        const sqrtPriceX96 = slot0[0];
        if (sqrtPriceX96 > 0n) {
          const Q96 = 2 ** 96;
          const rawPrice = (Number(sqrtPriceX96) / Q96) ** 2; // token1 raw units per token0 raw unit
          const expectedOut = zeroForOne ? Number(amountIn) * rawPrice : Number(amountIn) / rawPrice;
          if (expectedOut > 0) {
            const impact = (expectedOut - Number(amountOut)) / expectedOut;
            priceImpactBps = Math.max(0, Math.round(impact * 10_000));
          }
        }
      } catch { /* spot price unavailable — skip impact estimate */ }
    }

    return c.json({
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      gasEstimate: gasEstimate.toString(),
      priceImpactBps,
    });
  } catch (err) {
    return c.json({ error: "Quote simulation failed", detail: describeQuoteError(err) }, 502);
  }
});

// Most quote failures on testnets are an illiquid/uninitialized pool, not a bad request —
// surface that plainly instead of viem's raw ABI-decode dump.
function describeQuoteError(err: unknown): string {
  if (err instanceof BaseError) {
    const revertError = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revertError instanceof ContractFunctionRevertedError) {
      const name = revertError.data?.errorName;
      if (name === "NotEnoughLiquidity" || name === "PoolNotInitialized" || name === "UnexpectedRevertBytes") {
        return "This pool has no usable on-chain liquidity to quote against right now.";
      }
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/rate limit/i.test(msg)) {
    return "RPC provider is rate-limiting requests right now — wait a few seconds and try again.";
  }
  return msg.split("\n")[0].slice(0, 300);
}

const UNIVERSAL_ROUTER_EXECUTE_ABI = [
  {
    type: "function", name: "execute", stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

interface BuildSwapBody {
  chainId: number;
  poolKey: PoolKeyInput;
  zeroForOne: boolean;
  amountIn: string;
  minAmountOut: string;
  deadlineSeconds?: number;
}

// ── POST /swap/build — encode Universal Router calldata, no key ever touches this ──
swapRouter.post("/build", async (c) => {
  const body = await c.req.json<Partial<BuildSwapBody>>().catch(() => null);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const { chainId, poolKey, zeroForOne, amountIn: amountInRaw, minAmountOut: minAmountOutRaw, deadlineSeconds } = body;

  if (!chainId || !poolKey || typeof zeroForOne !== "boolean" || !amountInRaw || !minAmountOutRaw) {
    return c.json({ error: "Missing chainId/poolKey/zeroForOne/amountIn/minAmountOut" }, 400);
  }
  if (!V4_QUOTER_ADDRESSES[chainId]) return c.json({ error: `Unsupported chainId: ${chainId}` }, 400);

  let amountIn: bigint;
  let minAmountOut: bigint;
  try {
    amountIn = BigInt(amountInRaw);
    minAmountOut = BigInt(minAmountOutRaw);
  } catch {
    return c.json({ error: "amountIn/minAmountOut must be integer strings" }, 400);
  }
  if (amountIn <= 0n || minAmountOut < 0n) return c.json({ error: "Invalid amounts" }, 400);

  const currencyIn = zeroForOne ? poolKey.currency0 : poolKey.currency1;
  const currencyOut = zeroForOne ? poolKey.currency1 : poolKey.currency0;

  const planner = new V4Planner();
  planner.addAction(
    Actions.SWAP_EXACT_IN_SINGLE,
    [{
      poolKey: {
        currency0: poolKey.currency0,
        currency1: poolKey.currency1,
        fee: poolKey.fee,
        tickSpacing: poolKey.tickSpacing,
        hooks: poolKey.hooks,
      },
      zeroForOne,
      amountIn: amountIn.toString(),
      amountOutMinimum: minAmountOut.toString(),
      minHopPriceX36: "0",
      hookData: "0x",
    }],
    URVersion.V2_1_1,
  );
  planner.addAction(Actions.SETTLE_ALL, [currencyIn, amountIn.toString()], URVersion.V2_1_1);
  planner.addAction(Actions.TAKE_ALL, [currencyOut, minAmountOut.toString()], URVersion.V2_1_1);

  const routePlanner = new RoutePlanner();
  routePlanner.addCommand(CommandType.V4_SWAP, [planner.finalize()]);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + (deadlineSeconds ?? 1200));
  const routerAddress = UNIVERSAL_ROUTER_ADDRESS(UniversalRouterVersion.V2_1_1, chainId) as Address;

  const data = encodeFunctionData({
    abi: UNIVERSAL_ROUTER_EXECUTE_ABI,
    functionName: "execute",
    args: [routePlanner.commands as `0x${string}`, routePlanner.inputs as `0x${string}`[], deadline],
  });

  const isNativeIn = currencyIn.toLowerCase() === ZERO_ADDRESS;

  return c.json({
    to: routerAddress,
    data,
    value: isNativeIn ? amountIn.toString() : "0",
    permit2Address: permit2Address(chainId),
    deadline: deadline.toString(),
  });
});
