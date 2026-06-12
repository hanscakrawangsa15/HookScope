import type { Address } from "viem";

// ─── Uniswap v4 Contract Addresses ───────────────────────────────────────────

export const POOL_MANAGER_ADDRESSES: Record<number, Address> = {
  1: "0x000000000004444c5dc75cB358380D2e3dE08A90",       // Ethereum Mainnet
  8453: "0x498581fF718922c3f8e6A244956aF099B2652b2b",    // Base
  42161: "0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32",  // Arbitrum One
  10: "0x9a13F98Cb987694C9F086b1F5eB990Eea8264Ec3",     // Optimism
  11155111: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543", // Sepolia
  84532: "0x7Da1D65F8B249183667cdE74C5CBD46dD38AA829",   // Base Sepolia
};

// ─── Hook Callback Bitmask Flags ──────────────────────────────────────────────
// Encoding: lower 14 bits of hook address encode which callbacks are active.
// This is ENFORCED by PoolManager.validateHookPermissions() at pool creation.

export const HOOK_FLAGS = {
  BEFORE_INITIALIZE:                   BigInt(1) << BigInt(13), // 0x2000
  AFTER_INITIALIZE:                    BigInt(1) << BigInt(12), // 0x1000
  BEFORE_ADD_LIQUIDITY:                BigInt(1) << BigInt(11), // 0x0800
  AFTER_ADD_LIQUIDITY:                 BigInt(1) << BigInt(10), // 0x0400
  BEFORE_REMOVE_LIQUIDITY:             BigInt(1) << BigInt(9),  // 0x0200
  AFTER_REMOVE_LIQUIDITY:              BigInt(1) << BigInt(8),  // 0x0100
  BEFORE_SWAP:                         BigInt(1) << BigInt(7),  // 0x0080
  AFTER_SWAP:                          BigInt(1) << BigInt(6),  // 0x0040
  BEFORE_DONATE:                       BigInt(1) << BigInt(5),  // 0x0020
  AFTER_DONATE:                        BigInt(1) << BigInt(4),  // 0x0010
  BEFORE_SWAP_RETURNS_DELTA:           BigInt(1) << BigInt(3),  // 0x0008
  AFTER_SWAP_RETURNS_DELTA:            BigInt(1) << BigInt(2),  // 0x0004
  AFTER_ADD_LIQUIDITY_RETURNS_DELTA:   BigInt(1) << BigInt(1),  // 0x0002
  AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA: BigInt(1) << BigInt(0), // 0x0001
} as const;

export const HOOK_FLAGS_MASK = BigInt(0x3FFF); // 14-bit mask

// ─── Proxy Detection Storage Slots ───────────────────────────────────────────

// EIP-1967: implementation slot
export const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;

// EIP-1967: beacon slot
export const EIP1967_BEACON_SLOT =
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50" as const;

// EIP-1822 (UUPS): proxiable slot
export const EIP1822_PROXIABLE_SLOT =
  "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7" as const;

// EIP-1167 minimal proxy prefix (20-byte target follows)
export const MINIMAL_PROXY_PREFIX = "0x363d3d373d3d3d363d73";
export const MINIMAL_PROXY_SUFFIX = "0x5af43d82803e903d91602b57fd5bf3";

// ─── PoolManager Event ABIs ───────────────────────────────────────────────────

export const POOL_MANAGER_ABI = [
  {
    type: "event",
    name: "Initialize",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "currency0", type: "address", indexed: true },
      { name: "currency1", type: "address", indexed: true },
      { name: "fee", type: "uint24", indexed: false },
      { name: "tickSpacing", type: "int24", indexed: false },
      { name: "hooks", type: "address", indexed: false },
      { name: "sqrtPriceX96", type: "uint160", indexed: false },
      { name: "tick", type: "int24", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Swap",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "amount0", type: "int128", indexed: false },
      { name: "amount1", type: "int128", indexed: false },
      { name: "sqrtPriceX96", type: "uint160", indexed: false },
      { name: "liquidity", type: "uint128", indexed: false },
      { name: "tick", type: "int24", indexed: false },
      { name: "fee", type: "uint24", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ModifyLiquidity",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "tickLower", type: "int24", indexed: false },
      { name: "tickUpper", type: "int24", indexed: false },
      { name: "liquidityDelta", type: "int256", indexed: false },
      { name: "salt", type: "bytes32", indexed: false },
    ],
  },
] as const;

// ─── Etherscan-compatible API base URLs (V2 where applicable) ────────────────
// Etherscan V2: single endpoint, requires chainid= param.
// Chain-specific explorers (Basescan, Arbiscan) still use their own endpoints.

export const EXPLORER_API_URLS: Record<number, string> = {
  1:        "https://api.etherscan.io/v2/api?chainid=1",
  8453:     "https://api.basescan.org/api",
  42161:    "https://api.arbiscan.io/api",
  10:       "https://api-optimistic.etherscan.io/api",
  11155111: "https://api.etherscan.io/v2/api?chainid=11155111",
  84532:    "https://api-sepolia.basescan.org/api",
};

// ─── 4byte.directory for selector lookup ─────────────────────────────────────

export const FOURBYTE_API = "https://www.4byte.directory/api/v1/signatures/";
