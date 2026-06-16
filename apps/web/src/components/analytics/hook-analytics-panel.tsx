"use client";

import { useEffect, useState, useCallback } from "react";
import { formatTvl } from "@/lib/utils";
import { TrendingUp, Droplets, Users, RefreshCw, Loader2 } from "lucide-react";

interface HookAnalyticsData {
  address: string;
  chainId: number;
  analytics: {
    tvlUsd: number;
    volume7dUsd: number;
    volume30dUsd: number;
    poolCount: number;
    uniqueLps: number;
    updatedAt: string;
  } | null;
  pools: Array<{
    id: string;
    poolId: string;
    token0Symbol: string | null;
    token1Symbol: string | null;
    fee: number;
    tvlUsd: number | null;
    chainId: number;
  }>;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export function HookAnalyticsPanel({ address }: { address: string }) {
  const [data, setData] = useState<HookAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetch_ = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch(`${API_URL}/api/analytics/hook/${address}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json() as HookAnalyticsData;
      setData(json);
      setLastUpdated(new Date());
    } catch { /* non-fatal */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [address]);

  useEffect(() => {
    fetch_();
    // Poll every 30 seconds for fresh data
    const id = setInterval(() => fetch_(true), 30_000);
    return () => clearInterval(id);
  }, [fetch_]);

  if (loading) {
    return (
      <div className="card p-5 animate-pulse">
        <div className="h-4 bg-white/10 rounded w-32 mb-4" />
        <div className="grid grid-cols-4 gap-3">
          {[1,2,3,4].map((i) => <div key={i} className="h-16 bg-white/10 rounded-lg" />)}
        </div>
      </div>
    );
  }

  const a = data?.analytics;
  const tvl = a?.tvlUsd ?? 0;
  const pools = data?.pools ?? [];

  return (
    <div className="card p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <TrendingUp size={13} className="text-blue-400" />
          Live Analytics
        </h2>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-[10px] text-gray-600">
              Updated {timeAgoShort(lastUpdated)}
            </span>
          )}
          <button
            onClick={() => fetch_(true)}
            disabled={refreshing}
            className="p-1 text-gray-600 hover:text-gray-300 transition-colors"
          >
            <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <MetricCard
          icon={<Droplets size={14} className="text-blue-400" />}
          label="Total TVL"
          value={formatTvl(tvl)}
          sub={tvl === 0 ? "Fetching..." : undefined}
          highlight={tvl > 0}
        />
        <MetricCard
          icon={<TrendingUp size={14} className="text-green-400" />}
          label="Volume 7d"
          value={formatTvl(a?.volume7dUsd ?? 0)}
        />
        <MetricCard
          icon={<TrendingUp size={14} className="text-purple-400" />}
          label="Volume 30d"
          value={formatTvl(a?.volume30dUsd ?? 0)}
        />
        <MetricCard
          icon={<Users size={14} className="text-yellow-400" />}
          label="Active Pools"
          value={String(a?.poolCount ?? pools.length)}
        />
      </div>

      {/* Pool breakdown */}
      {pools.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-2">
            Pools using this hook
          </p>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {pools.map((pool) => {
              const pair = pool.token0Symbol && pool.token1Symbol
                ? `${pool.token0Symbol} / ${pool.token1Symbol}`
                : `${pool.poolId.slice(0, 8)}...`;
              const fee = (pool.fee / 10000).toFixed(2) + "%";
              return (
                <div key={pool.id}
                  className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-white/3 border border-white/5">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-300 font-medium">{pair}</span>
                    <span className="text-gray-600 badge bg-white/5 border-white/10 text-[10px]">{fee}</span>
                  </div>
                  <span className={pool.tvlUsd && pool.tvlUsd > 0 ? "text-blue-400 font-medium" : "text-gray-600"}>
                    {pool.tvlUsd && pool.tvlUsd > 0 ? formatTvl(pool.tvlUsd) : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pools.length === 0 && tvl === 0 && (
        <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
          {data
            ? <span className="text-gray-600">Tidak ada data pool yang diindeks untuk program ini.</span>
            : <><Loader2 size={12} className="animate-spin" /> Analytics engine is fetching on-chain data... refresh in 30s</>
          }
        </div>
      )}
    </div>
  );
}

function MetricCard({ icon, label, value, sub, highlight }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; highlight?: boolean;
}) {
  return (
    <div className="bg-white/3 rounded-xl p-3 border border-white/5">
      <div className="flex items-center gap-1.5 mb-1.5">{icon}
        <span className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-lg font-bold truncate ${highlight ? "text-blue-400" : "text-white"}`} title={value}>{value}</p>
      {sub && <p className="text-[10px] text-gray-600 mt-0.5">{sub}</p>}
    </div>
  );
}

function timeAgoShort(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 5)  return "just now";
  if (secs < 60) return `${secs}s ago`;
  return `${Math.floor(secs / 60)}m ago`;
}
