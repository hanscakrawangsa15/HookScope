"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { TrendingUp, TrendingDown, ArrowUpDown, RefreshCw, Info, Award } from "lucide-react";
import { api } from "@/lib/api";
import { chainName, chainIcon, formatTvl } from "@/lib/utils";

type SortKey = "feeApy" | "feeRate" | "tvl";
type SortOrder = "desc" | "asc";

interface LeaderboardPool {
  poolId: string; chainId: number;
  hookAddress: string; hookScore: number | null; riskLevel: string;
  token0Symbol: string | null; token1Symbol: string | null;
  fee: number; isDynamic: boolean;
  effectiveFeeRate: number; lpNetFeeRate: number;
  protocolFeeRate0: number; protocolFeeRate1: number;
  feeApy: number; tvlUsd: number;
  hasHookFees: boolean; daysActive: number;
}

const RISK_COLOR: Record<string, string> = {
  LOW: "#22c55e", MEDIUM: "#f59e0b", HIGH: "#ef4444", CRITICAL: "#dc2626",
};

function feeApyColor(apy: number): string {
  if (apy <= 0) return "#6b7280";
  if (apy < 5)  return "#6b7280";
  if (apy < 20) return "#86efac";
  if (apy < 50) return "#fde047";
  return "#fb923c";
}

function feeRateColor(rate: number): string {
  if (rate === 0) return "#6b7280";
  if (rate < 0.05) return "#a5b4fc";
  if (rate < 0.3)  return "#86efac";
  if (rate < 1)    return "#fde047";
  return "#fb923c";
}

export function FeeLeaderboard({ defaultChainId }: { defaultChainId?: number }) {
  const [pools,     setPools]     = useState<LeaderboardPool[]>([]);
  const [summary,   setSummary]   = useState<{ avgFeeApy: number; maxFeeApy: number; minFeeApy: number; avgFeeRate: number; dynamicCount: number; totalPools: number } | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [sortKey,   setSortKey]   = useState<SortKey>("feeApy");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [chainId,   setChainId]   = useState<number | undefined>(defaultChainId);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const res = await api.feeLeaderboard({ chainId, sort: sortKey, order: sortOrder, limit: 50 });
      setPools(res.pools);
      setSummary(res.summary);
    } catch { /* non-fatal */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [chainId, sortKey, sortOrder]);

  useEffect(() => { load(); }, [load]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortOrder(o => o === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortOrder("desc"); }
  };

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button onClick={() => toggleSort(k)}
      className="flex items-center gap-1 text-[10px] uppercase tracking-wider cursor-pointer transition-colors"
      style={{ color: sortKey === k ? "#93c5fd" : "#6b7280" }}>
      {label}
      <ArrowUpDown size={10} className={sortKey === k ? "text-blue-400" : "text-gray-600"} />
      {sortKey === k && <span className="text-[9px]">{sortOrder === "desc" ? "↓" : "↑"}</span>}
    </button>
  );

  if (loading) return (
    <div className="space-y-3">
      {[1,2,3,4,5].map(i => <div key={i} className="h-12 shimmer rounded-xl" />)}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Max Fee APY", value: `${summary.maxFeeApy.toFixed(1)}%`, color: "#fb923c", icon: Award },
            { label: "Avg Fee APY", value: `${summary.avgFeeApy.toFixed(1)}%`, color: "#86efac", icon: TrendingUp },
            { label: "Avg Fee Rate", value: `${summary.avgFeeRate.toFixed(3)}%`, color: "#a5b4fc", icon: TrendingDown },
            { label: "Dynamic Pools", value: `${summary.dynamicCount}/${summary.totalPools}`, color: "#fde047", icon: Info },
          ].map(({ label, value, color, icon: Icon }) => (
            <div key={label} className="rounded-xl p-3 border"
              style={{ background: `${color}0d`, borderColor: `${color}30` }}>
              <div className="flex items-center gap-1.5 mb-1">
                <Icon size={12} style={{ color }} />
                <span className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</span>
              </div>
              <p className="text-lg font-bold" style={{ color }}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {[undefined, 1, 8453, 42161, 10].map(id => (
            <button key={id ?? "all"} onClick={() => setChainId(id)}
              className="text-[10px] px-2.5 py-1 rounded-lg cursor-pointer transition-all"
              style={{
                background: chainId === id ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.04)",
                border: chainId === id ? "1px solid rgba(59,130,246,0.4)" : "1px solid rgba(255,255,255,0.08)",
                color: chainId === id ? "#93c5fd" : "#6b7280",
              }}>
              {id ? chainIcon(id) + " " + chainName(id) : "All Chains"}
            </button>
          ))}
        </div>
        <button onClick={() => load(true)} disabled={refreshing}
          className="text-gray-600 hover:text-gray-300 transition-colors cursor-pointer p-1">
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Fee explanation */}
      <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs"
        style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.15)" }}>
        <Info size={11} className="text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-gray-400 leading-relaxed">
          <span className="text-blue-300 font-semibold">Fee Structure Uniswap V4: </span>
          <strong className="text-white">LP Fee</strong> = fee yang LP terima per swap.{" "}
          <strong className="text-white">Protocol Fee</strong> = potongan kecil dari LP fee untuk protokol (biasanya 0).{" "}
          <strong className="text-white">Fee APY</strong> = estimasi APY tahunan dari data feeGrowthGlobals on-chain.{" "}
          Pool dengan hook <span className="text-orange-300">delta-returns</span> mungkin ada fee tambahan dari hook.
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
        {/* Header */}
        <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[10px] uppercase tracking-wider text-gray-600"
          style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="col-span-3">Pair</div>
          <div className="col-span-2 text-center"><SortBtn k="feeRate" label="LP Fee" /></div>
          <div className="col-span-1 text-center text-[10px]">Protocol</div>
          <div className="col-span-2 text-center"><SortBtn k="feeApy" label="Fee APY" /></div>
          <div className="col-span-2 text-center"><SortBtn k="tvl" label="TVL" /></div>
          <div className="col-span-2 text-right">Hook</div>
        </div>

        {/* Rows */}
        {pools.length === 0 ? (
          <div className="text-center py-8 text-gray-600 text-sm">
            Tidak ada data. Pastikan indexer berjalan dan pool memiliki TVL.
          </div>
        ) : pools.map((pool, i) => {
          const pair = `${pool.token0Symbol ?? "?"} / ${pool.token1Symbol ?? "?"}`;
          const apyColor = feeApyColor(pool.feeApy);
          const rateColor = feeRateColor(pool.lpNetFeeRate);
          const riskColor = RISK_COLOR[pool.riskLevel] ?? "#6b7280";
          const rank = i + 1;
          const isTop = rank <= 3;

          return (
            <div key={pool.poolId}
              className="grid grid-cols-12 gap-2 px-4 py-3 transition-colors hover:bg-white/[0.02] items-center"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>

              {/* Pair + rank */}
              <div className="col-span-3 flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-mono flex-shrink-0"
                  style={{ color: isTop ? ["#f59e0b", "#94a3b8", "#b45309"][rank-1] : "#374151" }}>
                  #{rank}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{pair}</p>
                  <p className="text-[9px] text-gray-600 font-mono">
                    {chainIcon(pool.chainId)} {chainName(pool.chainId)}
                    {pool.isDynamic && <span className="ml-1 text-yellow-500/70">dynamic</span>}
                  </p>
                </div>
              </div>

              {/* LP fee rate */}
              <div className="col-span-2 text-center">
                <p className="text-sm font-bold" style={{ color: rateColor }}>
                  {pool.lpNetFeeRate > 0 ? `${pool.lpNetFeeRate.toFixed(3)}%` : "—"}
                </p>
                <p className="text-[9px] text-gray-600">
                  {pool.effectiveFeeRate !== pool.lpNetFeeRate
                    ? `gross ${pool.effectiveFeeRate.toFixed(3)}%`
                    : "net"}
                </p>
              </div>

              {/* Protocol cut */}
              <div className="col-span-1 text-center">
                <p className="text-[11px]" style={{ color: pool.protocolFeeRate0 > 0 ? "#f59e0b" : "#374151" }}>
                  {pool.protocolFeeRate0 > 0
                    ? `${((pool.protocolFeeRate0 + pool.protocolFeeRate1) / 2).toFixed(4)}%`
                    : "0%"}
                </p>
              </div>

              {/* Fee APY */}
              <div className="col-span-2 text-center">
                <p className="text-sm font-bold tabular-nums" style={{ color: apyColor }}>
                  {pool.feeApy > 0 ? `${pool.feeApy.toFixed(1)}%` : "—"}
                </p>
                <p className="text-[9px] text-gray-600">{pool.daysActive}d data</p>
              </div>

              {/* TVL */}
              <div className="col-span-2 text-center">
                <p className="text-xs text-gray-300 tabular-nums">{formatTvl(pool.tvlUsd)}</p>
              </div>

              {/* Hook link */}
              <div className="col-span-2 text-right">
                <Link href={`/hooks/${pool.hookAddress}?chainId=${pool.chainId}`}
                  className="text-[10px] font-mono hover:text-blue-400 transition-colors"
                  style={{ color: riskColor }}>
                  {pool.hookAddress.slice(0, 6)}…
                  <span className="text-[9px] ml-1"
                    style={{ color: riskColor }}>
                    {pool.riskLevel}
                    {pool.hookScore != null ? ` ·${pool.hookScore}` : ""}
                  </span>
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-gray-700 text-center">
        Fee APY dihitung dari <code>feeGrowthGlobals</code> on-chain × liquidity ÷ 2¹²⁸ ÷ TVL × 365.
        Semakin tinggi Fee APY, semakin banyak fee yang dihasilkan per dollar likuiditas.
      </p>
    </div>
  );
}
