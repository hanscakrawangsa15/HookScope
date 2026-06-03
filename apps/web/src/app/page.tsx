import { Suspense } from "react";
import { api } from "@/lib/api";
import { HookCard } from "@/components/hooks/hook-card";
import { SearchBar } from "@/components/hooks/search-bar";
import { RiskBadge } from "@/components/ui/risk-badge";
import { formatTvl } from "@/lib/utils";
import Link from "next/link";
import { Filter, Grid, List } from "lucide-react";

interface PageProps {
  searchParams: {
    q?: string;
    chain?: string;
    auditStatus?: string;
    riskLevel?: string;
    callbacks?: string;
    sortBy?: string;
    view?: "grid" | "list";
    page?: string;
  };
}

export default async function ExplorerPage({ searchParams }: PageProps) {
  const params: Record<string, string | number> = {
    limit: 24,
    page: Number(searchParams.page ?? 1),
    sortBy: searchParams.sortBy ?? "newest",
  };

  if (searchParams.q)           params.q = searchParams.q;
  if (searchParams.chain)       params.chain = Number(searchParams.chain);
  if (searchParams.auditStatus) params.auditStatus = searchParams.auditStatus;
  if (searchParams.riskLevel)   params.riskLevel = searchParams.riskLevel;
  if (searchParams.callbacks)   params.callbacks = searchParams.callbacks;

  const [hooksData, stats] = await Promise.allSettled([
    api.hooks.list(params),
    api.stats.global(),
  ]);

  const hooks = hooksData.status === "fulfilled" ? hooksData.value : { data: [], total: 0, totalPages: 0, page: 1, limit: 24 };
  const globalStats = stats.status === "fulfilled" ? stats.value : null;
  const view = searchParams.view ?? "grid";

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Hero */}
      <div className="text-center mb-10">
        <h1 className="text-4xl font-bold text-white mb-3">
          🔍 Hook<span className="text-blue-400">Scope</span>
        </h1>
        <p className="text-gray-400 text-lg max-w-2xl mx-auto">
          Full transparency for every Uniswap v4 Hook — including unverified and proxy contracts.
        </p>

        {globalStats && (
          <div className="flex justify-center gap-6 mt-6 text-sm">
            <Stat label="Hooks Indexed" value={globalStats.totalHooks.toLocaleString()} />
            <Stat label="Pools" value={globalStats.totalPools.toLocaleString()} />
            <Stat label="Verified" value={globalStats.verifiedHooks.toLocaleString()} />
            <Stat label="Audited" value={globalStats.auditedHooks.toLocaleString()} />
          </div>
        )}
      </div>

      {/* Search */}
      <SearchBar defaultValue={searchParams.q} className="mb-6 max-w-3xl mx-auto" />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <FilterBar searchParams={searchParams} />

        <div className="ml-auto flex items-center gap-2">
          <Link
            href={`?${new URLSearchParams({ ...searchParams, view: "grid" })}`}
            className={`p-2 rounded-lg transition-colors ${view === "grid" ? "bg-white/10 text-white" : "text-gray-500 hover:text-white"}`}
          >
            <Grid size={16} />
          </Link>
          <Link
            href={`?${new URLSearchParams({ ...searchParams, view: "list" })}`}
            className={`p-2 rounded-lg transition-colors ${view === "list" ? "bg-white/10 text-white" : "text-gray-500 hover:text-white"}`}
          >
            <List size={16} />
          </Link>
        </div>
      </div>

      {/* Results header */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-400">
          {hooks.total.toLocaleString()} hook{hooks.total !== 1 ? "s" : ""} found
          {searchParams.q ? ` for "${searchParams.q}"` : ""}
        </p>
        <SortSelect current={searchParams.sortBy ?? "newest"} searchParams={searchParams} />
      </div>

      {/* Hooks grid/list */}
      {hooks.data.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <p className="text-4xl mb-4">🪝</p>
          <p>No hooks found. Try different filters.</p>
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {hooks.data.map((hook) => (
            <HookCard key={`${hook.address}-${hook.chainId}`} hook={hook} view="grid" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {hooks.data.map((hook) => (
            <HookCard key={`${hook.address}-${hook.chainId}`} hook={hook} view="list" />
          ))}
        </div>
      )}

      {/* Pagination */}
      {hooks.totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-10">
          {hooks.page > 1 && (
            <Link
              href={`?${new URLSearchParams({ ...searchParams, page: String(hooks.page - 1) })}`}
              className="btn-ghost px-4 py-2"
            >
              ← Previous
            </Link>
          )}
          <span className="flex items-center px-4 text-sm text-gray-400">
            Page {hooks.page} of {hooks.totalPages}
          </span>
          {hooks.page < hooks.totalPages && (
            <Link
              href={`?${new URLSearchParams({ ...searchParams, page: String(hooks.page + 1) })}`}
              className="btn-ghost px-4 py-2"
            >
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-gray-500 text-xs">{label}</p>
    </div>
  );
}

function FilterBar({ searchParams }: { searchParams: PageProps["searchParams"] }) {
  const CHAINS = [
    { id: 1, name: "Ethereum" },
    { id: 8453, name: "Base" },
    { id: 42161, name: "Arbitrum" },
    { id: 10, name: "Optimism" },
  ];

  const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const AUDIT_STATUSES = ["AUDITED", "UNAUDITED", "FLAGGED"];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Filter size={14} className="text-gray-500" />

      {/* Chain filter */}
      {CHAINS.map((chain) => {
        const active = searchParams.chain === String(chain.id);
        return (
          <Link
            key={chain.id}
            href={`?${new URLSearchParams({
              ...searchParams,
              chain: active ? "" : String(chain.id),
              page: "1",
            })}`}
            className={`badge ${active ? "bg-blue-500/20 text-blue-300 border-blue-500/30" : "bg-white/5 text-gray-400 border-white/10 hover:border-white/20"}`}
          >
            {chain.name}
          </Link>
        );
      })}

      <div className="w-px h-4 bg-white/10 mx-1" />

      {/* Risk filter */}
      {RISK_LEVELS.map((level) => {
        const active = searchParams.riskLevel === level;
        return (
          <Link
            key={level}
            href={`?${new URLSearchParams({
              ...searchParams,
              riskLevel: active ? "" : level,
              page: "1",
            })}`}
          >
            <RiskBadge level={level} />
          </Link>
        );
      })}

      {/* Audit status */}
      {AUDIT_STATUSES.map((status) => {
        const active = searchParams.auditStatus === status;
        return (
          <Link
            key={status}
            href={`?${new URLSearchParams({
              ...searchParams,
              auditStatus: active ? "" : status,
              page: "1",
            })}`}
            className={`badge text-[10px] ${active ? "bg-white/15 text-white border-white/20" : "bg-white/5 text-gray-400 border-white/10"}`}
          >
            {status}
          </Link>
        );
      })}
    </div>
  );
}

function SortSelect({
  current,
  searchParams,
}: {
  current: string;
  searchParams: PageProps["searchParams"];
}) {
  const options = [
    { value: "newest", label: "Newest" },
    { value: "tvl", label: "TVL" },
    { value: "riskScore", label: "Safety Score" },
    { value: "poolCount", label: "Pool Count" },
  ];

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-gray-500">Sort:</span>
      {options.map((opt) => (
        <Link
          key={opt.value}
          href={`?${new URLSearchParams({ ...searchParams, sortBy: opt.value })}`}
          className={`px-2 py-1 rounded text-xs ${current === opt.value ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"}`}
        >
          {opt.label}
        </Link>
      ))}
    </div>
  );
}
