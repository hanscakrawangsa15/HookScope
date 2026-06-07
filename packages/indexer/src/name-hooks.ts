/**
 * Hook Auto-Namer
 *
 * Generates descriptive names for unnamed hooks based on their callback
 * flag patterns. Each unique combination of active callbacks maps to a
 * meaningful use-case name.
 *
 * Priority:
 *   1. Real contract name from Etherscan (already set by enrich-etherscan)
 *   2. Auto-generated name from callback pattern (this script)
 *
 * Only updates hooks where name IS NULL.
 * Optionally re-runs verified hooks with --all flag.
 *
 * Run: pnpm --filter @hookscope/indexer name-hooks
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

import { PrismaClient } from "@prisma/client";
import type { HookCallbackFlags } from "@hookscope/shared";

// ─── Core naming logic ────────────────────────────────────────────────────────

/**
 * Maps a hook's callback flags to a human-readable name describing its
 * primary purpose. Based on common Uniswap v4 hook archetypes.
 */
export function generateHookName(f: HookCallbackFlags): string {
  // Derived booleans for readability
  const hasSwap       = f.beforeSwap || f.afterSwap;
  const hasBothSwap   = f.beforeSwap && f.afterSwap;
  const hasSwapDelta  = f.beforeSwapReturnsDelta || f.afterSwapReturnsDelta;
  const hasFullSwapDelta = f.beforeSwapReturnsDelta && f.afterSwapReturnsDelta;
  const hasLPDelta    = f.afterAddLiquidityReturnsDelta || f.afterRemoveLiquidityReturnsDelta;
  const hasLiquidity  = f.beforeAddLiquidity || f.afterAddLiquidity ||
                        f.beforeRemoveLiquidity || f.afterRemoveLiquidity;
  const hasInit       = f.beforeInitialize || f.afterInitialize;
  const hasDonate     = f.beforeDonate || f.afterDonate;

  const activeCount = (Object.values(f) as boolean[]).filter(Boolean).length;

  // ── No-op ──────────────────────────────────────────────────────────────────
  if (activeCount === 0) return "No-Op Hook";

  // ── Universal (12+ callbacks) ──────────────────────────────────────────────
  if (activeCount >= 12) return "Universal Hook";

  // ── Full custom AMM (bi-directional swap interception + custom accounting) ─
  // Both before+after swap with full delta returns → complete AMM control
  if (hasFullSwapDelta && hasBothSwap) {
    if (hasLiquidity && hasInit) return "Managed AMM Hook";
    if (hasLiquidity)            return "Custom AMM + LP Manager";
    if (hasInit)                 return "Custom AMM Hook";
    return "Custom AMM Hook";
  }

  // ── Dynamic fee (pre-swap interception with delta, no after-swap) ──────────
  // beforeSwap + beforeSwapReturnsDelta = can change fee/amounts before swap
  if (f.beforeSwap && f.beforeSwapReturnsDelta && !f.afterSwap) {
    if (hasLiquidity && hasInit && hasDonate) return "Full Access Control Hook";
    if (hasLiquidity && hasInit)              return "Access Control Hook";
    if (hasLiquidity && hasDonate)            return "Gated Pool Hook";
    if (hasLiquidity)                         return "Swap + Liquidity Guard";
    if (hasInit)                              return "Dynamic Fee Initializer";
    return "Dynamic Fee Hook";
  }

  // ── After-swap fee hook (post-swap custom accounting) ─────────────────────
  // afterSwap + afterSwapReturnsDelta = can redirect fees after swap
  if (f.afterSwap && f.afterSwapReturnsDelta && !f.beforeSwap) {
    if (f.afterRemoveLiquidityReturnsDelta || f.afterRemoveLiquidity)
      return "LP Rewards Hook";
    if (f.afterAddLiquidity)
      return "Fee + LP Observer";
    return "Swap Fee Collector";
  }

  // ── Mixed before-swap delta + after-swap delta (asymmetric AMM) ───────────
  if (f.beforeSwap && f.afterSwapReturnsDelta && !f.afterSwap) {
    if (hasLiquidity && hasInit) return "Dynamic Fee + Oracle";
    return "Hybrid Fee Hook";
  }

  if (f.afterSwap && f.beforeSwapReturnsDelta && !f.beforeSwap) {
    return "Asymmetric Swap Hook";
  }

  // ── Before+After swap WITHOUT delta returns (MEV, circuit breaker, oracle) ─
  if (hasBothSwap && !hasSwapDelta) {
    if (hasLiquidity && hasInit) return "Swap + Pool Manager";
    if (hasLiquidity)            return "Swap + Liquidity Manager";
    if (hasInit)                 return "Full Swap Observer";
    return "Swap Manager";
  }

  // ── Before-swap only, no delta (whitelist, price guard, circuit breaker) ───
  if (f.beforeSwap && !f.afterSwap && !hasSwapDelta) {
    if (hasLiquidity && hasInit) return "Access Control Hook";
    if (hasLiquidity)            return "Swap + LP Guard";
    if (hasDonate)               return "Swap Guard + Donation";
    return "Pre-Swap Guard";
  }

  // ── After-swap only, no delta (oracle, analytics) ─────────────────────────
  if (f.afterSwap && !f.beforeSwap && !hasSwapDelta) {
    if (f.afterAddLiquidity) return "Swap + LP Observer";
    return "Price Oracle Hook";
  }

  // ── Partial delta (only one side) ─────────────────────────────────────────
  if (f.beforeSwapReturnsDelta && !f.afterSwapReturnsDelta && !f.beforeSwap) {
    return "Pre-Swap Accounting Hook";
  }
  if (f.afterSwapReturnsDelta && !f.beforeSwapReturnsDelta && !f.afterSwap) {
    return "Post-Swap Accounting Hook";
  }

  // ── Liquidity management only (no swap hooks) ─────────────────────────────
  if (hasLiquidity && !hasSwap) {
    if (hasLPDelta && hasInit) return "Managed Liquidity Hook";
    if (hasLPDelta)            return "Custom LP Accounting";
    if (hasInit)               return "Liquidity Manager";
    return "Liquidity Guard";
  }

  // ── LP delta only ─────────────────────────────────────────────────────────
  if (hasLPDelta && !hasSwap && !hasLiquidity) {
    return "LP Accounting Hook";
  }

  // ── Initialization only ───────────────────────────────────────────────────
  if (hasInit && !hasSwap && !hasLiquidity && !hasSwapDelta) {
    if (hasDonate) return "Pool Initializer + Donation";
    return "Pool Initializer";
  }

  // ── Donation hooks ────────────────────────────────────────────────────────
  if (hasDonate && !hasSwap && !hasLiquidity) {
    return "Donation Hook";
  }

  // ── Swap with no delta + init ─────────────────────────────────────────────
  if (hasSwap && hasInit && !hasSwapDelta && !hasLiquidity) {
    return "Swap Guard + Init";
  }

  // ── Minimal / single callback ─────────────────────────────────────────────
  if (activeCount === 1) {
    if (f.beforeInitialize)                 return "Pool Initializer";
    if (f.afterInitialize)                  return "Post-Init Hook";
    if (f.beforeAddLiquidity)               return "Liquidity Gatekeeper";
    if (f.afterAddLiquidity)                return "LP Observer";
    if (f.beforeRemoveLiquidity)            return "Withdrawal Guard";
    if (f.afterRemoveLiquidity)             return "LP Exit Hook";
    if (f.beforeSwap)                       return "Pre-Swap Guard";
    if (f.afterSwap)                        return "Price Oracle Hook";
    if (f.beforeDonate)                     return "Donation Guard";
    if (f.afterDonate)                      return "Donation Observer";
    if (f.beforeSwapReturnsDelta)           return "Dynamic Fee Hook";
    if (f.afterSwapReturnsDelta)            return "Swap Fee Collector";
    if (f.afterAddLiquidityReturnsDelta)    return "LP Accounting Hook";
    if (f.afterRemoveLiquidityReturnsDelta) return "LP Exit Accounting";
  }

  // ── General fallback by count ─────────────────────────────────────────────
  if (activeCount <= 3)  return "Minimal Hook";
  if (activeCount <= 6)  return "Multi-Callback Hook";
  if (activeCount <= 10) return "Complex Hook";
  return "Universal Hook";
}

// ─── Additional description for context ───────────────────────────────────────

export function generateHookDescription(f: HookCallbackFlags): string | null {
  const name = generateHookName(f);

  const DESC: Record<string, string> = {
    "Custom AMM Hook":
      "Implements full bi-directional swap interception with custom accounting (delta returns). Typical use cases: concentrated liquidity, dynamic fees, TWAMM, limit orders.",
    "Managed AMM Hook":
      "Full custom AMM with liquidity management and pool initialization control. Complete protocol-level control over all pool operations.",
    "Custom AMM + LP Manager":
      "Custom AMM with additional liquidity position management. Controls both swap execution and LP entry/exit.",
    "Access Control Hook":
      "Restricts swap and liquidity operations via pre-execution validation. Common use: KYC/whitelist enforcement, tiered access, epoch-based liquidity.",
    "Full Access Control Hook":
      "Comprehensive access control over swaps, liquidity, and donations. Complete gating of all pool interactions.",
    "Dynamic Fee Hook":
      "Intercepts swaps before execution to modify fees or amounts. Enables volatility-based fees, MEV protection, or oracle-dependent pricing.",
    "LP Rewards Hook":
      "Redistributes swap fees to liquidity providers via post-swap custom accounting. Enables enhanced yield on LP positions.",
    "Swap Fee Collector":
      "Collects or redirects fees after each swap. Used for protocol fee extraction or fee-sharing mechanisms.",
    "Pre-Swap Guard":
      "Validates or blocks swaps before execution without modifying amounts. Used for circuit breakers, price guards, or compliance checks.",
    "Price Oracle Hook":
      "Observes completed swaps to update on-chain price data. No modification of swap amounts — read-only analytics.",
    "Liquidity Manager":
      "Controls liquidity position creation and removal. Enforces deposit rules, lock periods, or range requirements.",
    "Liquidity Guard":
      "Validates liquidity operations without custom accounting. Used for access control on LP positions.",
    "Pool Initializer":
      "Runs logic during pool initialization. Sets initial parameters, registers pool in external systems, or validates pool configuration.",
    "Swap Manager":
      "Hooks into both sides of a swap without modifying amounts. Used for MEV protection, comprehensive event logging, or two-phase validation.",
    "LP Accounting Hook":
      "Applies custom accounting to liquidity operations. Can redirect LP tokens or fees during add/remove liquidity.",
    "Donation Hook":
      "Intercepts protocol donations. Used for fee-sharing or treasury management.",
    "No-Op Hook": "No callbacks active. This hook does not intercept any pool operations.",
    "Universal Hook":
      "Implements all 12+ Uniswap v4 lifecycle callbacks. Maximum flexibility — full control over all pool operations.",
  };

  return DESC[name] ?? null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  const reall = process.argv.includes("--all");

  const hooks = await prisma.hook.findMany({
    where: reall ? {} : { name: null },
    select: {
      id: true,
      address: true,
      name: true,
      isVerified: true,
      beforeInitialize: true,
      afterInitialize: true,
      beforeAddLiquidity: true,
      afterAddLiquidity: true,
      beforeRemoveLiquidity: true,
      afterRemoveLiquidity: true,
      beforeSwap: true,
      afterSwap: true,
      beforeDonate: true,
      afterDonate: true,
      beforeSwapReturnsDelta: true,
      afterSwapReturnsDelta: true,
      afterAddLiquidityReturnsDelta: true,
      afterRemoveLiquidityReturnsDelta: true,
    },
  });

  console.log(`\nHookScope Auto-Namer`);
  console.log(`════════════════════`);
  console.log(`Hooks to name : ${hooks.length}`);
  console.log(`Mode          : ${reall ? "all hooks" : "unnamed only"}`);
  console.log(``);

  let named = 0;
  let skipped = 0;

  // Count by generated name for reporting
  const nameCounts: Record<string, number> = {};

  for (const hook of hooks) {
    // Skip verified hooks with real names (Etherscan gave us something better)
    if (!reall && hook.isVerified && hook.name) {
      skipped++;
      continue;
    }

    const flags: HookCallbackFlags = {
      beforeInitialize:                   hook.beforeInitialize,
      afterInitialize:                    hook.afterInitialize,
      beforeAddLiquidity:                 hook.beforeAddLiquidity,
      afterAddLiquidity:                  hook.afterAddLiquidity,
      beforeRemoveLiquidity:              hook.beforeRemoveLiquidity,
      afterRemoveLiquidity:               hook.afterRemoveLiquidity,
      beforeSwap:                         hook.beforeSwap,
      afterSwap:                          hook.afterSwap,
      beforeDonate:                       hook.beforeDonate,
      afterDonate:                        hook.afterDonate,
      beforeSwapReturnsDelta:             hook.beforeSwapReturnsDelta,
      afterSwapReturnsDelta:              hook.afterSwapReturnsDelta,
      afterAddLiquidityReturnsDelta:      hook.afterAddLiquidityReturnsDelta,
      afterRemoveLiquidityReturnsDelta:   hook.afterRemoveLiquidityReturnsDelta,
    };

    const generatedName = generateHookName(flags);
    const description = generateHookDescription(flags);

    await prisma.hook.update({
      where: { id: hook.id },
      data: {
        name: generatedName,
        // Only set description if currently null (don't overwrite real descriptions)
        ...(description && !hook.isVerified ? { description } : {}),
      },
    });

    named++;
    nameCounts[generatedName] = (nameCounts[generatedName] ?? 0) + 1;
  }

  console.log(`✅ Named: ${named} hooks`);
  console.log(`   Skipped (already have real name): ${skipped}`);

  console.log(`\n  Distribution of generated names:`);
  const sorted = Object.entries(nameCounts).sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sorted) {
    const bar = "█".repeat(Math.min(Math.round(count / 20), 30));
    console.log(`  ${name.padEnd(34)} ${bar} ${count}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});