import { api } from "@/lib/api";
import { RiskBadge } from "@/components/ui/risk-badge";
import { shortAddress, chainName, timeAgo } from "@/lib/utils";
import Link from "next/link";
import { Shield, AlertTriangle, ShieldOff, ShieldCheck } from "lucide-react";

export const metadata = { title: "Security Dashboard" };

export default async function SecurityPage() {
  const [stats, flaggedHooks, recentUnaudited] = await Promise.allSettled([
    api.stats.global(),
    api.hooks.list({ riskLevel: "CRITICAL", limit: 10, sortBy: "newest" }),
    api.hooks.list({ auditStatus: "UNAUDITED", sortBy: "tvl", limit: 10 }),
  ]);

  const globalStats = stats.status === "fulfilled" ? stats.value : null;
  const critical = flaggedHooks.status === "fulfilled" ? flaggedHooks.value.data : [];
  const unaudited = recentUnaudited.status === "fulfilled" ? recentUnaudited.value.data : [];

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

      {globalStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
          <StatCard
            icon={<Shield className="text-blue-400" size={20} />}
            label="Total Hooks"
            value={globalStats.totalHooks}
          />
          <StatCard
            icon={<ShieldCheck className="text-green-400" size={20} />}
            label="Audited"
            value={globalStats.auditedHooks}
            sub={`${Math.round((globalStats.auditedHooks / globalStats.totalHooks) * 100)}%`}
          />
          <StatCard
            icon={<ShieldOff className="text-gray-400" size={20} />}
            label="Unverified Source"
            value={globalStats.unverifiedHooks}
            sub="no source code"
          />
          <StatCard
            icon={<AlertTriangle className="text-red-400" size={20} />}
            label="Flagged"
            value={globalStats.flaggedHooks}
            sub="needs review"
          />
        </div>
      )}

      {/* Risk distribution */}
      {globalStats?.hooksByRisk && (
        <div className="card p-6 mb-6">
          <h2 className="font-semibold text-gray-300 mb-4">Risk Distribution</h2>
          <div className="space-y-3">
            {(["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"] as const).map((level) => {
              const count = globalStats.hooksByRisk[level] ?? 0;
              const pct = globalStats.totalHooks > 0
                ? Math.round((count / globalStats.totalHooks) * 100)
                : 0;
              return (
                <div key={level} className="flex items-center gap-3">
                  <RiskBadge level={level} />
                  <div className="flex-1 bg-white/5 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${
                        level === "LOW" ? "bg-green-500" :
                        level === "MEDIUM" ? "bg-yellow-500" :
                        level === "HIGH" ? "bg-orange-500" :
                        level === "CRITICAL" ? "bg-red-500" : "bg-gray-500"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400 w-16 text-right">
                    {count} ({pct}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Critical risk hooks */}
        <div className="card p-5">
          <h2 className="font-semibold text-gray-300 mb-4 flex items-center gap-2">
            <AlertTriangle size={14} className="text-red-400" />
            Critical Risk Hooks
          </h2>
          {critical.length === 0 ? (
            <p className="text-gray-500 text-sm">None detected</p>
          ) : (
            <div className="space-y-2">
              {critical.map((hook) => (
                <Link
                  key={hook.id}
                  href={`/hooks/${hook.address}?chain=${hook.chainId}`}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors"
                >
                  <div>
                    <p className="text-sm font-mono text-red-300">
                      {hook.name ?? shortAddress(hook.address)}
                    </p>
                    <p className="text-xs text-gray-500">{chainName(hook.chainId)} · {timeAgo(hook.deployedAt)}</p>
                  </div>
                  <RiskBadge level={hook.riskLevel} score={hook.hookScore} />
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* High TVL unaudited hooks */}
        <div className="card p-5">
          <h2 className="font-semibold text-gray-300 mb-4 flex items-center gap-2">
            <ShieldOff size={14} className="text-gray-400" />
            Unaudited Hooks (by TVL)
          </h2>
          {unaudited.length === 0 ? (
            <p className="text-gray-500 text-sm">All high-TVL hooks are audited</p>
          ) : (
            <div className="space-y-2">
              {unaudited.map((hook) => (
                <Link
                  key={hook.id}
                  href={`/hooks/${hook.address}?chain=${hook.chainId}`}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors"
                >
                  <div>
                    <p className="text-sm font-mono text-gray-300">
                      {hook.name ?? shortAddress(hook.address)}
                    </p>
                    <p className="text-xs text-gray-500">{chainName(hook.chainId)}</p>
                  </div>
                  <div className="text-right">
                    <RiskBadge level={hook.riskLevel} />
                    <p className="text-xs text-gray-500 mt-1">{hook.tvlUsd ? `$${(hook.tvlUsd/1000).toFixed(0)}K` : "—"}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Risk methodology */}
      <div className="card p-6 mt-6">
        <h2 className="font-semibold text-gray-300 mb-4">HookScore™ Methodology</h2>
        <div className="grid sm:grid-cols-2 gap-4 text-sm text-gray-400">
          <div>
            <p className="text-white font-medium mb-2">Penalties</p>
            <ul className="space-y-1 text-xs">
              <li>−30 pts · Unverified source code</li>
              <li>−40 pts · SELFDESTRUCT opcode detected</li>
              <li>−25 pts · DELEGATECALL detected</li>
              <li>−15 pts · Upgradeable proxy pattern</li>
              <li>−10 pts · Delta returns (custom accounting)</li>
              <li>−20 pts · Per critical Slither finding</li>
              <li>−10 pts · Per high Slither finding</li>
            </ul>
          </div>
          <div>
            <p className="text-white font-medium mb-2">Bonuses</p>
            <ul className="space-y-1 text-xs">
              <li>+15 pts · Verified audit by reputable firm</li>
            </ul>
            <p className="text-white font-medium mt-4 mb-2">Data sources</p>
            <ul className="space-y-1 text-xs">
              <li>On-chain bytecode analysis</li>
              <li>Etherscan verified source</li>
              <li>Slither static analysis</li>
              <li>Community reports</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon, label, value, sub
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs text-gray-500">{label}</span></div>
      <p className="text-3xl font-bold text-white">{value.toLocaleString()}</p>
      {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
    </div>
  );
}
