const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export interface HookSummary {
  id: string;
  address: string;
  chainId: number;
  name: string | null;
  description: string | null;
  deployedAt: string | null;
  deployer: string | null;
  isVerified: boolean;
  proxyType: string;
  callbacks: Record<string, boolean>;
  riskLevel: string;
  hookScore: number | null;
  auditStatus: string;
  tvlUsd: number | null;
  poolCount: number;
}

export interface HookDetail extends HookSummary {
  bytecodeHash: string | null;
  implementationAddress: string | null;
  functions: HookFunction[];
  sourceFiles: { name: string; language: string }[];
  securityFlags: SecurityFlag[];
  auditRecords: AuditRecord[];
  analytics: HookAnalytics | null;
  similarHooks: HookSummary[];
}

export interface HookFunction {
  id: string;
  name: string;
  signature: string;
  selector: string;
  params: Array<{ name: string; type: string }>;
  returns: Array<{ name: string; type: string }>;
  visibility: string;
  stateMutability: string;
  natspec: string | null;
  isCallback: boolean;
}

export interface SecurityFlag {
  id: string;
  category: string;
  severity: string;
  description: string;
  location: string | null;
  source: string;
  reportedBy: string | null;
}

export interface AuditRecord {
  id: string;
  auditor: string;
  reportUrl: string | null;
  auditDate: string;
  summary: string | null;
}

export interface HookAnalytics {
  tvlUsd: number;
  volume7dUsd: number;
  volume30dUsd: number;
  poolCount: number;
  uniqueLps: number;
  updatedAt: string;
}

export interface PaginatedHooks {
  data: HookSummary[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface TopHookEntry {
  address: string;
  name: string | null;
  chainId: number;
  riskLevel: string;
  hookScore: number | null;
  tvlUsd: number;
  poolCount: number;
  swapCount: number;
  volume7dUsd: number;
  volume30dUsd: number;
}

export interface GlobalStats {
  totalHooks: number;
  verifiedHooks: number;
  unverifiedHooks: number;
  auditedHooks: number;
  flaggedHooks: number;
  totalPools: number;
  hooksByChain: Record<string, number>;
  hooksByRisk: Record<string, number>;
  recentHooks: Array<{ address: string; name: string | null; chainId: number; deployedAt: string | null; hookScore: number | null }>;
  topByTvl: TopHookEntry[];
  topByActivity: TopHookEntry[];
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    next: { revalidate: 30 },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  hooks: {
    list: (params?: Record<string, string | number>) => {
      const qs = params ? "?" + new URLSearchParams(
        Object.fromEntries(
          Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])
        )
      ) : "";
      return apiFetch<PaginatedHooks>(`/api/hooks${qs}`);
    },
    get: (address: string, chainId?: number) => {
      const qs = chainId ? `?chainId=${chainId}` : "";
      return apiFetch<HookDetail>(`/api/hooks/${address}${qs}`);
    },
    source: (address: string) =>
      apiFetch<{ isVerified: boolean; sourceFiles: Array<{ name: string; content: string; language: string }> }>(
        `/api/hooks/${address}/source`
      ),
    security: (address: string) =>
      apiFetch<{ hookScore: number; riskLevel: string; flags: SecurityFlag[] }>(
        `/api/hooks/${address}/security`
      ),
    pools: (address: string, page = 1) =>
      apiFetch<{ data: unknown[]; total: number }>(`/api/hooks/${address}/pools?page=${page}`),
    compare: (addresses: string[]) =>
      apiFetch<HookDetail[]>(`/api/hooks/compare?addresses=${addresses.join(",")}`),
  },
  search: {
    query: (q: string, limit = 10) =>
      apiFetch<{ query: string; results: HookSummary[] }>(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`),
    suggestions: (q: string) =>
      apiFetch<Array<{ address: string; name: string | null; chainId: number }>>(
        `/api/search/suggestions?q=${encodeURIComponent(q)}`
      ),
  },
  stats: {
    global: () => apiFetch<GlobalStats>("/api/stats"),
  },
};
