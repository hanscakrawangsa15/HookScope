import { type PublicClient, type Address, keccak256, toHex } from "viem";
import { FOURBYTE_API } from "@hookscope/shared";

export interface BytecodeAnalysisResult {
  bytecodeHash: string | null;
  functionSelectors: SelectorInfo[];
  hasSelfdestruct: boolean;
  hasDelegatecall: boolean;
  hasCreate: boolean;
  hasCreate2: boolean;
  hasStaticCall: boolean;
  estimatedFunctionCount: number;
  isEmpty: boolean;
}

export interface SelectorInfo {
  selector: string;      // 4-byte hex
  signature: string | null; // resolved from 4byte.directory
  name: string | null;
}

// EVM opcodes
const OPCODE_SELFDESTRUCT = "ff";
const OPCODE_DELEGATECALL = "f4";
const OPCODE_CREATE       = "f0";
const OPCODE_CREATE2      = "f5";
const OPCODE_STATICCALL   = "fa";

/**
 * Performs static analysis on EVM bytecode.
 *
 * This works even when source code is NOT verified on Etherscan.
 * Extracts: function selectors, dangerous opcodes, bytecode fingerprint.
 */
export async function analyzeBytecode(
  client: PublicClient,
  address: Address
): Promise<BytecodeAnalysisResult> {
  const bytecode = await client.getBytecode({ address });

  if (!bytecode || bytecode === "0x") {
    return emptyResult();
  }

  const hex = bytecode.slice(2).toLowerCase();
  const bytecodeHash = keccak256(bytecode);

  const hasSelfdestruct = hex.includes(OPCODE_SELFDESTRUCT);
  const hasDelegatecall = hex.includes(OPCODE_DELEGATECALL);
  const hasCreate       = containsOpcode(hex, OPCODE_CREATE);
  const hasCreate2      = hex.includes(OPCODE_CREATE2);
  const hasStaticCall   = hex.includes(OPCODE_STATICCALL);

  const functionSelectors = extractFunctionSelectors(hex);
  const resolvedSelectors = await resolveSelectors(functionSelectors);

  return {
    bytecodeHash,
    functionSelectors: resolvedSelectors,
    hasSelfdestruct,
    hasDelegatecall,
    hasCreate,
    hasCreate2,
    hasStaticCall,
    estimatedFunctionCount: functionSelectors.length,
    isEmpty: false,
  };
}

/**
 * Extracts 4-byte function selectors from bytecode by looking for the
 * dispatcher pattern: PUSH4 <selector> ... EQ
 *
 * This is a well-known technique: Solidity always generates a function
 * dispatcher that does PUSH4 selector / CALLDATALOAD / EQ for each function.
 */
function extractFunctionSelectors(hex: string): string[] {
  const selectors = new Set<string>();

  // Pattern: 63 (PUSH4) followed by 4-byte selector, followed eventually by 14 (EQ)
  // We scan for all PUSH4 occurrences
  for (let i = 0; i < hex.length - 10; i += 2) {
    const opcode = hex.slice(i, i + 2);
    if (opcode === "63") {
      // PUSH4: next 4 bytes are the pushed value
      const selector = hex.slice(i + 2, i + 10);
      if (selector.length === 8) {
        // Validate: should look like a real selector (not all zeros, not all ff)
        if (selector !== "00000000" && selector !== "ffffffff") {
          selectors.add("0x" + selector);
        }
      }
    }
  }

  // Known Uniswap v4 Hook callback selectors
  const HOOK_SELECTORS: Record<string, string> = {
    "0x82704b91": "beforeInitialize(address,PoolKey,uint160)",
    "0x439cef89": "afterInitialize(address,PoolKey,uint160,int24)",
    "0xc0c95e6b": "beforeAddLiquidity(address,PoolKey,ModifyLiquidityParams,bytes)",
    "0x4d31a829": "afterAddLiquidity(address,PoolKey,ModifyLiquidityParams,BalanceDelta,BalanceDelta,bytes)",
    "0x0ef73e0c": "beforeRemoveLiquidity(address,PoolKey,ModifyLiquidityParams,bytes)",
    "0xf54cf2a4": "afterRemoveLiquidity(address,PoolKey,ModifyLiquidityParams,BalanceDelta,BalanceDelta,bytes)",
    "0x07749a79": "beforeSwap(address,PoolKey,SwapParams,bytes)",
    "0x80ce5cc5": "afterSwap(address,PoolKey,SwapParams,BalanceDelta,bytes)",
    "0x2cd72c7a": "beforeDonate(address,PoolKey,uint256,uint256,bytes)",
    "0x4afaf4ae": "afterDonate(address,PoolKey,uint256,uint256,bytes)",
  };

  // Add known hook selectors even if not found (sanity check)
  // They'll show up from flag decode anyway; this is for verification
  for (const sel of Object.keys(HOOK_SELECTORS)) {
    if (hex.includes(sel.slice(2))) {
      selectors.add(sel);
    }
  }

  return [...selectors];
}

/** Resolves function selectors to human-readable signatures via 4byte.directory. */
async function resolveSelectors(selectors: string[]): Promise<SelectorInfo[]> {
  const results: SelectorInfo[] = [];

  // Batch resolve up to 50 selectors, rest left as unknown
  const toResolve = selectors.slice(0, 50);

  for (const selector of toResolve) {
    const info = await resolveSelector(selector);
    results.push(info);
  }

  // Add remaining without resolution
  for (const selector of selectors.slice(50)) {
    results.push({ selector, signature: null, name: null });
  }

  return results;
}

const selectorCache = new Map<string, SelectorInfo>();

async function resolveSelector(selector: string): Promise<SelectorInfo> {
  if (selectorCache.has(selector)) {
    return selectorCache.get(selector)!;
  }

  try {
    const res = await fetch(`${FOURBYTE_API}?hex_signature=${selector}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as {
      results: Array<{ text_signature: string }>;
    };

    if (data.results?.[0]) {
      const sig = data.results[0].text_signature;
      const name = sig.split("(")[0] ?? null;
      const info: SelectorInfo = { selector, signature: sig, name };
      selectorCache.set(selector, info);
      return info;
    }
  } catch {
    // 4byte lookup failure is non-fatal
  }

  const info: SelectorInfo = { selector, signature: null, name: null };
  selectorCache.set(selector, info);
  return info;
}

function containsOpcode(hex: string, opcode: string): boolean {
  // Simple substring check — not perfect (could be in PUSH data) but sufficient for heuristics
  for (let i = 0; i < hex.length; i += 2) {
    if (hex.slice(i, i + 2) === opcode) return true;
  }
  return false;
}

function emptyResult(): BytecodeAnalysisResult {
  return {
    bytecodeHash: null,
    functionSelectors: [],
    hasSelfdestruct: false,
    hasDelegatecall: false,
    hasCreate: false,
    hasCreate2: false,
    hasStaticCall: false,
    estimatedFunctionCount: 0,
    isEmpty: true,
  };
}
