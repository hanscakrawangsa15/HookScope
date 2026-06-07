import Link from "next/link";
import { TrendingUp, Flame, ChevronRight } from "lucide-react";
import { RiskBadge } from "@/components/ui/risk-badge";
import { formatTvl, shortAddress, chainIcon, cn } from "@/lib/utils";
import type { TopHookEntry } from "@/lib/api";

interface TopHooksBarProps {
  topByTvl: TopHookEntry[];
  topByActivity: TopHookEntry[];
}

export function TopHooksBar({ topByTvl, topByActivity }: TopHooksBarProps) {
  if (topByTvl.length === 0 && topByActivity.length === 0) return null;

  return (
    <div className="mb-8 space-y-4">
      {topByTvl.length > 0 && (
        <HookRow
          icon={<TrendingUp size={13} className="text-blue-400" />}
          title="Highest TVL"
          label="TVL"
          hooks={topByTvl}
          metric={(h) => formatTvl(h.tvlUsd)}
          metricColor="text-blue-400"
          sortHref="/?sortBy=tvl"
        />
      )}
      {topByActivity.length > 0 && (
        <HookRow
          icon={<Flame size={13} className="text-orange-400" />}
          title="Most Active — Swap Terbanyak"
          label="Swaps"
          hooks={topByActivity}
          metric={(h) => `${h.swapCount.toLocaleString()} swap${h.swapCount !== 1 ? "s" : ""}`}
          metricColor="text-orange-400"
          sortHref="/?sortBy=poolCount"
        />
      )}
    </div>
  );
}

interface HookRowProps {
  icon: React.ReactNode;
  title: string;
  label: string;
  hooks: TopHookEntry[];
  metric: (h: TopHookEntry) => string;
  metricColor: string;
  sortHref: string;
}

function HookRow({ icon, title, hooks, metric, metricColor, sortHref }: HookRowProps) {
  return (
    <div>
      {/* Row header */}
      <div className="flex items-center justify-between mb-2 px-0.5">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
          {icon}
          {title}
        </h2>
        <a
          href={sortHref}
          className="text-[10px] text-gray-600 hover:text-gray-300 flex items-center gap-0.5 transition-colors"
        >
          Lihat semua <ChevronRight size={10} />
        </a>
      </div>

      {/* Horizontal scroll row */}
      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none">
        {hooks.map((hook, idx) => (
          <TopHookCard
            key={`${hook.address}-${hook.chainId}`}
            hook={hook}
            rank={idx + 1}
            metric={metric(hook)}
            metricColor={metricColor}
          />
        ))}
      </div>
    </div>
  );
}

function TopHookCard({
  hook,
  rank,
  metric,
  metricColor,
}: {
  hook: TopHookEntry;
  rank: number;
  metric: string;
  metricColor: string;
}) {
  const riskBorderColor: Record<string, string> = {
    LOW:      "border-green-500/20  hover:border-green-500/40",
    MEDIUM:   "border-yellow-500/20 hover:border-yellow-500/40",
    HIGH:     "border-orange-500/20 hover:border-orange-500/40",
    CRITICAL: "border-red-500/20    hover:border-red-500/40",
    UNKNOWN:  "border-white/10      hover:border-white/20",
  };

  return (
    <Link
      href={`/hooks/${hook.address}?chain=${hook.chainId}`}
      className={cn(
        "flex-shrink-0 w-48 rounded-xl border bg-white/3 p-3 transition-all duration-150",
        "hover:bg-white/6 hover:-translate-y-0.5",
        riskBorderColor[hook.riskLevel] ?? riskBorderColor.UNKNOWN
      )}
    >
      {/* Rank + chain */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold text-gray-600">#{rank}</span>
        <span className="text-[11px] text-gray-500">{chainIcon(hook.chainId)}</span>
      </div>

      {/* Name */}
      <p className="text-xs font-semibold text-white leading-tight mb-0.5 truncate">
        {hook.name ?? "Unnamed Hook"}
      </p>
      <p className="text-[10px] text-gray-600 font-mono mb-2.5">
        {shortAddress(hook.address, 6)}
      </p>

      {/* Primary metric */}
      <p className={cn("text-sm font-bold tabular-nums", metricColor)}>
        {metric}
      </p>

      {/* Secondary info */}
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px] text-gray-600">
          {hook.poolCount} pool{hook.poolCount !== 1 ? "s" : ""}
        </span>
        <RiskBadge level={hook.riskLevel} score={hook.hookScore} size="sm" />
      </div>
    </Link>
  );
}