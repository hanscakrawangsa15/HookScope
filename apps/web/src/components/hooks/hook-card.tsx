import Link from "next/link";
import { ShieldCheck, ShieldAlert, ShieldOff, ExternalLink } from "lucide-react";
import type { HookSummary } from "@/lib/api";
import { RiskBadge } from "@/components/ui/risk-badge";
import { CallbackGrid } from "@/components/ui/callback-grid";
import { shortAddress, chainName, chainIcon, formatTvl, timeAgo, cn } from "@/lib/utils";

interface HookCardProps {
  hook: HookSummary;
  view?: "grid" | "list";
}

export function HookCard({ hook, view = "grid" }: HookCardProps) {
  const auditIcon = {
    AUDITED: <ShieldCheck size={14} className="text-green-400" />,
    IN_PROGRESS: <ShieldAlert size={14} className="text-yellow-400" />,
    UNAUDITED: <ShieldOff size={14} className="text-gray-500" />,
    FLAGGED: <ShieldAlert size={14} className="text-red-400" />,
  }[hook.auditStatus] ?? <ShieldOff size={14} className="text-gray-500" />;

  const activeCallbacks = Object.entries(hook.callbacks)
    .filter(([, v]) => v)
    .map(([k]) => k);

  if (view === "list") {
    return (
      <Link href={`/hooks/${hook.address}?chain=${hook.chainId}`}>
        <div className="card px-5 py-4 hover:bg-white/8 transition-colors flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-blue-400">
                {hook.name ?? shortAddress(hook.address)}
              </span>
              {hook.isVerified && (
                <span className="badge bg-green-500/10 text-green-400 border-green-500/20 text-[10px]">
                  VERIFIED
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 font-mono mt-0.5">{shortAddress(hook.address, 8)}</p>
          </div>
          <div className="hidden sm:flex items-center gap-3">
            <span className="text-xs text-gray-400">{chainIcon(hook.chainId)} {chainName(hook.chainId)}</span>
            <span className="text-xs text-gray-400">{hook.poolCount} pools</span>
            <span className="text-xs text-gray-400">{formatTvl(hook.tvlUsd)}</span>
          </div>
          <div className="flex items-center gap-2">
            {auditIcon}
            <RiskBadge level={hook.riskLevel} score={hook.hookScore} />
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link href={`/hooks/${hook.address}?chain=${hook.chainId}`}>
      <div className="card p-5 hover:bg-white/8 transition-all hover:border-blue-500/30 h-full flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm text-white truncate">
                {hook.name ?? shortAddress(hook.address)}
              </h3>
              {hook.isVerified && (
                <span className="badge bg-green-500/10 text-green-400 border-green-500/20 text-[10px]">
                  VERIFIED
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 font-mono mt-0.5">{shortAddress(hook.address, 6)}</p>
          </div>
          <RiskBadge level={hook.riskLevel} score={hook.hookScore} />
        </div>

        {/* Callbacks */}
        <CallbackGrid callbacks={hook.callbacks} compact />

        {/* Footer */}
        <div className="mt-auto flex items-center justify-between text-xs text-gray-500">
          <span>{chainIcon(hook.chainId)} {chainName(hook.chainId)}</span>
          <span>{hook.poolCount} pools · {formatTvl(hook.tvlUsd)}</span>
          <span>{timeAgo(hook.deployedAt)}</span>
        </div>
      </div>
    </Link>
  );
}
