"use client";

import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { SolanaAdapter } from "@reown/appkit-adapter-solana";
import { mainnet, arbitrum, base, optimism, solana, sepolia, baseSepolia, defineChain } from "@reown/appkit/networks";
import type { AppKitNetwork } from "@reown/appkit/networks";

const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID!;

// Anvil — local fork of Ethereum mainnet for dev/testing. Start with:
//   anvil --fork-url $ETHEREUM_RPC_URL
// All Uniswap v4 contracts (PoolManager, StateView, PositionManager, Quoter)
// are already deployed at the same mainnet addresses on the fork — no extra
// setup needed for EVM contracts. Run `pnpm anvil:setup` to deploy test tokens
// and create a sample pool, then use `pnpm anvil:test` to verify transactions.
const anvilLocal: AppKitNetwork = defineChain({
  id: 31337,
  chainNamespace: "eip155",
  caipNetworkId: "eip155:31337",
  name: "Anvil Local Fork",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
  },
  testnet: true,
});

// Sepolia + Base Sepolia are here for the Swap feature's testnet-first rollout —
// real on-chain Uniswap v4 swaps are only enabled on these two chains for now.
// Anvil is last so it only appears in the wallet switcher if the user has it
// running locally (WalletConnect filters unreachable chains gracefully).
const networks: [AppKitNetwork, ...AppKitNetwork[]] = [mainnet, arbitrum, base, optimism, solana, sepolia, baseSepolia, anvilLocal];

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  // Without this, wagmi reads persisted connection state from localStorage
  // synchronously on first render, which differs from the server-rendered
  // HTML (no localStorage) and triggers React hydration mismatches.
  ssr: true,
});

export const appKit = createAppKit({
  adapters: [wagmiAdapter, new SolanaAdapter()],
  networks,
  projectId,
  // Don't auto-pop a "Switch Network" modal when the wallet is on a chain
  // that isn't in the supported list (e.g. a chain the user is just browsing
  // from, or a mainnet chain while viewing a Solana hook). HookScope is a
  // read-heavy explorer — most pages work without any active wallet at all,
  // and forcing a chain switch every page load is disruptive.
  allowUnsupportedChain: true,
  metadata: {
    name: "HookScope",
    description: "Uniswap v4 Hook Transparency Platform",
    url: "https://hookscope.app",
    icons: ["/favicon.ico"],
  },
  features: {
    analytics: false,
    email: false,
    socials: false,
    swaps: false,
    onramp: false,
    legalCheckbox: false,
  },
});
