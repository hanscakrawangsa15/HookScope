/**
 * Register the Anvil test pool into the HookScope database so the normal
 * hook-detail page and Add Liquidity / Swap UI can find it.
 *
 * Run AFTER `pnpm anvil:setup` (deploys test tokens) and `pnpm anvil:test`
 * (initializes the v4 pool). The pool parameters used here match what
 * anvil-test.ts creates: fee=3000, tickSpacing=60, no hook (0x0000…0000).
 *
 * Usage: pnpm anvil:register
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { createPublicClient, http, keccak256, encodeAbiParameters } from "viem";
import { anvil } from "viem/chains";
import { PrismaClient } from "@prisma/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const prisma = new PrismaClient();

const ANVIL_RPC = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
const CHAIN_ID = 31337;
const ZERO_HOOK = "0x0000000000000000000000000000000000000000";

function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function fail(msg: string) { console.log(`  ❌ ${msg}`); }
function section(t: string) { console.log(`\n── ${t}`); }

// Compute v4 poolId = keccak256(abi.encode(poolKey))
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

async function main() {
  console.log("HookScope — Anvil Pool Registration");
  console.log("=====================================");

  // ── 1. Check Anvil is running ──────────────────────────────────────────
  section("1. Anvil Connectivity");
  const client = createPublicClient({ chain: anvil, transport: http(ANVIL_RPC) });
  try {
    const chainId = await client.getChainId();
    ok(`Anvil running — chainId ${chainId}`);
  } catch {
    fail("Anvil tidak berjalan. Jalankan: pnpm anvil:start");
    process.exit(1);
  }

  // ── 2. Load test token addresses ──────────────────────────────────────
  section("2. Load Token Addresses");
  const addrFile = resolve(__dirname, "../contracts/out/anvil-addresses.json");
  if (!existsSync(addrFile)) {
    fail("contracts/out/anvil-addresses.json not found. Jalankan: pnpm anvil:setup");
    process.exit(1);
  }
  const addrs = JSON.parse(readFileSync(addrFile, "utf8")) as {
    tokenA: string; tokenB: string;
    currency0: string; currency1: string;
  };
  ok(`currency0 (TTKB 6 dec): ${addrs.currency0}`);
  ok(`currency1 (TTKA 18 dec): ${addrs.currency1}`);

  // ── 3. Compute poolId ─────────────────────────────────────────────────
  section("3. Compute Pool ID");
  const poolKey = {
    currency0: addrs.currency0 as `0x${string}`,
    currency1: addrs.currency1 as `0x${string}`,
    fee: 3000,
    tickSpacing: 60,
    hooks: ZERO_HOOK as `0x${string}`,
  };
  const poolId = keccak256(encodeAbiParameters([POOL_KEY_TUPLE], [poolKey]));
  ok(`poolId: ${poolId}`);

  // ── 4. Upsert Hook into DB ────────────────────────────────────────────
  section("4. Register Hook in Database");
  // Use the zero address as the "hook" for a no-hook pool on Anvil.
  const hookAddress = ZERO_HOOK;
  const hook = await prisma.hook.upsert({
    where: { address_chainId: { address: hookAddress, chainId: CHAIN_ID } },
    create: {
      address: hookAddress,
      chainId: CHAIN_ID,
      name: "Anvil Test Pool (no hook)",
      description:
        "Local Anvil mainnet fork test pool — deployed by `pnpm anvil:setup`. " +
        "Uses two OZ ERC20 test tokens (TTKA 18 dec + TTKB 6 dec) with fee 0.3%, tickSpacing 60, no hook. " +
        "Safe to use with test ETH — no real funds involved.",
      isVerified: false,
      riskLevel: "LOW",
      hookScore: 100,
      auditStatus: "UNAUDITED",
      proxyType: "NONE",
    },
    update: {
      name: "Anvil Test Pool (no hook)",
      description: "Local Anvil mainnet fork test pool — deployed by `pnpm anvil:setup`.",
    },
  });
  ok(`Hook upserted — id: ${hook.id}`);

  // ── 5. Upsert Pool into DB ────────────────────────────────────────────
  section("5. Register Pool in Database");
  const pool = await prisma.pool.upsert({
    where: { poolId_chainId: { poolId, chainId: CHAIN_ID } },
    create: {
      poolId,
      hookId: hook.id,
      chainId: CHAIN_ID,
      token0: addrs.currency0,
      token1: addrs.currency1,
      token0Symbol: "TTKB",
      token1Symbol: "TTKA",
      fee: 3000,
      tickSpacing: 60,
      tvlUsd: 0,
      isActive: true,
    },
    update: {
      token0Symbol: "TTKB",
      token1Symbol: "TTKA",
      isActive: true,
    },
  });
  ok(`Pool upserted — id: ${pool.id}`);

  // ── 6. Print access URL ───────────────────────────────────────────────
  console.log("\n=====================================");
  console.log("Registrasi selesai! Buka URL ini di browser:");
  console.log(`\n  http://localhost:3000/hooks/${hookAddress}?chainId=31337\n`);
  console.log("Di halaman tersebut kamu bisa:");
  console.log("  • Swap TTKB ↔ TTKA menggunakan tab 'Swap'");
  console.log("  • Add Liquidity dengan range pilihan di tab 'Add Liquidity'");
  console.log("  • Semua transaksi berjalan di Anvil fork (chainId 31337)\n");
  console.log("Test tokens:");
  console.log(`  TTKB (6 dec):  ${addrs.currency0}`);
  console.log(`  TTKA (18 dec): ${addrs.currency1}`);
  console.log(`  Pool ID:       ${poolId}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
