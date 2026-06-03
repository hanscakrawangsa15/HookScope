import {
  createPublicClient,
  http,
  type PublicClient,
  type Chain,
} from "viem";
import {
  mainnet,
  base,
  arbitrum,
  optimism,
  sepolia,
  baseSepolia,
} from "viem/chains";
import { POOL_MANAGER_ADDRESSES } from "@hookscope/shared";

export interface ChainConfig {
  chain: Chain;
  rpcUrl: string;
  poolManagerAddress: `0x${string}`;
  client: PublicClient;
  explorerApiKey?: string;
}

function requireEnv(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

export function buildChainConfigs(): ChainConfig[] {
  const configs: ChainConfig[] = [];

  const addChain = (
    chain: Chain,
    rpcEnvKey: string,
    apiKeyEnv?: string,
    fallbackRpc?: string
  ) => {
    const poolManager = POOL_MANAGER_ADDRESSES[chain.id];
    if (!poolManager) return;

    const rpcUrl = process.env[rpcEnvKey] ?? fallbackRpc;
    if (!rpcUrl) {
      console.warn(`Skipping chain ${chain.name}: no RPC URL (set ${rpcEnvKey})`);
      return;
    }

    configs.push({
      chain,
      rpcUrl,
      poolManagerAddress: poolManager,
      explorerApiKey: apiKeyEnv ? process.env[apiKeyEnv] : undefined,
      client: createPublicClient({
        chain,
        transport: http(rpcUrl, { retryCount: 3, retryDelay: 1000 }),
      }) as PublicClient,
    });
  };

  addChain(mainnet,  "ETHEREUM_RPC_URL",  "ETHERSCAN_API_KEY");
  addChain(base,     "BASE_RPC_URL",      "BASESCAN_API_KEY");
  addChain(arbitrum, "ARBITRUM_RPC_URL",  "ARBISCAN_API_KEY");
  addChain(optimism, "OPTIMISM_RPC_URL",  "OPTIMISTIC_ETHERSCAN_API_KEY");
  addChain(sepolia,  "SEPOLIA_RPC_URL",   "ETHERSCAN_API_KEY",
    "https://rpc.sepolia.org");
  addChain(baseSepolia, "BASE_SEPOLIA_RPC_URL", "BASESCAN_API_KEY",
    "https://sepolia.base.org");

  return configs;
}
