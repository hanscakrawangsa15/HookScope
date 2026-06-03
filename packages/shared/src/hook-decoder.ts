import type { Address } from "viem";
import { HOOK_FLAGS, HOOK_FLAGS_MASK } from "./constants.js";
import type { HookCallbackFlags } from "./types.js";

/**
 * Decodes hook callback flags from a hook address.
 *
 * In Uniswap v4, the lower 14 bits of the hook address deterministically
 * encode which lifecycle callbacks the hook implements. PoolManager validates
 * these flags at pool creation via validateHookPermissions().
 *
 * This means: ALL active callbacks are publicly readable from the address alone,
 * with zero RPC calls required — hooks cannot misrepresent their callbacks.
 */
export function decodeHookFlags(hookAddress: Address): HookCallbackFlags {
  const addr = BigInt(hookAddress);
  const flags = addr & HOOK_FLAGS_MASK;

  return {
    beforeInitialize:                   (flags & HOOK_FLAGS.BEFORE_INITIALIZE) !== BigInt(0),
    afterInitialize:                    (flags & HOOK_FLAGS.AFTER_INITIALIZE) !== BigInt(0),
    beforeAddLiquidity:                 (flags & HOOK_FLAGS.BEFORE_ADD_LIQUIDITY) !== BigInt(0),
    afterAddLiquidity:                  (flags & HOOK_FLAGS.AFTER_ADD_LIQUIDITY) !== BigInt(0),
    beforeRemoveLiquidity:              (flags & HOOK_FLAGS.BEFORE_REMOVE_LIQUIDITY) !== BigInt(0),
    afterRemoveLiquidity:               (flags & HOOK_FLAGS.AFTER_REMOVE_LIQUIDITY) !== BigInt(0),
    beforeSwap:                         (flags & HOOK_FLAGS.BEFORE_SWAP) !== BigInt(0),
    afterSwap:                          (flags & HOOK_FLAGS.AFTER_SWAP) !== BigInt(0),
    beforeDonate:                       (flags & HOOK_FLAGS.BEFORE_DONATE) !== BigInt(0),
    afterDonate:                        (flags & HOOK_FLAGS.AFTER_DONATE) !== BigInt(0),
    beforeSwapReturnsDelta:             (flags & HOOK_FLAGS.BEFORE_SWAP_RETURNS_DELTA) !== BigInt(0),
    afterSwapReturnsDelta:              (flags & HOOK_FLAGS.AFTER_SWAP_RETURNS_DELTA) !== BigInt(0),
    afterAddLiquidityReturnsDelta:      (flags & HOOK_FLAGS.AFTER_ADD_LIQUIDITY_RETURNS_DELTA) !== BigInt(0),
    afterRemoveLiquidityReturnsDelta:   (flags & HOOK_FLAGS.AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA) !== BigInt(0),
  };
}

/** Returns list of active callback names for display. */
export function getActiveCallbackNames(flags: HookCallbackFlags): string[] {
  const active: string[] = [];
  if (flags.beforeInitialize)                 active.push("beforeInitialize");
  if (flags.afterInitialize)                  active.push("afterInitialize");
  if (flags.beforeAddLiquidity)               active.push("beforeAddLiquidity");
  if (flags.afterAddLiquidity)                active.push("afterAddLiquidity");
  if (flags.beforeRemoveLiquidity)            active.push("beforeRemoveLiquidity");
  if (flags.afterRemoveLiquidity)             active.push("afterRemoveLiquidity");
  if (flags.beforeSwap)                       active.push("beforeSwap");
  if (flags.afterSwap)                        active.push("afterSwap");
  if (flags.beforeDonate)                     active.push("beforeDonate");
  if (flags.afterDonate)                      active.push("afterDonate");
  if (flags.beforeSwapReturnsDelta)           active.push("beforeSwapReturnsDelta");
  if (flags.afterSwapReturnsDelta)            active.push("afterSwapReturnsDelta");
  if (flags.afterAddLiquidityReturnsDelta)    active.push("afterAddLiquidityReturnsDelta");
  if (flags.afterRemoveLiquidityReturnsDelta) active.push("afterRemoveLiquidityReturnsDelta");
  return active;
}

/** Returns the raw bitmask value from the address. */
export function extractFlagsBitmask(hookAddress: Address): number {
  return Number(BigInt(hookAddress) & HOOK_FLAGS_MASK);
}

/** Checks if an address has any hook flags set (i.e., is actually a hook). */
export function isHookAddress(address: Address): boolean {
  return (BigInt(address) & HOOK_FLAGS_MASK) !== BigInt(0);
}

/** Checks if address is a known no-op (zero address or no flags). */
export function isNoOpHook(address: Address): boolean {
  return address === "0x0000000000000000000000000000000000000000" ||
    !isHookAddress(address);
}

/**
 * Detects if a hook uses delta returns (custom accounting).
 * Hooks using delta returns can manipulate token flows non-standardly —
 * this is a higher-risk pattern worth flagging.
 */
export function usesDeltaReturns(flags: HookCallbackFlags): boolean {
  return (
    flags.beforeSwapReturnsDelta ||
    flags.afterSwapReturnsDelta ||
    flags.afterAddLiquidityReturnsDelta ||
    flags.afterRemoveLiquidityReturnsDelta
  );
}

/** Callback risk scoring — delta returns and full swap control raise risk. */
export function callbackRiskScore(flags: HookCallbackFlags): number {
  let score = 0;
  if (flags.beforeSwap || flags.afterSwap)               score += 20;
  if (flags.beforeSwapReturnsDelta)                       score += 25; // can intercept fees
  if (flags.afterSwapReturnsDelta)                        score += 20;
  if (flags.beforeRemoveLiquidity || flags.afterRemoveLiquidity) score += 15;
  if (flags.afterAddLiquidityReturnsDelta)                score += 10;
  if (flags.afterRemoveLiquidityReturnsDelta)             score += 15;
  if (flags.beforeInitialize || flags.afterInitialize)    score += 5;
  if (flags.beforeAddLiquidity || flags.afterAddLiquidity) score += 10;
  if (flags.beforeDonate || flags.afterDonate)            score += 5;
  return Math.min(score, 100);
}
