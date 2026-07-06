/**
 * HookScope — Anvil end-to-end transaction verifier
 *
 * Verifies that Swap and Add Liquidity transactions can actually be sent on a
 * local Anvil mainnet fork, using the HookScope API server as the transaction
 * builder (same code path as the real frontend).
 *
 * Prerequisites:
 *   1. Anvil running:   pnpm anvil:start
 *   2. Tokens deployed: pnpm anvil:setup
 *   3. API server:      pnpm dev (in apps/api)
 *
 * Run:  pnpm anvil:test
 */

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, keccak256, encodeAbiParameters, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ANVIL_RPC = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// First Anvil funded test account — well-known dev key, never use on mainnet.
const TEST_PRIVATE_KEY = (process.env.ANVIL_PRIVATE_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as `0x${string}`;
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;

const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

const POOL_KEY_TUPLE = {
  type: "tuple", components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
} as const;

const POOL_MANAGER_ABI = [
  {
    name: "initialize",
    type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "key", ...POOL_KEY_TUPLE }, { name: "sqrtPriceX96", type: "uint160" }],
    outputs: [{ name: "tick", type: "int24" }],
  },
] as const;

function poolId(key: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }): `0x${string}` {
  return keccak256(encodeAbiParameters([POOL_KEY_TUPLE], [key]));
}

function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function fail(msg: string, e?: unknown) { console.log(`  ❌ ${msg}${e ? `: ${(e as Error).message?.split("\n")[0]}` : ""}`); }
function section(title: string) { console.log(`\n── ${title} ${"─".repeat(50 - title.length - 4)}`); }

async function main() {
  console.log("HookScope Anvil Transaction Verifier");
  console.log("=====================================");
  console.log(`Anvil RPC: ${ANVIL_RPC}`);
  console.log(`API URL:   ${API_URL}`);

  // ── 1. Check Anvil connectivity ─────────────────────────────────────────
  section("1. Anvil Connectivity");
  const publicClient = createPublicClient({ chain: anvil, transport: http(ANVIL_RPC) });
  const walletClient = createWalletClient({ account: privateKeyToAccount(TEST_PRIVATE_KEY), chain: anvil, transport: http(ANVIL_RPC) });
  const account = walletClient.account.address;

  let chainId: number;
  try {
    chainId = await publicClient.getChainId();
    ok(`Connected — chainId: ${chainId}`);
  } catch (e) {
    fail("Anvil not reachable. Run: pnpm anvil:start", e);
    process.exit(1);
  }

  const ethBalance = await publicClient.getBalance({ address: account });
  ok(`Test account ${account.slice(0, 10)}… balance: ${formatUnits(ethBalance, 18)} ETH`);

  // ── 1b. Verify Anvil is forked from mainnet (V4 contracts must exist) ─────
  const STATE_VIEW = "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227" as Address;
  const stateViewCode = await publicClient.getCode({ address: STATE_VIEW });
  if (!stateViewCode || stateViewCode === "0x") {
    console.log("\n  ❌ ANVIL TIDAK DIJALANKAN DENGAN FORK MAINNET");
    console.log("     Kontrak Uniswap V4 (StateView, Quoter, PositionManager) tidak ditemukan.");
    console.log("\n  Solusi: Stop Anvil yang sekarang, lalu jalankan dengan fork:");
    console.log("     pnpm anvil:start");
    console.log("\n  Pastikan ETHEREUM_RPC_URL di .env menggunakan RPC dengan akses internet:");
    console.log("     - Alchemy: https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY");
    console.log("     - Infura:  https://mainnet.infura.io/v3/YOUR_KEY");
    console.log("\n  Steps 1-4 hanya bisa diuji saat ini. Steps 5-7 butuh mainnet fork.");
    process.exit(1);
  }
  ok("Mainnet fork aktif — kontrak Uniswap V4 terdeteksi di StateView");

  // ── 2. Load deployed test token addresses ───────────────────────────────
  section("2. Test Token Setup");
  const addressFile = resolve(__dirname, "../contracts/out/anvil-addresses.json");
  if (!existsSync(addressFile)) {
    fail("contracts/out/anvil-addresses.json not found. Run: pnpm anvil:setup");
    process.exit(1);
  }
  const addrs = JSON.parse(readFileSync(addressFile, "utf8")) as {
    tokenA: Address; tokenB: Address; currency0: Address; currency1: Address;
    deployer: Address; poolManager: Address; positionManager: Address; permit2: Address;
  };

  const [decA, decB, balA, balB] = await Promise.all([
    publicClient.readContract({ address: addrs.tokenA, abi: ERC20_ABI, functionName: "decimals" }),
    publicClient.readContract({ address: addrs.tokenB, abi: ERC20_ABI, functionName: "decimals" }),
    publicClient.readContract({ address: addrs.tokenA, abi: ERC20_ABI, functionName: "balanceOf", args: [account] }),
    publicClient.readContract({ address: addrs.tokenB, abi: ERC20_ABI, functionName: "balanceOf", args: [account] }),
  ]);

  ok(`Token A (${addrs.tokenA.slice(0, 10)}…): balance = ${formatUnits(balA, decA)} TTKA`);
  ok(`Token B (${addrs.tokenB.slice(0, 10)}…): balance = ${formatUnits(balB, decB)} TTKB`);

  if (balA === 0n || balB === 0n) {
    fail("Token balances are zero. Run: pnpm anvil:setup");
    process.exit(1);
  }

  // Figuring out which decimals match currency0 vs currency1
  // (Uniswap v4 requires currency0 = lower address — might differ from tokenA/B order)
  const dec0 = addrs.currency0.toLowerCase() === addrs.tokenA.toLowerCase() ? decA : decB;
  const dec1 = addrs.currency1.toLowerCase() === addrs.tokenA.toLowerCase() ? decA : decB;

  // ── 3. Approve Permit2 for both tokens ─────────────────────────────────
  section("3. Permit2 Approvals (ERC20 → Permit2)");
  const MAX_UINT256 = 2n ** 256n - 1n;
  try {
    await walletClient.writeContract({ address: addrs.tokenA, abi: ERC20_ABI, functionName: "approve", args: [PERMIT2_ADDRESS, MAX_UINT256] });
    ok("ERC20 approved TTKA for Permit2");
    await walletClient.writeContract({ address: addrs.tokenB, abi: ERC20_ABI, functionName: "approve", args: [PERMIT2_ADDRESS, MAX_UINT256] });
    ok("ERC20 approved TTKB for Permit2");
  } catch (e) {
    fail("ERC20 approval failed", e);
  }

  // Permit2 → PositionManager: must set allowance so PositionManager can
  // pull tokens through Permit2 (separate from the ERC20 approval above).
  section("3b. Permit2 → PositionManager Allowance");
  const PERMIT2_APPROVE_ABI = [{
    name: "approve",
    type: "function" as const, stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  }] as const;
  const MAX_UINT160 = 2n ** 160n - 1n;
  const MAX_UINT48 = Number(2n ** 48n - 1n);
  try {
    await walletClient.writeContract({
      address: PERMIT2_ADDRESS,
      abi: PERMIT2_APPROVE_ABI,
      functionName: "approve",
      args: [addrs.currency0 as Address, addrs.positionManager as Address, MAX_UINT160, MAX_UINT48],
    });
    ok("Permit2 allowance set: currency0 → PositionManager");
    await walletClient.writeContract({
      address: PERMIT2_ADDRESS,
      abi: PERMIT2_APPROVE_ABI,
      functionName: "approve",
      args: [addrs.currency1 as Address, addrs.positionManager as Address, MAX_UINT160, MAX_UINT48],
    });
    ok("Permit2 allowance set: currency1 → PositionManager");
  } catch (e) {
    fail("Permit2 PositionManager allowance failed", e);
  }

  // ── 4. Initialize test v4 pool (no hook) ────────────────────────────────
  section("4. Initialize Uniswap v4 Test Pool");
  const poolKey = {
    currency0: addrs.currency0,
    currency1: addrs.currency1,
    fee: 3000,      // 0.3%
    tickSpacing: 60,
    hooks: "0x0000000000000000000000000000000000000000" as Address,
  };
  const sqrtPriceX96 = 79228162514264337593543950336n; // price = 1.0 (1:1)
  const pid = poolId(poolKey);

  try {
    const hash = await walletClient.writeContract({
      address: addrs.poolManager as Address,
      abi: POOL_MANAGER_ABI,
      functionName: "initialize",
      args: [poolKey, sqrtPriceX96],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    ok(`Pool initialized — poolId ${pid.slice(0, 12)}…`);
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (msg.includes("PoolAlreadyInitialized")) {
      ok("Pool already initialized (from a previous run)");
    } else {
      fail("Pool initialization failed", e);
    }
  }

  // ── 5. HookScope API — LP Quote (get current tick + balanced amounts) ────
  section("5. HookScope API — LP Quote (chainId 31337)");
  const MIN_TICK = -887272, MAX_TICK = 887272;
  const tickLower = Math.ceil(MIN_TICK / poolKey.tickSpacing) * poolKey.tickSpacing;
  const tickUpper = Math.floor(MAX_TICK / poolKey.tickSpacing) * poolKey.tickSpacing;

  // Probe quote to get currentTick + auto-balanced amount1 from a fixed amount0.
  const quoteUrl = `${API_URL}/api/lp/quote?chainId=31337` +
    `&currency0=${addrs.currency0}&currency1=${addrs.currency1}` +
    `&fee=${poolKey.fee}&tickSpacing=${poolKey.tickSpacing}&hooks=${poolKey.hooks}` +
    `&tickLower=${tickLower}&tickUpper=${tickUpper}&amount0=${parseUnits("10", dec0)}`;

  let amount0Str = parseUnits("10", dec0).toString();
  let amount1Str = parseUnits("10", dec1).toString();

  try {
    const res = await fetch(quoteUrl);
    const body = await res.json() as Record<string, unknown>;
    if (!res.ok) throw new Error(String(body.error ?? body));
    amount0Str = String(body.amount0);
    amount1Str = String(body.amount1);
    ok(`LP quote OK — currentTick: ${body.currentTick}, amount0: ${amount0Str}, amount1: ${amount1Str}`);
  } catch (e) {
    fail("LP quote failed (is API server running? pnpm dev in apps/api)", e);
  }

  // ── 6. Add Liquidity Transaction ─────────────────────────────────────────
  // Must come BEFORE swap quote — Quoter needs at least 1 liquidity position.
  section("6. Add Liquidity Transaction (full round-trip)");
  const buildUrl = `${API_URL}/api/lp/build`;
  try {
    const res = await fetch(buildUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chainId: 31337,
        poolKey,
        tickLower,
        tickUpper,
        amount0: amount0Str || parseUnits("10", dec0).toString(),
        amount1: amount1Str || parseUnits("10", dec1).toString(),
        recipient: account,
        slippageBps: 200,
      }),
    });
    const body = await res.json() as Record<string, unknown>;
    if (!res.ok) throw new Error(String(body.error ?? JSON.stringify(body)));

    const hash = await walletClient.sendTransaction({
      to: body.to as Address,
      data: body.data as `0x${string}`,
      value: BigInt(body.value as string),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "success") {
      ok(`Add Liquidity confirmed ✅ — hash: ${receipt.transactionHash.slice(0, 14)}…`);
    } else {
      fail(`Tx reverted — hash: ${receipt.transactionHash.slice(0, 14)}…`);
    }
  } catch (e) {
    fail("Add Liquidity transaction failed", e);
  }

  // ── 7. Swap Quote (needs liquidity to exist in pool) ───────────────────
  section("7. HookScope API — Swap Quote (chainId 31337)");
  const swapQuoteUrl = `${API_URL}/api/swap/quote?chainId=31337` +
    `&currency0=${addrs.currency0}&currency1=${addrs.currency1}` +
    `&fee=${poolKey.fee}&tickSpacing=${poolKey.tickSpacing}&hooks=${poolKey.hooks}` +
    `&zeroForOne=true&amountIn=${parseUnits("1", dec0)}`;

  try {
    const res = await fetch(swapQuoteUrl);
    const body = await res.json() as Record<string, unknown>;
    if (!res.ok) throw new Error(String(body.error ?? body.detail));
    ok(`Swap quote OK — amountOut: ${body.amountOut}, gasEstimate: ${body.gasEstimate}`);
  } catch (e) {
    fail("Swap quote failed", e);
  }

  console.log("\n=====================================");
  console.log("Verifier complete. Addresses for HookScope UI:");
  console.log(`  chainId:   31337`);
  console.log(`  currency0: ${addrs.currency0}`);
  console.log(`  currency1: ${addrs.currency1}`);
  console.log(`  hook:      0x0000000000000000000000000000000000000000`);
  console.log(`  fee:       3000`);
  console.log(`  tickSpacing: 60`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
