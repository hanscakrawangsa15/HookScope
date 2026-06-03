import type { Address } from "viem";
import { z } from "zod";

// ─── Chain support ────────────────────────────────────────────────────────────

export const SUPPORTED_CHAINS = {
  ethereum: 1,
  base: 8453,
  arbitrum: 42161,
  optimism: 10,
  sepolia: 11155111,
  baseSepolia: 84532,
} as const;

export type ChainId = (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS];

// ─── Hook Callback Flags ──────────────────────────────────────────────────────

export interface HookCallbackFlags {
  beforeInitialize: boolean;
  afterInitialize: boolean;
  beforeAddLiquidity: boolean;
  afterAddLiquidity: boolean;
  beforeRemoveLiquidity: boolean;
  afterRemoveLiquidity: boolean;
  beforeSwap: boolean;
  afterSwap: boolean;
  beforeDonate: boolean;
  afterDonate: boolean;
  beforeSwapReturnsDelta: boolean;
  afterSwapReturnsDelta: boolean;
  afterAddLiquidityReturnsDelta: boolean;
  afterRemoveLiquidityReturnsDelta: boolean;
}

export const EMPTY_CALLBACKS: HookCallbackFlags = {
  beforeInitialize: false,
  afterInitialize: false,
  beforeAddLiquidity: false,
  afterAddLiquidity: false,
  beforeRemoveLiquidity: false,
  afterRemoveLiquidity: false,
  beforeSwap: false,
  afterSwap: false,
  beforeDonate: false,
  afterDonate: false,
  beforeSwapReturnsDelta: false,
  afterSwapReturnsDelta: false,
  afterAddLiquidityReturnsDelta: false,
  afterRemoveLiquidityReturnsDelta: false,
};

// ─── Risk / Security ──────────────────────────────────────────────────────────

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";
export type AuditStatus = "AUDITED" | "UNAUDITED" | "FLAGGED" | "IN_PROGRESS";
export type ProxyType =
  | "NONE"
  | "EIP1967"
  | "EIP1822"
  | "MINIMAL_PROXY"
  | "CUSTOM"
  | "UNKNOWN";

export interface SecurityFlag {
  category: string;
  severity: RiskLevel;
  description: string;
  location?: string;
}

// ─── Hook entities ────────────────────────────────────────────────────────────

export interface HookFunction {
  name: string;
  signature: string;
  selector: string;
  params: FunctionParam[];
  returns: FunctionParam[];
  visibility: "public" | "external" | "internal" | "private";
  stateMutability: "pure" | "view" | "payable" | "nonpayable";
  natspec?: string;
}

export interface FunctionParam {
  name: string;
  type: string;
}

export interface HookSummary {
  address: Address;
  name: string | null;
  description: string | null;
  chainId: number;
  deployedAt: Date | null;
  deployer: Address | null;
  isVerified: boolean;
  proxyType: ProxyType;
  implementationAddress: Address | null;
  callbacks: HookCallbackFlags;
  riskLevel: RiskLevel;
  hookScore: number | null;
  auditStatus: AuditStatus;
  tvlUsd: number | null;
  poolCount: number;
}

export interface HookDetail extends HookSummary {
  bytecodeHash: string | null;
  abi: unknown[] | null;
  sourceFiles: SourceFile[] | null;
  functions: HookFunction[];
  securityFlags: SecurityFlag[];
  auditReports: AuditReport[];
  analytics: HookAnalytics | null;
  pools: PoolSummary[];
  similarHooks: HookSummary[];
}

export interface SourceFile {
  name: string;
  content: string;
  language: "solidity" | "yul";
}

export interface AuditReport {
  auditor: string;
  reportUrl: string;
  auditDate: Date;
  summary: string | null;
}

export interface HookAnalytics {
  tvlUsd: number;
  volume7dUsd: number;
  volume30dUsd: number;
  poolCount: number;
  uniqueLps: number;
  updatedAt: Date;
}

export interface PoolSummary {
  poolId: string;
  token0: TokenInfo;
  token1: TokenInfo;
  feeTier: number;
  tickSpacing: number;
  tvlUsd: number | null;
  chainId: number;
}

export interface TokenInfo {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
}

// ─── API request/response schemas ─────────────────────────────────────────────

export const HookListQuerySchema = z.object({
  q: z.string().optional(),
  chain: z.coerce.number().optional(),
  auditStatus: z.enum(["AUDITED", "UNAUDITED", "FLAGGED"]).optional(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  callbacks: z.string().optional(), // comma-separated callback names
  sortBy: z
    .enum(["tvl", "newest", "riskScore", "poolCount"])
    .default("newest"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export type HookListQuery = z.infer<typeof HookListQuerySchema>;

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
