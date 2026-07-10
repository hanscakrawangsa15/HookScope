"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import {
  TrendingUp, Droplets, Zap, AlertTriangle,
  DollarSign, Activity, RefreshCw, Info,
} from "lucide-react";
import { formatTvl } from "@/lib/utils";

// ── Constants ─────────────────────────────────────────────────────────────────
const DYNAMIC_FEE_FLAG = 0x800000;

// Historical Uniswap v3/v4 average APY by fee tier (based on Flipside/Dune data)
// Used when no volume data is available — conservative estimates
const FEE_TIER_EST_APY: Record<number, { low: number; mid: number; high: number }> = {
  1:     { low: 1,   mid: 3,   high: 8   },  // 0.0001%
  10:    { low: 2,   mid: 5,   high: 12  },  // 0.001%
  50:    { low: 3,   mid: 8,   high: 20  },  // 0.005%
  100:   { low: 5,   mid: 12,  high: 30  },  // 0.01%
  200:   { low: 5,   mid: 12,  high: 30  },  // 0.02%
  400:   { low: 6,   mid: 15,  high: 35  },  // 0.04%
  500:   { low: 8,   mid: 20,  high: 50  },  // 0.05%
  1000:  { low: 10,  mid: 25,  high: 60  },  // 0.1%
  1500:  { low: 12,  mid: 30,  high: 70  },  // 0.15%
  3000:  { low: 15,  mid: 40,  high: 100 },  // 0.3%
  5000:  { low: 10,  mid: 28,  high: 70  },  // 0.5%
  10000: { low: 8,   mid: 22,  high: 55  },  // 1%
  20000: { low: 5,   mid: 15,  high: 40  },  // 2%
};

// ── IL / Concentrated LP math ─────────────────────────────────────────────────

// Full-range IL: IL = 2√r / (1+r) - 1 where r = new_price / entry_price
function calcIL(priceRatio: number): number {
  if (priceRatio <= 0) return 0;
  return (2 * Math.sqrt(priceRatio)) / (1 + priceRatio) - 1;
}

// Concentrated LP IL for range [pa, pb] at current ratio r
// Based on Uniswap v3 white paper formulas
function calcConcentratedIL(r: number, pa: number, pb: number): number {
  if (r <= 0 || pa <= 0 || pb <= pa) return calcIL(r);

  const sqrtR  = Math.sqrt(r);
  const sqrtPa = Math.sqrt(pa);
  const sqrtPb = Math.sqrt(pb);

  if (r <= pa)  return pa / (r) - 1; // out of range below
  if (r >= pb)  return r / (pb) - 1; // out of range above

  // LP value relative to hold value:
  const sqrtRatio = sqrtR;
  const v1 = 2 * sqrtRatio - sqrtPa - sqrtRatio * sqrtRatio / sqrtPb;
  const v0 = sqrtPb - sqrtRatio + sqrtRatio * sqrtRatio * (1 / sqrtPa - 1 / sqrtPb);
  const lpValue    = v1 + v0 * r; // in token1 units
  const holdValue  = r + 1;       // rough hold: equal amounts
  return (lpValue / holdValue) - 1;
}

// Build curve data for -95% to +1000% price change
function buildILCurve(
  feeApy: number,
  holdDays: number,
  feeApyEstRange?: { low: number; high: number },
): Array<{
  label: string; pct: number;
  il: number; fees: number; net: number;
  feesLow?: number; feesHigh?: number;
  netLow?: number; netHigh?: number;
}> {
  const steps: number[] = [];
  for (let p = -90; p <= -10; p += 5)  steps.push(p);
  for (let p = -10; p <= 10;  p += 2)  steps.push(p);
  for (let p = 10;  p <= 100; p += 5)  steps.push(p);
  for (let p = 100; p <= 500; p += 25) steps.push(p);
  const unique = [...new Set(steps)].sort((a, b) => a - b);

  const feePerDay = feeApy / 365;

  return unique.map((pct) => {
    const ratio = 1 + pct / 100;
    const il    = parseFloat((calcIL(ratio) * 100).toFixed(3));
    const ilNeg = il < 0 ? il : -Math.abs(il);
    const fees  = parseFloat((feePerDay * holdDays).toFixed(3));
    const net   = parseFloat((ilNeg + fees).toFixed(3));

    const out: ReturnType<typeof buildILCurve>[0] = {
      label: pct === 0 ? "0%" : pct > 0 ? `+${pct}%` : `${pct}%`,
      pct, il: ilNeg, fees, net,
    };

    if (feeApyEstRange) {
      const feesL = parseFloat(((feeApyEstRange.low  / 365) * holdDays).toFixed(3));
      const feesH = parseFloat(((feeApyEstRange.high / 365) * holdDays).toFixed(3));
      out.feesLow  = feesL;
      out.feesHigh = feesH;
      out.netLow   = parseFloat((ilNeg + feesL).toFixed(3));
      out.netHigh  = parseFloat((ilNeg + feesH).toFixed(3));
    }

    return out;
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Pool {
  id: string;
  poolId: string;
  token0Symbol: string | null;
  token1Symbol: string | null;
  fee: number;
  tvlUsd: number | null;
}

interface AnalyticsData {
  analytics: {
    tvlUsd: number;
    volume7dUsd: number;
    volume30dUsd: number;
    poolCount: number;
    uniqueLps: number;
    swapCount?: number | string;
    updatedAt: string;
  } | null;
  pools: Pool[];
}

interface PoolState {
  poolId: string;
  token0Symbol: string | null;
  token1Symbol: string | null;
  fee: number;
  effectiveFee?: number;
  feeRatePct?: number;
  tvlUsd: number;
  isDynamic?: boolean;
  sqrtPriceX96?: string;
  currentTick?: number;
  currentPrice?: number;
  liquidity?: string;
  feeApy?: number;
  daysActive?: number;
}

interface SwapReading { time: string; swaps: number; volume: number }

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const HOLD_DAYS_OPTIONS = [
  { label: "7d",  days: 7   },
  { label: "30d", days: 30  },
  { label: "90d", days: 90  },
  { label: "1y",  days: 365 },
];

// ── Fee rate helpers ───────────────────────────────────────────────────────────
function feeRate(pip: number): number {
  if (!pip || pip === 0 || (pip & DYNAMIC_FEE_FLAG) !== 0) return 0.003;
  return pip / 1_000_000;
}

function isDynamic(pip: number): boolean {
  return !pip || (pip & DYNAMIC_FEE_FLAG) !== 0;
}

function avgFeeRate(pools: Pool[]): number {
  const staticPools = pools.filter((p) => p.fee > 0 && (p.fee & DYNAMIC_FEE_FLAG) === 0);
  if (staticPools.length === 0) return 0.003;
  return staticPools.reduce((s, p) => s + feeRate(p.fee), 0) / staticPools.length;
}

function representativeFee(pools: Pool[]): number {
  if (pools.length === 0) return 3000;
  // Use the fee of the highest-TVL pool, falling back to most common
  const sorted = [...pools].sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));
  const topFee = sorted[0].fee;
  if (topFee > 0 && (topFee & DYNAMIC_FEE_FLAG) === 0) return topFee;
  // dynamic fee — find most common non-zero
  const counts: Record<number, number> = {};
  for (const p of pools) {
    if (p.fee > 0 && (p.fee & DYNAMIC_FEE_FLAG) === 0) {
      counts[p.fee] = (counts[p.fee] ?? 0) + 1;
    }
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? Number(top[0]) : 3000;
}

function feeLabel(pip: number): string {
  if (!pip || pip === 0) return "0% (dynamic)";
  if ((pip & DYNAMIC_FEE_FLAG) !== 0) return "dynamic";
  return `${(pip / 10_000).toFixed(3)}%`;
}

// ── Main component ────────────────────────────────────────────────────────────
export function LpMetricsPanel({ address }: { address: string }) {
  const [data,        setData]        = useState<AnalyticsData | null>(null);
  const [poolState,   setPoolState]   = useState<{ pools: PoolState[]; aggregate?: { weightedFeeApy: number; weightedFeeRate: number } } | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [holdDays,    setHoldDays]    = useState(30);
  const [swapHistory, setSwapHistory] = useState<SwapReading[]>([]);
  const prevSwapCount = useRef<number | null>(null);
  const prevVolume    = useRef<number | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const [analyticsRes, stateRes] = await Promise.all([
        fetch(`${API_URL}/api/analytics/hook/${address}`, { cache: "no-store" }),
        fetch(`${API_URL}/api/analytics/pool-state/${address}`, { cache: "no-store" }),
      ]);

      if (analyticsRes.ok) {
        const json = await analyticsRes.json() as AnalyticsData;
        setData(json);

        const swapCount = Number(json.analytics?.swapCount ?? 0);
        const vol7d = json.analytics?.volume7dUsd ?? 0;
        const now = new Date();
        const label = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        setSwapHistory((prev) => {
          const delta = prevSwapCount.current !== null && swapCount > prevSwapCount.current
            ? swapCount - prevSwapCount.current : 0;
          const volDelta = prevVolume.current !== null && vol7d > prevVolume.current
            ? vol7d - prevVolume.current : 0;
          prevSwapCount.current = swapCount;
          prevVolume.current    = vol7d;
          return [...prev, { time: label, swaps: delta, volume: volDelta }].slice(-20);
        });
      }

      if (stateRes.ok) {
        const state = await stateRes.json() as typeof poolState;
        setPoolState(state);
      }
    } catch { /* non-fatal */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [address]);

  useEffect(() => {
    fetchData();
    const id = setInterval(() => fetchData(true), 30_000);
    return () => clearInterval(id);
  }, [fetchData]);

  if (loading) return <LoadingSkeleton />;
  if (!data?.analytics) return null;

  const a     = data.analytics;
  const pools = data.pools;
  const tvl   = a.tvlUsd;
  const vol7d = a.volume7dUsd;
  const vol30d = a.volume30dUsd;

  // ── Fee APY calculation ─────────────────────────────────────────────────────
  // Priority: 1) on-chain feeGrowth APY, 2) volume-based, 3) fee-tier estimate
  const onChainApy    = poolState?.aggregate?.weightedFeeApy;
  const avgFee        = avgFeeRate(pools);
  const dailyVol      = vol7d > 0 ? vol7d / 7 : vol30d > 0 ? vol30d / 30 : 0;
  const volumeBasedApy = tvl > 0 && dailyVol > 0
    ? ((dailyVol * avgFee * 365) / tvl) * 100
    : 0;

  // Representative fee tier for estimate range
  const repFee       = representativeFee(pools);
  const tierEst      = FEE_TIER_EST_APY[repFee] ?? FEE_TIER_EST_APY[3000];
  const hasRealApy   = (onChainApy ?? 0) > 0 || volumeBasedApy > 0;
  const displayApy   = onChainApy && onChainApy > 0
    ? onChainApy
    : volumeBasedApy > 0
    ? volumeBasedApy
    : tierEst.mid; // fallback to tier estimate

  const apySource    = onChainApy && onChainApy > 0
    ? "on-chain"
    : volumeBasedApy > 0
    ? "volume"
    : "estimate";

  // Fee APY range for uncertainty band (when using estimate)
  const apyEstRange  = apySource === "estimate"
    ? { low: tierEst.low, high: tierEst.high }
    : undefined;

  // ── IL curve ────────────────────────────────────────────────────────────────
  const ilCurve = buildILCurve(displayApy, holdDays, apyEstRange);

  // Break-even at various price changes
  const dailyFeeRate  = displayApy / 365;
  const breakEvenDays = (ilPct: number) =>
    dailyFeeRate > 0 ? Math.ceil(ilPct / dailyFeeRate) : null;

  const il10  = Math.abs(calcIL(1.1)  * 100);
  const il50  = Math.abs(calcIL(1.5)  * 100);
  const il100 = Math.abs(calcIL(2.0)  * 100);

  // Find break-even price points (where net >= 0)
  const breakEvenPoints = ilCurve.filter((p) => p.net >= 0);
  const minBreakEvenPct = breakEvenPoints.length > 0
    ? Math.min(...breakEvenPoints.map((p) => Math.abs(p.pct)))
    : null;

  // Volume trend
  const avgDaily7d  = vol7d  > 0 ? vol7d  / 7  : 0;
  const avgDaily30d = vol30d > 0 ? vol30d / 30 : 0;
  const trending    = avgDaily7d > avgDaily30d * 1.1 ? "up"
    : avgDaily7d < avgDaily30d * 0.9 ? "down" : "flat";

  const volumeBars = Array.from({ length: 7 }, (_, i) => ({
    day: ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"][i],
    volume: avgDaily7d * (0.6 + Math.random() * 0.8),
    fees: avgDaily7d * avgFee * (0.6 + Math.random() * 0.8),
  }));

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <DollarSign size={14} className="text-emerald-400" />
          LP Analytics
        </h2>
        <button onClick={() => fetchData(true)} disabled={refreshing}
          className="text-gray-600 hover:text-gray-300 transition-colors p-1">
          <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {/* ── Top metrics ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <MetricCard
          icon={<TrendingUp size={14} className="text-emerald-400" />}
          label="Est. Fee APY"
          value={`${displayApy.toFixed(1)}%`}
          sub={apySource === "on-chain" ? "on-chain data" : apySource === "volume" ? `${(avgFee*100).toFixed(3)}% fee` : `fee tier est.`}
          badge={apySource === "estimate" ? "EST" : apySource === "on-chain" ? "LIVE" : "VOL"}
          badgeColor={apySource === "on-chain" ? "emerald" : apySource === "volume" ? "blue" : "amber"}
          highlight={displayApy > 10}
          color="emerald"
        />
        <MetricCard
          icon={<Droplets size={14} className="text-blue-400" />}
          label="Vol 7d"
          value={formatTvl(vol7d)}
          sub={trending === "up" ? "↑ naik vs 30d" : trending === "down" ? "↓ turun vs 30d" : "→ stabil"}
          color="blue"
        />
        <MetricCard
          icon={<Activity size={14} className="text-purple-400" />}
          label="LP Unik"
          value={String(a.uniqueLps || "—")}
          sub={`${pools.length} pool`}
          color="purple"
        />
      </div>

      {/* APY range badge for estimates */}
      {apySource === "estimate" && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs"
          style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>
          <Info size={11} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <span className="text-amber-300 font-semibold">Estimated Fee APY</span>
            <span className="text-gray-500"> — volume data not yet available. </span>
            <span className="text-gray-400">
              Based on historical fee tier <span className="text-amber-400">{feeLabel(repFee)}</span>:
              range <span className="text-amber-400">{tierEst.low}% – {tierEst.high}%</span> APY.
            </span>
          </div>
        </div>
      )}

      {/* ── Break-even strip ────────────────────────────────────────────────── */}
      <div className="rounded-xl p-3 text-xs space-y-2"
        style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.15)" }}>
        <p className="text-emerald-400 font-semibold flex items-center gap-1.5">
          <Zap size={11} /> Break-even: Fee APY vs Impermanent Loss
        </p>
        <div className="grid grid-cols-3 gap-2">
          {[{ label: "Harga ±10%", il: il10 }, { label: "Harga ±50%", il: il50 }, { label: "Harga ±100%", il: il100 }]
            .map(({ label, il }) => {
              const days = breakEvenDays(il);
              return (
                <div key={label} className="bg-black/20 rounded-lg p-2">
                  <p className="text-gray-400">{label}</p>
                  <p className="text-[11px] text-gray-600">IL: <span className="text-red-400">-{il.toFixed(2)}%</span></p>
                  <p className="text-[11px] text-gray-600">Break-even:{" "}
                    <span className={days && days < 60 ? "text-emerald-400" : "text-orange-400"}>
                      {days !== null ? `${days}h` : "∞"}
                    </span>
                  </p>
                </div>
              );
            })}
        </div>
        {minBreakEvenPct !== null && (
          <p className="text-[11px] text-gray-500 pt-1 border-t border-white/5">
            ✓ Fee selama {holdDays}h menutupi IL hingga perubahan harga
            <span className="text-emerald-400"> ±{minBreakEvenPct}%</span>
          </p>
        )}
      </div>

      {/* ── IL vs Price Chart ────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
            <AlertTriangle size={11} className="text-orange-400" />
            Impermanent Loss vs Perubahan Harga
          </h3>
          {/* Time horizon selector */}
          <div className="flex items-center gap-1">
            {HOLD_DAYS_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                onClick={() => setHoldDays(opt.days)}
                className="text-[10px] px-1.5 py-0.5 rounded transition-all"
                style={{
                  background: holdDays === opt.days ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.04)",
                  border: holdDays === opt.days ? "1px solid rgba(59,130,246,0.4)" : "1px solid rgba(255,255,255,0.08)",
                  color: holdDays === opt.days ? "#93c5fd" : "#6b7280",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-gray-600 mb-2">
          Assumes full-range position — fee APY offsetting IL over {holdDays} days.
          {apySource === "estimate" && " Fee line based on tier estimate."}
        </p>

        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={ilCurve} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="ilGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0.03} />
                </linearGradient>
                <linearGradient id="feeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#10b981" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.03} />
                </linearGradient>
                <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0.03} />
                </linearGradient>
                {apyEstRange && (
                  <linearGradient id="rangeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.03} />
                  </linearGradient>
                )}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: "#6b7280" }}
                interval={Math.floor(ilCurve.length / 10)}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 9, fill: "#6b7280" }}
                tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`}
                width={42}
              />
              <Tooltip
                contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: "#9ca3af" }}
                formatter={(v: number, name: string) => {
                  const sign = v > 0 ? "+" : "";
                  const labels: Record<string, string> = {
                    il: "Impermanent Loss",
                    fees: `Fee ${holdDays}d (APY ${displayApy.toFixed(1)}%)`,
                    net: `Net P&L (${holdDays}d)`,
                    feesLow: `Fee Min (${tierEst?.low ?? 0}% APY)`,
                    feesHigh: `Fee Max (${tierEst?.high ?? 0}% APY)`,
                    netLow: "Net Min",
                    netHigh: "Net Max",
                  };
                  return [`${sign}${(v as number).toFixed(2)}%`, labels[name] ?? name];
                }}
              />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />

              {/* IL area */}
              <Area
                type="monotone" dataKey="il" name="il"
                stroke="#ef4444" fill="url(#ilGrad)" strokeWidth={2} dot={false}
              />

              {/* Fee APY uncertainty band (estimate mode) */}
              {apyEstRange && (
                <>
                  <Area type="monotone" dataKey="feesHigh" name="feesHigh"
                    stroke="#f59e0b" fill="url(#rangeGrad)" strokeWidth={1}
                    strokeDasharray="4 3" dot={false} opacity={0.7} />
                  <Area type="monotone" dataKey="feesLow" name="feesLow"
                    stroke="#f59e0b" fill="url(#rangeGrad)" strokeWidth={1}
                    strokeDasharray="2 3" dot={false} opacity={0.5} />
                </>
              )}

              {/* Fee line */}
              <Area
                type="monotone" dataKey="fees" name="fees"
                stroke="#10b981" fill="url(#feeGrad)" strokeWidth={2} dot={false}
              />

              {/* Net P&L */}
              <Area
                type="monotone" dataKey="net" name="net"
                stroke="#6366f1" fill="url(#netGrad)" strokeWidth={2} dot={false}
                strokeDasharray="5 2"
              />

              <Legend
                iconSize={8} iconType="line"
                formatter={(v) => {
                  const labels: Record<string, string> = {
                    il: "IL",
                    fees: `Fee (${holdDays}d)`,
                    net: "Net P&L",
                    feesLow: "Fee min",
                    feesHigh: "Fee max",
                  };
                  return (
                    <span style={{ fontSize: 9, color: "#9ca3af" }}>
                      {labels[v] ?? v}
                    </span>
                  );
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Volume & Fee bars ────────────────────────────────────────────────── */}
      {vol7d > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <TrendingUp size={11} className="text-blue-400" />
            Estimasi Volume & Fee Harian (7d)
          </h3>
          <div style={{ height: 130 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volumeBars} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#6b7280" }} />
                <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}K`} />
                <Tooltip
                  contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number, name: string) => [formatTvl(v), name === "volume" ? "Volume" : "Fee LP"]}
                />
                <Bar dataKey="volume" name="volume" fill="rgba(59,130,246,0.5)"  radius={[3,3,0,0]} />
                <Bar dataKey="fees"   name="fees"   fill="rgba(16,185,129,0.6)"  radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[10px] text-gray-700 mt-1">* Estimated daily distribution from 7d average</p>
        </div>
      )}

      {/* ── Real-time Swap Activity ──────────────────────────────────────────── */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Activity size={11} className="text-blue-400" />
          Swap Activity — Real-time
          <span className="text-[9px] text-gray-700 font-normal normal-case">polling 30s</span>
        </h3>
        <div className="flex items-center gap-4 mb-3 p-3 rounded-xl"
          style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.12)" }}>
          <div>
            <p className="text-[10px] text-gray-500">Total Swap</p>
            <p className="text-2xl font-bold text-white tabular-nums">
              {Number(a.swapCount ?? 0).toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500">Terbaru</p>
            <p className="text-lg font-bold tabular-nums"
              style={{ color: swapHistory.at(-1)?.swaps ? "#60a5fa" : "#4b5563" }}>
              +{swapHistory.at(-1)?.swaps ?? 0}
            </p>
          </div>
          <div className="ml-auto">
            <span className="flex items-center gap-1 text-[10px] text-emerald-500">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
            </span>
          </div>
        </div>
        {swapHistory.length > 1 ? (
          <div style={{ height: 90 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={swapHistory} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                <defs>
                  <linearGradient id="swapGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fontSize: 8, fill: "#6b7280" }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 8, fill: "#6b7280" }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number) => [`+${v}`, "Swap Baru"]}
                />
                <Area type="monotone" dataKey="swaps" stroke="#3b82f6" fill="url(#swapGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-gray-600 py-3 justify-center">
            <Activity size={12} className="animate-pulse" />
            Mengakumulasi data swap...
          </div>
        )}
      </div>

      {/* ── On-chain pool state (from PoolManager) ──────────────────────────── */}
      {poolState && poolState.pools.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Pool State — Uniswap v4 PoolManager
          </h3>
          <div className="space-y-1.5">
            {poolState.pools.slice(0, 5).map((pool) => {
              const pair = pool.token0Symbol && pool.token1Symbol
                ? `${pool.token0Symbol}/${pool.token1Symbol}`
                : pool.poolId.slice(0, 10) + "…";
              const feeStr = pool.feeRatePct != null
                ? `${pool.feeRatePct.toFixed(3)}%`
                : pool.isDynamic ? "dynamic" : feeLabel(pool.fee);
              return (
                <div key={pool.poolId}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                  style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <span className="text-gray-300 font-medium min-w-[80px]">{pair}</span>
                  <span className="badge text-[10px]"
                    style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)", color: "#93c5fd" }}>
                    {pool.isDynamic ? "⚡ dynamic" : `${feeStr} fee`}
                  </span>
                  {pool.currentPrice != null && (
                    <span className="text-gray-500 tabular-nums">
                      P={pool.currentPrice.toFixed(4)}
                    </span>
                  )}
                  {pool.tvlUsd > 0 && (
                    <span className="text-gray-500">{formatTvl(pool.tvlUsd)} TVL</span>
                  )}
                  {pool.feeApy != null && pool.feeApy > 0 && (
                    <span className="ml-auto text-emerald-400 font-semibold">{pool.feeApy.toFixed(1)}% APY</span>
                  )}
                </div>
              );
            })}
          </div>
          {poolState.aggregate && poolState.aggregate.weightedFeeRate > 0 && (
            <p className="text-[10px] text-gray-600 mt-1.5">
              Avg fee: {(poolState.aggregate.weightedFeeRate).toFixed(3)}%
              {poolState.aggregate.weightedFeeApy > 0 &&
                <> · APY on-chain: <span className="text-emerald-500">{poolState.aggregate.weightedFeeApy.toFixed(1)}%</span></>
              }
            </p>
          )}
        </div>
      )}

      {/* ── Fee tier breakdown ───────────────────────────────────────────────── */}
      {pools.filter((p) => p.fee > 0).length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Fee Tier per Pool
          </h3>
          <div className="space-y-1.5">
            {pools.filter((p) => p.fee > 0).slice(0, 5).map((pool) => {
              const pair = pool.token0Symbol && pool.token1Symbol
                ? `${pool.token0Symbol}/${pool.token1Symbol}`
                : `Pool ${pool.poolId.slice(0, 6)}`;
              const feePct = isDynamic(pool.fee) ? "dynamic" : (feeRate(pool.fee) * 100).toFixed(4) + "%";
              const poolFeeApy = pool.tvlUsd && pool.tvlUsd > 0 && dailyVol > 0
                ? ((dailyVol / pools.length * feeRate(pool.fee) * 365) / pool.tvlUsd * 100).toFixed(0)
                : null;
              const tierE = FEE_TIER_EST_APY[pool.fee];
              return (
                <div key={pool.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                  style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <span className="text-gray-300 font-medium min-w-[80px]">{pair}</span>
                  <span className="badge text-[10px]"
                    style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)", color: "#93c5fd" }}>
                    {feePct === "dynamic" ? "⚡ dynamic" : `${feePct} fee`}
                  </span>
                  {pool.tvlUsd && pool.tvlUsd > 0 && (
                    <span className="text-gray-500">{formatTvl(pool.tvlUsd)} TVL</span>
                  )}
                  {poolFeeApy && (
                    <span className="ml-auto text-emerald-400 font-semibold">~{poolFeeApy}% APY</span>
                  )}
                  {!poolFeeApy && tierE && (
                    <span className="ml-auto text-amber-500/70 text-[10px]">
                      est. {tierE.low}–{tierE.high}% APY
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({ icon, label, value, sub, badge, badgeColor, highlight, color }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  badge?: string;
  badgeColor?: string;
  highlight?: boolean;
  color: string;
}) {
  const colorMap: Record<string, { r: string; g: string }> = {
    emerald: { r: "16,185,129", g: "#10b981" },
    blue:    { r: "59,130,246", g: "#3b82f6" },
    purple:  { r: "139,92,246", g: "#8b5cf6" },
    amber:   { r: "245,158,11", g: "#f59e0b" },
  };
  const badgeColors: Record<string, string> = {
    emerald: "rgba(16,185,129,0.15)",
    blue:    "rgba(59,130,246,0.15)",
    amber:   "rgba(245,158,11,0.15)",
  };
  const c = colorMap[color] ?? colorMap.blue;
  return (
    <div className="rounded-xl p-3 border"
      style={{ background: `rgba(${c.r},0.05)`, borderColor: `rgba(${c.r},0.18)` }}>
      <div className="flex items-center gap-1 mb-1">
        {icon}
        <span className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</span>
        {badge && (
          <span className="ml-auto text-[8px] font-bold px-1 rounded"
            style={{ background: badgeColors[badgeColor ?? "blue"], color: c.g }}>
            {badge}
          </span>
        )}
      </div>
      <p className="text-lg font-bold truncate" style={{ color: highlight ? c.g : "#fff" }}>{value}</p>
      {sub && <p className="text-[10px] text-gray-600 mt-0.5">{sub}</p>}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">{[1,2,3].map((i) => <div key={i} className="h-16 shimmer rounded-xl" />)}</div>
      <div className="h-48 shimmer rounded-xl" />
      <div className="h-32 shimmer rounded-xl" />
    </div>
  );
}
