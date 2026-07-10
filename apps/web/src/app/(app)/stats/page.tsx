import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import { chainName, chainIcon } from "@/lib/utils";
import { BarChart2, TrendingUp } from "lucide-react";

const FeeLeaderboard = dynamic(
  () => import("@/components/analytics/fee-leaderboard").then(m => ({ default: m.FeeLeaderboard })),
  { ssr: false, loading: () => <div className="h-64 shimmer rounded-2xl" /> }
);

export const metadata = { title: "Platform Stats" };

export default async function StatsPage() {
  let stats;
  try {
    stats = await api.stats.global();
  } catch {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-500">
        <p>Unable to load stats. Make sure the API is running.</p>
      </div>
    );
  }

  const chainRows = Object.entries(stats.hooksByChain).sort(([, a], [, b]) => b - a);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <BarChart2 size={28} className="text-blue-400" />
          Platform Statistics
        </h1>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-10">
        {[
          { label: "Total Hooks", value: stats.totalHooks },
          { label: "Total Pools", value: stats.totalPools },
          { label: "Verified", value: stats.verifiedHooks },
          { label: "Audited", value: stats.auditedHooks },
          { label: "Flagged", value: stats.flaggedHooks },
          { label: "Unverified", value: stats.unverifiedHooks },
        ].map(({ label, value }) => (
          <div key={label} className="card p-4 text-center">
            <p className="text-2xl font-bold text-white">{value.toLocaleString()}</p>
            <p className="text-xs text-gray-500 mt-1">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By chain */}
        <div className="card p-6">
          <h2 className="font-semibold text-gray-300 mb-4">Hooks by Chain</h2>
          <div className="space-y-3">
            {chainRows.map(([chainId, count]) => {
              const pct = stats.totalHooks > 0 ? (count / stats.totalHooks) * 100 : 0;
              return (
                <div key={chainId} className="flex items-center gap-3">
                  <span className="text-sm w-28 text-gray-300">
                    {chainIcon(Number(chainId))} {chainName(Number(chainId))}
                  </span>
                  <div className="flex-1 bg-white/5 rounded-full h-2">
                    <div
                      className="h-2 rounded-full bg-blue-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400 w-16 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* By risk */}
        <div className="card p-6">
          <h2 className="font-semibold text-gray-300 mb-4">Hooks by Risk Level</h2>
          <div className="space-y-3">
            {(["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"] as const).map((level) => {
              const count = stats.hooksByRisk[level] ?? 0;
              const pct = stats.totalHooks > 0 ? (count / stats.totalHooks) * 100 : 0;
              const color = {
                LOW: "bg-green-500", MEDIUM: "bg-yellow-500",
                HIGH: "bg-orange-500", CRITICAL: "bg-red-500", UNKNOWN: "bg-gray-500",
              }[level];
              return (
                <div key={level} className="flex items-center gap-3">
                  <span className="text-sm w-20 text-gray-300">{level}</span>
                  <div className="flex-1 bg-white/5 rounded-full h-2">
                    <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-400 w-24 text-right">
                    {count} ({pct.toFixed(1)}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Fee Leaderboard ──────────────────────────────────────────────────── */}
      <div className="mt-12">
        <div className="flex items-center gap-3 mb-6">
          <TrendingUp size={22} className="text-emerald-400" />
          <div>
            <h2 className="text-2xl font-bold text-white">Fee Leaderboard</h2>
            <p className="text-gray-400 text-sm mt-0.5">
              Compare LP fees, protocol fees, and estimated APY across all Uniswap V4 pools.
              Helps LPs choose the pair with the highest or lowest fee.
            </p>
          </div>
        </div>
        <FeeLeaderboard />
      </div>
    </div>
  );
}
