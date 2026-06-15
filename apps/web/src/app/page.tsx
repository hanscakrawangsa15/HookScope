import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import { HookCard } from "@/components/hooks/hook-card";
import { SearchBar } from "@/components/hooks/search-bar";
import { formatTvl, chainName, chainIcon } from "@/lib/utils";
import Link from "next/link";
import { Filter, Grid, List, Zap, Shield, Eye, TrendingUp, Activity, Database } from "lucide-react";
import { TopHooksBar } from "@/components/hooks/top-hooks-bar";

const HeroCanvas = dynamic(
  () => import("@/components/three/hero-canvas").then((m) => ({ default: m.HeroCanvas })),
  { ssr: false }
);

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function buildQS(base: Record<string, string | string[] | undefined>, overrides: Record<string, string | undefined>): string {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s !== undefined && s !== "") merged[k] = s;
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined && v !== "") merged[k] = v;
    else delete merged[k];
  }
  const qs = new URLSearchParams(merged).toString();
  return qs ? `?${qs}` : "";
}

export default async function ExplorerPage({ searchParams }: PageProps) {
  const q          = str(searchParams.q);
  const chain      = str(searchParams.chain);
  const auditStatus = str(searchParams.auditStatus);
  const riskLevel  = str(searchParams.riskLevel);
  const callbacks  = str(searchParams.callbacks);
  const sortBy     = str(searchParams.sortBy) ?? "newest";
  const view       = str(searchParams.view) ?? "grid";
  const page       = Number(str(searchParams.page) ?? "1");

  const params: Record<string, string | number> = { limit: 24, page, sortBy };
  if (q)           params.q = q;
  if (chain)       params.chain = Number(chain);
  if (auditStatus) params.auditStatus = auditStatus;
  if (riskLevel)   params.riskLevel = riskLevel;
  if (callbacks)   params.callbacks = callbacks;

  const [hooksResult, statsResult] = await Promise.allSettled([
    api.hooks.list(params),
    api.stats.global(),
  ]);

  const hooks     = hooksResult.status === "fulfilled"  ? hooksResult.value  : { data: [], total: 0, totalPages: 0, page: 1, limit: 24 };
  const stats     = statsResult.status === "fulfilled"  ? statsResult.value  : null;
  const apiOnline = hooksResult.status === "fulfilled";

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

      {/* ── Hero Section ──────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl mb-10 mt-6"
        style={{ background: "linear-gradient(135deg, rgba(15,21,35,0.95) 0%, rgba(10,12,25,0.98) 100%)", border: "1px solid rgba(59,130,246,0.15)" }}>
        {/* Three.js particle network background */}
        <HeroCanvas />

        {/* Gradient overlays for depth */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: "radial-gradient(ellipse 70% 80% at 50% 50%, transparent 40%, rgba(8,11,18,0.7) 100%)"
        }} />
        <div className="absolute bottom-0 left-0 right-0 h-24 pointer-events-none" style={{
          background: "linear-gradient(to top, rgba(8,11,18,1) 0%, transparent 100%)"
        }} />

        {/* Content */}
        <div className="relative z-10 text-center py-16 px-6">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-6"
            style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.3)", color: "#93c5fd" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Live on-chain data · Ethereum Mainnet
          </div>

          <h1 className="text-5xl sm:text-6xl font-black mb-4 tracking-tight">
            <span className="text-white">Hook</span>
            <span className="gradient-text">Scope</span>
          </h1>
          <p className="text-gray-400 text-lg sm:text-xl max-w-2xl mx-auto mb-8 leading-relaxed">
            Full transparency for <em className="text-gray-200 not-italic">every</em> Uniswap&nbsp;v4 Hook —
            including unverified, proxy, and hidden contracts not shown anywhere else.
          </p>

          {/* Feature pills */}
          <div className="flex flex-wrap justify-center gap-2.5 mb-10">
            <Pill icon={<Eye size={12} />}       text="100% on-chain discovery" color="blue" />
            <Pill icon={<Shield size={12} />}    text="Security scoring"        color="green" />
            <Pill icon={<Zap size={12} />}       text="Proxy detection"         color="yellow" />
            <Pill icon={<TrendingUp size={12} />} text="Live TVL data"           color="purple" />
            <Pill icon={<Activity size={12} />}  text="Threat intel"            color="red" />
          </div>

          {/* Stats strip */}
          {stats && (
            <div className="flex flex-wrap justify-center gap-px rounded-2xl overflow-hidden mx-auto max-w-2xl"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <StatCard label="Hooks Indexed" value={stats.totalHooks} icon={<Database size={15} className="text-blue-400" />} />
              <StatCard label="Pools Tracked" value={stats.totalPools} icon={<Layers15 />} />
              <StatCard label="Verified Source" value={stats.verifiedHooks} icon={<Shield size={15} className="text-green-400" />} />
              <StatCard label="Audited" value={stats.auditedHooks} icon={<Shield size={15} className="text-purple-400" />} />
            </div>
          )}
        </div>
      </div>

      {/* API offline warning */}
      {!apiOnline && (
        <div className="mb-6 p-4 rounded-2xl text-orange-300 text-sm"
          style={{ background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.25)" }}>
          ⚠️ API offline at {process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"} — run <code className="font-mono bg-white/10 px-1.5 py-0.5 rounded">./start.sh</code>
        </div>
      )}

      {/* Top hooks — TVL & activity (only on first unfiltered page) */}
      {stats && !q && !chain && !riskLevel && !auditStatus && page === 1 && (
        <TopHooksBar
          topByTvl={stats.topByTvl ?? []}
          topByActivity={stats.topByActivity ?? []}
        />
      )}

      {/* Filters + view toggle */}
      <div className="flex flex-wrap items-start gap-3 mb-6">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <Filter size={14} className="text-gray-500 flex-shrink-0 mt-1" />
          <FilterChips searchParams={searchParams} />
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Link href={buildQS(searchParams, { view: "grid" })}
            className={`p-2 rounded-lg transition-colors ${view === "grid" ? "bg-white/10 text-white" : "text-gray-500 hover:text-white"}`}>
            <Grid size={15} />
          </Link>
          <Link href={buildQS(searchParams, { view: "list" })}
            className={`p-2 rounded-lg transition-colors ${view === "list" ? "bg-white/10 text-white" : "text-gray-500 hover:text-white"}`}>
            <List size={15} />
          </Link>
        </div>
      </div>

      {/* Result count + sort */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-400">
          {hooks.total.toLocaleString()} hook{hooks.total !== 1 ? "s" : ""}
          {q ? ` for "${q}"` : ""}
        </p>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-600">Sort:</span>
          {(["newest", "tvl", "riskScore", "poolCount"] as const).map((s) => (
            <Link key={s} href={buildQS(searchParams, { sortBy: s })}
              className={`px-2 py-1 rounded ${sortBy === s ? "bg-white/10 text-white" : "text-gray-500 hover:text-white"}`}>
              {s === "newest" ? "Newest" : s === "tvl" ? "TVL" : s === "riskScore" ? "Safety" : "Pools"}
            </Link>
          ))}
        </div>
      </div>

      {/* Hooks grid/list */}
      {hooks.data.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <p className="text-4xl mb-4">🪝</p>
          <p>{apiOnline ? "No hooks found. Try different filters." : "Start the API to see hooks."}</p>
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
            <Link href={buildQS(searchParams, { page: String(hooks.page - 1) })} className="btn-ghost px-4 py-2">← Prev</Link>
          )}
          <span className="flex items-center px-4 text-sm text-gray-400">
            Page {hooks.page} / {hooks.totalPages}
          </span>
          {hooks.page < hooks.totalPages && (
            <Link href={buildQS(searchParams, { page: String(hooks.page + 1) })} className="btn-ghost px-4 py-2">Next →</Link>
          )}
        </div>
      )}
    </div>
  );
}

function Layers15() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-400">
      <polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>
    </svg>
  );
}

function Pill({ icon, text, color }: { icon: ReactNode; text: string; color: string }) {
  const colors: Record<string, string> = {
    blue:   "bg-blue-500/10   text-blue-400   border-blue-500/25",
    green:  "bg-green-500/10  text-green-400  border-green-500/25",
    yellow: "bg-yellow-500/10 text-yellow-400 border-yellow-500/25",
    purple: "bg-purple-500/10 text-purple-400 border-purple-500/25",
    red:    "bg-red-500/10    text-red-400    border-red-500/25",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${colors[color]}`}>
      {icon}{text}
    </span>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="flex-1 min-w-[110px] flex flex-col items-center py-4 px-3" style={{ background: "transparent" }}>
      <div className="flex items-center gap-1.5 mb-1">{icon}</div>
      <p className="text-xl font-bold text-white tabular-nums">{value.toLocaleString()}</p>
      <p className="text-[11px] text-gray-500 mt-0.5 text-center">{label}</p>
    </div>
  );
}

function FilterChips({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const CHAINS   = [{ id: 1, name: "Ethereum" }, { id: 8453, name: "Base" }, { id: 42161, name: "Arbitrum" }, { id: 10, name: "Optimism" }, { id: 1399811149, name: "Solana" }];
  const RISKS    = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const AUDITS   = ["AUDITED", "UNAUDITED", "FLAGGED"];

  const activeChain = str(searchParams.chain);
  const activeRisk  = str(searchParams.riskLevel);
  const activeAudit = str(searchParams.auditStatus);

  return (
    <div className="flex flex-wrap gap-1.5">
      {CHAINS.map((c) => {
        const active = activeChain === String(c.id);
        return (
          <Link key={c.id} href={buildQS(searchParams, { chain: active ? undefined : String(c.id), page: "1" })}
            className={`badge text-xs ${active ? "bg-blue-500/20 text-blue-300 border-blue-500/30" : "bg-white/5 text-gray-400 border-white/10 hover:border-white/20"}`}>
            {chainIcon(c.id)} {c.name}
          </Link>
        );
      })}
      <span className="w-px h-4 bg-white/10 self-center mx-0.5" />
      {RISKS.map((r) => {
        const active = activeRisk === r;
        const color = r === "LOW" ? "text-green-400 border-green-500/30 bg-green-500/10" :
                      r === "MEDIUM" ? "text-yellow-400 border-yellow-500/30 bg-yellow-500/10" :
                      r === "HIGH" ? "text-orange-400 border-orange-500/30 bg-orange-500/10" :
                      "text-red-400 border-red-500/30 bg-red-500/10";
        return (
          <Link key={r} href={buildQS(searchParams, { riskLevel: active ? undefined : r, page: "1" })}
            className={`badge text-[10px] ${active ? color : "bg-white/5 text-gray-500 border-white/10 hover:border-white/20"}`}>
            {r}
          </Link>
        );
      })}
      <span className="w-px h-4 bg-white/10 self-center mx-0.5" />
      {AUDITS.map((a) => {
        const active = activeAudit === a;
        return (
          <Link key={a} href={buildQS(searchParams, { auditStatus: active ? undefined : a, page: "1" })}
            className={`badge text-[10px] ${active ? "bg-white/15 text-white border-white/30" : "bg-white/5 text-gray-500 border-white/10 hover:border-white/20"}`}>
            {a}
          </Link>
        );
      })}
    </div>
  );
}
