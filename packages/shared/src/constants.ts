import type { Address } from "viem";

// ─── Uniswap v4 Contract Addresses ───────────────────────────────────────────

// NOTE (found while building the LP feature, not yet fixed — has indexer ripple
// effects so needs a deliberate separate decision): the Base Sepolia entry below
// does NOT match developers.uniswap.org/contracts/v4/deployments, which lists
// 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408 instead. Mainnet/Arbitrum/Optimism/
// Sepolia entries were re-verified against the same source and are correct.
export const POOL_MANAGER_ADDRESSES: Record<number, Address> = {
  1: "0x000000000004444c5dc75cB358380D2e3dE08A90",       // Ethereum Mainnet
  8453: "0x498581fF718922c3f8e6A244956aF099B2652b2b",    // Base
  42161: "0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32",  // Arbitrum One
  10: "0x9a13F98Cb987694C9F086b1F5eB990Eea8264Ec3",     // Optimism
  11155111: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543", // Sepolia
  84532: "0x7Da1D65F8B249183667cdE74C5CBD46dD38AA829",   // Base Sepolia — likely WRONG, see note above
  // Anvil local fork — mirrors mainnet since `anvil --fork-url <mainnet>` preserves
  // all existing deployments at the same addresses, including every V4 contract.
  31337: "0x000000000004444c5dc75cB358380D2e3dE08A90",  // Anvil (mainnet fork)
};

// StateView — official read-only lens contract for off-chain pool-state reads.
// IMPORTANT: PoolManager itself does NOT expose getSlot0/getLiquidity as callable
// external functions (confirmed directly against v4-core's PoolManager.sol — it
// only inherits Extsload/Exttload; getSlot0/getLiquidity are StateLibrary functions
// meant to be called from within another contract via extsload, not via a plain
// eth_call from off-chain). Calling them directly on PoolManager reverts on every
// chain, including mainnet with a verified-correct address — this is not a wrong-
// address problem, it's the wrong contract. StateView exists specifically to make
// this data callable off-chain. Verified directly: a plain getSlot0 call against
// this Base Sepolia address returns cleanly (no revert) for both real and garbage
// poolIds, unlike calling PoolManager directly.
export const V4_STATE_VIEW_ADDRESSES: Record<number, Address> = {
  1: "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227",       // Ethereum Mainnet
  8453: "0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71",    // Base
  42161: "0x76Fd297e2D437cd7f76d50F01AfE6160f86e9990",   // Arbitrum One
  10: "0xc18a3169788F4F75A170290584ECA6395C75Ecdb",      // Optimism
  11155111: "0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C", // Sepolia
  84532: "0x571291b572ed32ce6751a2Cb2486EbEe8DEfB9B4",    // Base Sepolia
  31337: "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227",   // Anvil (mainnet fork)
};

export const V4_STATE_VIEW_ABI = [
  {
    type: "function", name: "getSlot0", stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
  {
    type: "function", name: "getLiquidity", stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ name: "liquidity", type: "uint128" }],
  },
] as const;

// V4Quoter — read-only quote simulation contract. Cross-checked against block
// explorers for every chain except Arbitrum (explorer blocked fetches from
// this environment; single-sourced from developers.uniswap.org). Wrong address
// here just fails a quote loudly — no fund-loss risk, unlike Router/Permit2,
// which are resolved via the official SDKs at call time instead of hardcoded.
export const V4_QUOTER_ADDRESSES: Record<number, Address> = {
  1: "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203",       // Ethereum Mainnet
  8453: "0x0d5e0F971ED27FBfF6c2837bf31316121532048D",    // Base
  42161: "0x3972C00f7ed4885e145823eb7C655375d275A1C5",   // Arbitrum One
  10: "0x1f3131A13296FB91C90870043742C3CDBFF1A8d7",      // Optimism
  11155111: "0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227", // Sepolia
  84532: "0x4A6513c898fe1B2d0E78d3b0e0A4a151589B1cBa",    // Base Sepolia
  31337: "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203",   // Anvil (mainnet fork)
};

export const V4_QUOTER_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" },
            ],
          },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
  // Errors the Quoter can revert with — most commonly hit on illiquid/uninitialized pools.
  { type: "error", name: "NotEnoughLiquidity", inputs: [{ name: "poolId", type: "bytes32" }] },
  { type: "error", name: "PoolNotInitialized", inputs: [] },
  { type: "error", name: "UnexpectedRevertBytes", inputs: [{ name: "revertData", type: "bytes" }] },
] as const;

// V4PositionManager — mints/manages liquidity positions (ERC-721). Unlike Universal
// Router, the SDK does not export a canonical address lookup for this, so these were
// verified manually against developers.uniswap.org/contracts/v4/deployments and
// cross-checked via block explorer for Sepolia/Base Sepolia (confirmed verified
// contracts named "PositionManager" with modifyLiquidities/initializePool in their ABI
// and a "Uniswap v4 Positions NFT" token-tracker label). Mainnet/Arbitrum/Optimism
// entries are docs-only — same lower-confidence caveat as V4_QUOTER_ADDRESSES's
// Arbitrum entry. Re-run every address through viem's getAddress() before editing.
export const V4_POSITION_MANAGER_ADDRESSES: Record<number, Address> = {
  1: "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",       // Ethereum Mainnet
  8453: "0x7C5f5A4bBd8fD63184577525326123B519429bDc",   // Base
  42161: "0xd88F38F930b7952f2DB2432Cb002E7abbF3dD869",  // Arbitrum One
  10: "0x3C3Ea4B57a46241e54610e5f022E5c45859A1017",      // Optimism
  11155111: "0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4", // Sepolia
  84532: "0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80",    // Base Sepolia
  31337: "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",   // Anvil (mainnet fork)
};

// ─── Orca Whirlpool (Solana) ──────────────────────────────────────────────────
// The on-chain program address for Orca's concentrated-liquidity AMM — same
// value used as the indexed "Hook" address for this Solana program. Used to
// distinguish it from the other 13 indexed Solana DEX programs, which don't
// have native LP support yet.
export const ORCA_WHIRLPOOL_PROGRAM_ID = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";

// ─── Raydium CLMM (Solana) ────────────────────────────────────────────────────
// The on-chain program address for Raydium's concentrated-liquidity AMM — same
// value used as the indexed "Hook" address for this Solana program. Distinct
// from "Raydium AMM v4" (a separate, unindexed program with no real pools).
export const RAYDIUM_CLMM_PROGRAM_ID = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";

// ─── Raydium AMM v4 / CPMM (Solana) ───────────────────────────────────────────
// Constant-product (non-concentrated) Raydium AMMs — distinct programs from
// Raydium CLMM above. Both now have real indexed pools via the v3 pools API.
export const RAYDIUM_AMM_V4_PROGRAM_ID = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
export const RAYDIUM_CPMM_PROGRAM_ID = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";

// ─── Uniswap v4 Tick Bounds ───────────────────────────────────────────────────
// Invariant network-wide constants (not deployment addresses) — safe to hardcode.
// v4-sdk does not re-export these (they live in v3-sdk, a transitive-only dep we
// don't want as a phantom direct dependency).
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

export function nearestUsableTick(tick: number, tickSpacing: number): number {
  const rounded = Math.round(tick / tickSpacing) * tickSpacing;
  if (rounded < MIN_TICK) return Math.ceil(MIN_TICK / tickSpacing) * tickSpacing;
  if (rounded > MAX_TICK) return Math.floor(MAX_TICK / tickSpacing) * tickSpacing;
  return rounded;
}

// ─── PositionManager Event ABI ────────────────────────────────────────────────
// V4's PositionManager is an ERC-721. It emits no custom "MintPosition" event —
// verified directly against the compiled positionManagerAbi in @uniswap/v4-sdk;
// the only event relevant to "what tokenId did I just mint" is the standard
// ERC721 Transfer, where from == address(0) signals a mint.
export const POSITION_MANAGER_TRANSFER_ABI = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "id", type: "uint256", indexed: true },
    ],
  },
] as const;

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
