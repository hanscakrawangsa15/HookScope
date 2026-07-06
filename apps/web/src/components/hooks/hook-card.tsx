"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { ShieldCheck, ShieldAlert, ShieldOff, Zap, Droplets } from "lucide-react";
import type { HookSummary } from "@/lib/api";
import { RiskBadge } from "@/components/ui/risk-badge";
import { CallbackGrid } from "@/components/ui/callback-grid";
import { shortAddress, chainName, chainIcon, formatTvl, timeAgo } from "@/lib/utils";

interface HookCardProps {
  hook: HookSummary;
  view?: "grid" | "list";
}

const RISK_GLOW: Record<string, string> = {
  CRITICAL: "rgba(239,68,68,0.20)",
  HIGH:     "rgba(249,115,22,0.14)",
  MEDIUM:   "rgba(234,179,8,0.12)",
  LOW:      "rgba(59,130,246,0.10)",
};
const RISK_BORDER: Record<string, string> = {
  CRITICAL: "rgba(239,68,68,0.30)",
  HIGH:     "rgba(249,115,22,0.22)",
  MEDIUM:   "rgba(234,179,8,0.18)",
  LOW:      "rgba(255,255,255,0.07)",
};

export function HookCard({ hook, view = "grid" }: HookCardProps) {
  const router = useRouter();
  const goToAddLiquidity = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    router.push(`/hooks/${hook.address}?chain=${hook.chainId}#add-liquidity`);
  };

  const auditIcon = {
    AUDITED:     <ShieldCheck size={13} className="text-green-400" />,
    IN_PROGRESS: <ShieldAlert size={13} className="text-yellow-400" />,
    UNAUDITED:   <ShieldOff  size={13} className="text-gray-600"  />,
    FLAGGED:     <ShieldAlert size={13} className="text-red-400"   />,
  }[hook.auditStatus] ?? <ShieldOff size={13} className="text-gray-600" />;

  const activeCallbacks = Object.entries(hook.callbacks)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const tvlUsd     = hook.tvlUsd ?? 0;
  const riskGlow   = RISK_GLOW[hook.riskLevel]   ?? RISK_GLOW.LOW;
  const riskBorder = RISK_BORDER[hook.riskLevel]  ?? RISK_BORDER.LOW;

  if (view === "list") {
    return (
      <Link href={`/hooks/${hook.address}?chain=${hook.chainId}`}>
        <div className="group flex items-center gap-4 px-5 py-3.5 rounded-2xl transition-all duration-200 cursor-pointer"
          style={{
            background: "rgba(255,255,255,0.025)",
            border: `1px solid ${riskBorder}`,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 20px ${riskGlow}`;
            (e.currentTarget as HTMLDivElement).style.borderColor = RISK_BORDER[hook.riskLevel] ?? "rgba(59,130,246,0.3)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
            (e.currentTarget as HTMLDivElement).style.borderColor = riskBorder;
          }}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm text-blue-400 group-hover:text-blue-300 transition-colors truncate">
                {hook.name ?? shortAddress(hook.address)}
              </span>
              {hook.isVerified && (
                <span className="badge bg-green-500/10 text-green-400 border-green-500/20 text-[10px] shrink-0">VERIFIED</span>
              )}
              {hook.description && (
                <span className="badge text-[9px] px-1 shrink-0"
                  style={{ background: "rgba(168,85,247,0.12)", color: "#c084fc", border: "1px solid rgba(168,85,247,0.25)" }}>
                  ◈ Registry
                </span>
              )}
              {activeCallbacks.length > 8 && (
                <span className="badge bg-orange-500/10 text-orange-400 border-orange-500/20 text-[10px] shrink-0">
                  <Zap size={9} className="mr-0.5" />{activeCallbacks.length} callbacks
                </span>
              )}
            </div>
            {hook.description ? (
              <p className="text-[11px] text-gray-500 mt-0.5 truncate max-w-md">{hook.description}</p>
            ) : (
              <p className="text-xs text-gray-600 font-mono mt-0.5">{shortAddress(hook.address, 8)}</p>
            )}
          </div>
          <div className="hidden sm:flex items-center gap-4 text-xs text-gray-500">
            <span>{chainIcon(hook.chainId)} {chainName(hook.chainId)}</span>
            <span>{hook.poolCount} pools</span>
            <span className={tvlUsd > 0 ? "text-blue-400 font-medium" : ""}>{formatTvl(tvlUsd)}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {auditIcon}
            <button
              onClick={goToAddLiquidity}
              title="Add Liquidity"
              className="p-1 rounded-lg text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors cursor-pointer"
            >
              <Droplets size={13} />
            </button>
            <RiskBadge level={hook.riskLevel} score={hook.hookScore} />
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link href={`/hooks/${hook.address}?chain=${hook.chainId}`}>
      <div
        className="group flex flex-col gap-3.5 p-5 rounded-2xl h-full cursor-pointer transition-all duration-250"
        style={{
          background: "rgba(255,255,255,0.025)",
          border: `1px solid ${riskBorder}`,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.04)";
          (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 32px ${riskGlow}, 0 8px 32px rgba(0,0,0,0.4)`;
          (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)";
          (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
          (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
              {hook.riskLevel === "CRITICAL" && (
                <span className="text-red-400 text-[10px] font-bold tracking-wider">⚠ CRITICAL</span>
              )}
              {hook.isVerified && (
                <span className="badge bg-green-500/10 text-green-400 border-green-500/20 text-[10px]">✓ VERIFIED</span>
              )}
              {hook.description && (
                <span className="badge text-[9px] px-1 py-0"
                  style={{ background: "rgba(168,85,247,0.12)", color: "#c084fc", border: "1px solid rgba(168,85,247,0.25)" }}>
                  ◈ Registry
                </span>
              )}
            </div>
            <h3 className="font-semibold text-sm text-gray-100 group-hover:text-white transition-colors truncate">
              {hook.name ?? shortAddress(hook.address)}
            </h3>
            {hook.description ? (
              <p className="text-[11px] text-gray-500 mt-1 leading-relaxed line-clamp-2">
                {hook.description}
              </p>
            ) : (
              <p className="text-[11px] text-gray-600 font-mono mt-0.5">{shortAddress(hook.address, 6)}</p>
            )}
          </div>
          <RiskBadge level={hook.riskLevel} score={hook.hookScore} />
        </div>

        {/* Callbacks */}
        <CallbackGrid callbacks={hook.callbacks} compact />

        {/* TVL bar (if has TVL) */}
        {tvlUsd > 1000 && (
          <div>
            <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
              <span>TVL</span>
              <span className="text-blue-400 font-medium">{formatTvl(tvlUsd)}</span>
            </div>
            <div className="h-0.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, (tvlUsd / 10_000_000) * 100)}%`,
                  background: "linear-gradient(to right, #3b82f6, #8b5cf6)",
                }}
              />
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-auto flex items-center justify-between text-[11px] text-gray-600 pt-1 border-t border-white/5">
          <span>{chainIcon(hook.chainId)} {chainName(hook.chainId)}</span>
          <span>{hook.poolCount} pools · {formatTvl(tvlUsd)}</span>
          <div className="flex items-center gap-1.5">
            {auditIcon}
            <span>{timeAgo(hook.deployedAt)}</span>
            <button
              onClick={goToAddLiquidity}
              title="Add Liquidity"
              className="p-1 -mr-1 rounded-lg text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors cursor-pointer"
            >
              <Droplets size={13} />
            </button>
          </div>
        </div>
      </div>
    </Link>
  );
}
