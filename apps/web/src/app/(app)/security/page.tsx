import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { RiskBadge } from "@/components/ui/risk-badge";
import { shortAddress, chainName, chainIcon, formatTvl, timeAgo } from "@/lib/utils";
import Link from "next/link";
import { Shield, AlertTriangle, ShieldOff, ShieldCheck, Zap, Activity } from "lucide-react";

export const metadata = { title: "Security Dashboard" };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function getAnalytics() {
  try {
    const res = await fetch(`${API_URL}/api/analytics/global`, { next: { revalidate: 60 } });
    return res.ok ? res.json() : null;
  } catch { return null; }
}

export default async function SecurityPage() {
  const [stats, criticalHooks, highHooks, unauditedHighTVL, analytics] = await Promise.allSettled([
    api.stats.global(),
    api.hooks.list({ riskLevel: "CRITICAL", limit: 10, sortBy: "riskScore" }),
    api.hooks.list({ riskLevel: "HIGH", limit: 8, sortBy: "tvl" }),
    api.hooks.list({ auditStatus: "UNAUDITED", sortBy: "tvl", limit: 10 }),
    getAnalytics(),
  ]);

  const globalStats  = stats.status === "fulfilled" ? stats.value : null;
  const critical     = criticalHooks.status === "fulfilled" ? criticalHooks.value.data : [];
  const high         = highHooks.status === "fulfilled" ? highHooks.value.data : [];
  const unaudited    = unauditedHighTVL.status === "fulfilled" ? unauditedHighTVL.value.data : [];
  const analyticsData = analytics.status === "fulfilled" ? analytics.value : null;

  const totalTVL = analyticsData?.totalTVLUsd ?? 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <Shield size={28} className="text-blue-400" />
          Security Dashboard
        </h1>
        <p className="text-gray-400 mt-2">
          Real-time security overview of the Uniswap v4 Hook ecosystem
        </p>
      </div>

      {/* Stats grid */}
      {globalStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <StatCard icon={<Shield className="text-blue-400" size={20} />}
            label="Total Hooks" value={globalStats.totalHooks} />
          <StatCard icon={<Activity className="text-purple-400" size={20} />}
            label="Total TVL" value={`$${(totalTVL / 1e6).toFixed(1)}M`} isStr />
          <StatCard icon={<ShieldOff className="text-gray-400" size={20} />}
            label="Unverified Source" value={globalStats.unverifiedHooks}
            sub={`${Math.round(globalStats.unverifiedHooks / globalStats.totalHooks * 100)}% of hooks`} />
          <StatCard icon={<AlertTriangle className="text-red-400" size={20} />}
            label="Critical Risk" value={critical.length}
            sub="requires immediate attention" />
        </div>
      )}

      {/* Risk breakdown */}
      {globalStats && (
        <div className="card p-6 mb-6">
          <h2 className="font-semibold text-gray-300 mb-4 flex items-center gap-2">
            <Zap size={14} className="text-yellow-400" />
            Risk Distribution (from address bitmask analysis)
          </h2>
          <div className="space-y-3">
            {([
              { level: "CRITICAL", color: "bg-red-500",    label: "CRITICAL" },
              { level: "HIGH",     color: "bg-orange-500", label: "HIGH" },
              { level: "MEDIUM",   color: "bg-yellow-500", label: "MEDIUM" },
              { level: "LOW",      color: "bg-green-500",  label: "LOW" },
            ] as const).map(({ level, color, label }) => {
              const count = (globalStats.hooksByRisk as Record<string, number>)[level] ?? 0;
              const pct = globalStats.totalHooks > 0 ? (count / globalStats.totalHooks) * 100 : 0;
              return (
                <Link key={level} href={`/?riskLevel=${level}`} className="flex items-center gap-3 group">
                  <RiskBadge level={level} />
                  <div className="flex-1 bg-white/5 rounded-full h-2 group-hover:bg-white/10 transition-colors">
                    <div className={`h-2 rounded-full ${color} transition-all`} style={{ width: `${Math.max(pct, 0.3)}%` }} />
                  </div>
                  <span className="text-xs text-gray-400 w-24 text-right">
                    {count.toLocaleString()} ({pct.toFixed(1)}%)
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-3 gap-4 text-xs text-gray-500">
            <div>
              <p className="text-white font-medium mb-1">Analysis Method</p>
              <p>Address bitmask decode + bytecode scan</p>
            </div>
            <div>
              <p className="text-white font-medium mb-1">Delta Returns Hooks</p>
              <p>Custom token accounting — highest risk pattern</p>
            </div>
            <div>
              <p className="text-white font-medium mb-1">Data Freshness</p>
              <p>Scores updated on every indexer run</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Critical risk */}
        <div className="card p-5">
          <h2 className="font-semibold text-gray-300 mb-4 flex items-center gap-2">
            <AlertTriangle size={14} className="text-red-400" />
            Critical Risk Hooks ({critical.length})
          </h2>
          {critical.length === 0 ? (
            <p className="text-gray-500 text-sm">None found</p>
          ) : (
            <div className="space-y-2">
              {critical.map((hook) => (
                <Link key={hook.id} href={`/hooks/${hook.address}?chain=${hook.chainId}`}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors border border-red-500/10 bg-red-500/5">
                  <div>
                    <p className="text-sm font-mono text-red-300">
                      {hook.name ?? shortAddress(hook.address)}
                    </p>
                    <p className="text-xs text-gray-500">{chainIcon(hook.chainId)} {chainName(hook.chainId)} · {timeAgo(hook.deployedAt)}</p>
                  </div>
                  <div className="text-right">
                    <RiskBadge level={hook.riskLevel} score={hook.hookScore} />
                    <p className="text-xs text-gray-600 mt-0.5">{hook.poolCount} pools</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* High risk with TVL */}
        <div className="card p-5">
          <h2 className="font-semibold text-gray-300 mb-4 flex items-center gap-2">
            <AlertTriangle size={14} className="text-orange-400" />
            High Risk Hooks — Unaudited (top TVL)
          </h2>
          {unaudited.length === 0 ? (
            <p className="text-gray-500 text-sm">All high-TVL hooks are audited ✓</p>
          ) : (
            <div className="space-y-2">
              {unaudited.map((hook) => (
                <Link key={hook.id} href={`/hooks/${hook.address}?chain=${hook.chainId}`}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors">
                  <div>
                    <p className="text-sm font-mono text-gray-300">
                      {hook.name ?? shortAddress(hook.address)}
                    </p>
                    <p className="text-xs text-gray-500">{chainIcon(hook.chainId)} {chainName(hook.chainId)}</p>
                  </div>
                  <div className="text-right">
                    <RiskBadge level={hook.riskLevel} score={hook.hookScore} />
                    <p className="text-xs text-blue-400 mt-0.5 font-medium">{formatTvl(hook.tvlUsd)}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Delta returns hooks — most dangerous pattern */}
        <div className="card p-5 lg:col-span-2">
          <h2 className="font-semibold text-gray-300 mb-2 flex items-center gap-2">
            <Zap size={14} className="text-purple-400" />
            Hooks dengan Delta Returns (Custom Accounting)
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            Hooks ini dapat secara langsung mengubah jumlah token yang diterima/dikirim dalam setiap swap.
            Paling powerful — dan paling berisiko jika tidak diaudit.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            {[
              { label: "beforeSwapReturnsDelta", desc: "Bisa ambil token sebelum swap" },
              { label: "afterSwapReturnsDelta", desc: "Bisa ambil fee setelah swap" },
              { label: "afterAddLiquidityReturnsDelta", desc: "Bisa kurangi LP deposit" },
              { label: "afterRemoveLiquidityReturnsDelta", desc: "Bisa kurangi withdrawal" },
            ].map((d) => (
              <Link key={d.label} href={`/?callbacks=${d.label}`}
                className="p-3 rounded-xl bg-purple-500/5 border border-purple-500/20 hover:bg-purple-500/10 transition-colors">
                <p className="font-mono text-xs text-purple-300 mb-1 break-all">{d.label}</p>
                <p className="text-[10px] text-gray-500">{d.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* HookScore methodology */}
      <div className="card p-6 mt-6">
        <h2 className="font-semibold text-gray-300 mb-4">HookScore™ Methodology</h2>
        <div className="grid sm:grid-cols-2 gap-6 text-xs text-gray-400">
          <div>
            <p className="text-white font-medium mb-2">Penalti</p>
            <ul className="space-y-1.5">
              {[
                ["-30", "Source code tidak terverifikasi"],
                ["-15", "Proxy/upgradeable pattern"],
                ["-15", "Delta returns aktif"],
                ["-20", "≥10 callbacks aktif (extreme surface)"],
                ["-10", "≥7 callbacks aktif"],
                ["-25%", "Dari callback risk score"],
              ].map(([pts, desc]) => (
                <li key={desc} className="flex items-baseline gap-2">
                  <span className="text-red-400 font-mono w-10 flex-shrink-0">{pts}</span>
                  <span>{desc}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-white font-medium mb-2">Bonus</p>
            <ul className="space-y-1.5">
              <li className="flex items-baseline gap-2">
                <span className="text-green-400 font-mono w-10">+15</span>
                <span>Audit oleh firma reputable</span>
              </li>
            </ul>
            <p className="text-white font-medium mt-4 mb-2">Data Sources</p>
            <ul className="space-y-1.5">
              {[
                "Address bitmask (deterministic, tidak bisa dipalsukan)",
                "Etherscan — source code verification",
                "Bytecode scan — SELFDESTRUCT, DELEGATECALL",
                "Proxy detection — EIP-1967/1822/1167",
                "Slither (jika source tersedia)",
              ].map((s) => (
                <li key={s} className="flex items-start gap-2">
                  <span className="text-blue-400 mt-0.5">•</span><span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub, isStr }: {
  icon: ReactNode; label: string; value: number | string; sub?: string; isStr?: boolean;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-2">{icon}
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className="text-3xl font-bold text-white">
        {isStr ? value : (value as number).toLocaleString()}
      </p>
      {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
    </div>
  );
}
