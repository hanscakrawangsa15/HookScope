"use client";

import { useState, useCallback, type ReactNode } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine, AreaChart,
  Area, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Cell,
} from "recharts";
import { api, type HookDetail } from "@/lib/api";
import { RiskBadge } from "@/components/ui/risk-badge";
import { describeHook } from "@/lib/hook-descriptor";
import { shortAddress, chainName, chainIcon, formatTvl, CALLBACK_LABELS } from "@/lib/utils";
import {
  Plus, X, GitCompare, TrendingUp, Shield, Droplets, Users,
  AlertTriangle, Zap, ThumbsUp, ThumbsDown, Trophy, Info,
} from "lucide-react";

// ── Constants ────────────────────────────────────────────────────────────────
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const HOOK_COLORS  = ["#3b82f6", "#8b5cf6", "#10b981", "#f97316"] as const;
const HOOK_NAMES   = ["Hook 1", "Hook 2", "Hook 3", "Hook 4"] as const;
const DYNAMIC_FEE_FLAG = 0x800000;

// ── Types ────────────────────────────────────────────────────────────────────
interface HookAnalytics {
  tvlUsd: number;
  volume7dUsd: number;
  volume30dUsd: number;
  poolCount: number;
  uniqueLps: number;
  swapCount?: number | string;
}
interface PoolItem {
  id: string; fee: number; tvlUsd: number | null;
  token0Symbol: string | null; token1Symbol: string | null;
}
interface AnalyticsResponse {
  analytics: HookAnalytics | null;
  pools: PoolItem[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function feeRate(pip: number): number {
  if (!pip || (pip & DYNAMIC_FEE_FLAG) !== 0) return 0.003;
  return pip / 1_000_000;
}
function avgFee(pools: PoolItem[]): number {
  const s = pools.filter((p) => p.fee > 0 && (p.fee & DYNAMIC_FEE_FLAG) === 0);
  if (!s.length) return 0.003;
  return s.reduce((a, p) => a + feeRate(p.fee), 0) / s.length;
}
function calcFeeApy(a: HookAnalytics | null, pools: PoolItem[]): number {
  if (!a || !a.tvlUsd || !a.volume7dUsd) return 0;
  return ((a.volume7dUsd / 7) * avgFee(pools) * 365 / a.tvlUsd) * 100;
}
function calcIL(r: number): number {
  if (r <= 0) return 0;
  return (2 * Math.sqrt(r)) / (1 + r) - 1;
}
function fmtCompact(n: number): string {
  if (!n) return "$0";
  if (n >= 1e9) return `$${(n/1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n/1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
function winner(values: number[]): number {
  // index of max
  return values.reduce((best, v, i) => (v > values[best] ? i : best), 0);
}

// ── IL curve data ────────────────────────────────────────────────────────────
const IL_SCENARIOS = [
  { label: "-75%",  ratio: 0.25 },
  { label: "-50%",  ratio: 0.50 },
  { label: "-25%",  ratio: 0.75 },
  { label: "0%",    ratio: 1.00 },
  { label: "+25%",  ratio: 1.25 },
  { label: "+50%",  ratio: 1.50 },
  { label: "+100%", ratio: 2.00 },
  { label: "+200%", ratio: 3.00 },
  { label: "+400%", ratio: 5.00 },
];

// ── Main Component ────────────────────────────────────────────────────────────
export default function ComparePage() {
  const [addresses, setAddresses] = useState<string[]>(["", ""]);
  const [hooks,     setHooks]     = useState<(HookDetail | null)[]>([null, null]);
  const [analytics, setAnalytics] = useState<(AnalyticsResponse | null)[]>([null, null]);
  const [loading,   setLoading]   = useState<boolean[]>([false, false]);
  const [errors,    setErrors]    = useState<(string | null)[]>([null, null]);

  const fetchHook = useCallback(async (index: number, address: string) => {
    if (!address.match(/^0x[0-9a-fA-F]{40}$/)) {
      setErrors((e) => { const n = [...e]; n[index] = "Invalid address format"; return n; });
      return;
    }
    setLoading((l) => { const n = [...l]; n[index] = true; return n; });
    setErrors((e)  => { const n = [...e]; n[index] = null; return n; });
    try {
      const [hook, analytic] = await Promise.all([
        api.hooks.get(address),
        fetch(`${API_URL}/api/analytics/hook/${address}`, { cache: "no-store" })
          .then((r) => r.ok ? r.json() as Promise<AnalyticsResponse> : Promise.resolve(null))
          .catch(() => null),
      ]);
      setHooks((h)     => { const n = [...h]; n[index] = hook; return n; });
      setAnalytics((a) => { const n = [...a]; n[index] = analytic; return n; });
    } catch {
      setErrors((e) => { const n = [...e]; n[index] = "Hook not found"; return n; });
      setHooks((h) => { const n = [...h]; n[index] = null; return n; });
    } finally {
      setLoading((l) => { const n = [...l]; n[index] = false; return n; });
    }
  }, []);

  const addSlot = () => {
    if (addresses.length >= 4) return;
    setAddresses([...addresses, ""]);
    setHooks([...hooks, null]);
    setAnalytics([...analytics, null]);
    setLoading([...loading, false]);
    setErrors([...errors, null]);
  };
  const removeSlot = (i: number) => {
    setAddresses(addresses.filter((_, x) => x !== i));
    setHooks(hooks.filter((_, x) => x !== i));
    setAnalytics(analytics.filter((_, x) => x !== i));
    setLoading(loading.filter((_, x) => x !== i));
    setErrors(errors.filter((_, x) => x !== i));
  };

  // Loaded hooks paired with their analytics
  const loaded = hooks
    .map((h, i) => h ? { hook: h, anal: analytics[i], idx: i } : null)
    .filter((x): x is { hook: HookDetail; anal: AnalyticsResponse | null; idx: number } => x !== null);

  const n = loaded.length;
  const allCallbackKeys = Object.keys(CALLBACK_LABELS);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-3xl font-black text-white flex items-center gap-3">
          <GitCompare size={26} className="text-blue-400" />
          <span>Hook <span className="gradient-text">Comparator</span></span>
        </h1>
        <p className="text-gray-500 mt-1 text-sm">Compare up to 4 hooks in detail — TVL, active traders, LP fees, and IL risk</p>
      </div>

      {/* ── Address inputs ──────────────────────────────────────────────────── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${addresses.length}, 1fr)` }}>
        {addresses.map((addr, i) => (
          <div key={i} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider"
                style={{ color: HOOK_COLORS[i] }}>
                Hook {i + 1}
              </span>
              {addresses.length > 2 && (
                <button onClick={() => removeSlot(i)} className="text-gray-700 hover:text-red-400 transition-colors">
                  <X size={13} />
                </button>
              )}
            </div>
            <input
              className="input text-xs font-mono"
              placeholder="0x..."
              value={addr}
              onChange={(e) => {
                const next = [...addresses]; next[i] = e.target.value; setAddresses(next);
              }}
              onBlur={() => addr && fetchHook(i, addr)}
              onKeyDown={(e) => e.key === "Enter" && addr && fetchHook(i, addr)}
            />
            {errors[i]  && <p className="text-[11px] text-red-400">{errors[i]}</p>}
            {loading[i] && (
              <p className="text-[11px] text-gray-500 flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-blue-400 animate-ping inline-block" />
                Loading...
              </p>
            )}
            {hooks[i] && (
              <div className="text-[11px] text-gray-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: HOOK_COLORS[i] }} />
                {hooks[i]!.name ?? shortAddress(hooks[i]!.address)}
                {" · "}{chainIcon(hooks[i]!.chainId)}
              </div>
            )}
          </div>
        ))}
      </div>

      {addresses.length < 4 && (
        <button onClick={addSlot} className="btn-ghost text-sm -mt-4">
          <Plus size={13} /> Add Hook
        </button>
      )}

      {n < 2 && (
        <div className="text-center py-24 text-gray-600">
          <GitCompare size={52} className="mx-auto mb-4 opacity-20" />
          <p className="text-sm">Enter at least 2 hook addresses to start comparing</p>
          <p className="text-xs mt-1 text-gray-700">Press Enter or click outside the input field</p>
        </div>
      )}

      {n >= 2 && (
        <div className="space-y-8">

          {/* ── Hook Summary Cards ────────────────────────────────────────── */}
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
            {loaded.map(({ hook, anal, idx }) => {
              const desc = describeHook({
                callbacks: hook.callbacks, riskLevel: hook.riskLevel,
                hookScore: hook.hookScore, proxyType: hook.proxyType,
                isVerified: hook.isVerified, auditStatus: hook.auditStatus,
                poolCount: hook.poolCount, tvlUsd: hook.tvlUsd,
                chainId: hook.chainId, name: hook.name,
              });
              const feeApy = calcFeeApy(anal?.analytics ?? null, anal?.pools ?? []);
              const a = anal?.analytics;

              return (
                <div key={hook.address} className="card p-4 space-y-3"
                  style={{ borderColor: `${HOOK_COLORS[idx]}40` }}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-lg">{desc.icon}</span>
                        <span className="text-xs font-bold" style={{ color: HOOK_COLORS[idx] }}>
                          {HOOK_NAMES[idx]}
                        </span>
                      </div>
                      <p className="text-sm font-bold text-white">
                        {hook.name ?? shortAddress(hook.address, 6)}
                      </p>
                      <p className="text-[10px] font-mono text-gray-600">{shortAddress(hook.address, 8)}</p>
                    </div>
                    <RiskBadge level={hook.riskLevel} score={hook.hookScore} />
                  </div>

                  <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider"
                    style={{ color: `${HOOK_COLORS[idx]}cc` }}>
                    {desc.archetype}
                  </p>

                  {/* Mini stats */}
                  <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                    <Kv label="TVL"     value={formatTvl(a?.tvlUsd ?? hook.tvlUsd ?? 0)} color={HOOK_COLORS[idx]} />
                    <Kv label="Vol 7d"  value={formatTvl(a?.volume7dUsd ?? 0)} />
                    <Kv label="Pools"   value={String(hook.poolCount)} />
                    <Kv label="Unique LPs" value={String(a?.uniqueLps ?? "—")} />
                    <Kv label="Fee APY" value={feeApy > 0 ? `${feeApy.toFixed(1)}%` : "—"} color={feeApy > 20 ? "#10b981" : undefined} />
                    <Kv label="Callbacks" value={`${Object.values(hook.callbacks).filter(Boolean).length}/14`} />
                  </div>

                  {/* Color bar representing hookScore */}
                  {hook.hookScore != null && (
                    <div>
                      <div className="flex justify-between text-[10px] text-gray-600 mb-1">
                        <span>HookScore</span><span>{hook.hookScore}/100</span>
                      </div>
                      <div className="h-1 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${hook.hookScore}%`, background: HOOK_COLORS[idx] }} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Section: TVL & Volume Comparison ─────────────────────────── */}
          <ChartSection title="TVL & Volume Comparison" icon={<Droplets size={14} className="text-blue-400" />}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Grouped bar: TVL + Vol7d + Vol30d */}
              <div>
                <p className="text-xs text-gray-500 mb-3">TVL vs Volume (USD)</p>
                <div style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={[
                        {
                          metric: "TVL",
                          ...Object.fromEntries(loaded.map(({ hook, anal, idx }) => [
                            `hook${idx}`, anal?.analytics?.tvlUsd ?? hook.tvlUsd ?? 0,
                          ])),
                        },
                        {
                          metric: "Vol 7d",
                          ...Object.fromEntries(loaded.map(({ anal, idx }) => [
                            `hook${idx}`, anal?.analytics?.volume7dUsd ?? 0,
                          ])),
                        },
                        {
                          metric: "Vol 30d",
                          ...Object.fromEntries(loaded.map(({ anal, idx }) => [
                            `hook${idx}`, anal?.analytics?.volume30dUsd ?? 0,
                          ])),
                        },
                      ]}
                      margin={{ top: 4, right: 8, bottom: 0, left: -10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="metric" tick={{ fontSize: 11, fill: "#9ca3af" }} />
                      <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} tickFormatter={(v) => fmtCompact(v)} />
                      <Tooltip
                        contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
                        formatter={(v: number, name: string) => {
                          const idx = parseInt(name.replace("hook", ""));
                          return [fmtCompact(v), loaded[idx]?.hook.name ?? `Hook ${idx+1}`];
                        }}
                      />
                      <Legend
                        formatter={(name: string) => {
                          const idx = parseInt(name.replace("hook", ""));
                          return <span style={{ fontSize: 10, color: HOOK_COLORS[idx] }}>
                            {loaded[idx]?.hook.name ?? `Hook ${idx+1}`}
                          </span>;
                        }}
                      />
                      {loaded.map(({ idx }) => (
                        <Bar key={idx} dataKey={`hook${idx}`} fill={HOOK_COLORS[idx]}
                          opacity={0.85} radius={[3,3,0,0]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Winner badges */}
              <div className="space-y-3">
                <p className="text-xs text-gray-500 mb-3">Quick Comparison</p>
                {[
                  {
                    label: "Highest TVL",
                    icon: <Droplets size={13} />,
                    values: loaded.map(({ hook, anal }) => anal?.analytics?.tvlUsd ?? hook.tvlUsd ?? 0),
                    fmt: fmtCompact,
                    higher: true,
                  },
                  {
                    label: "Largest 7d Volume",
                    icon: <TrendingUp size={13} />,
                    values: loaded.map(({ anal }) => anal?.analytics?.volume7dUsd ?? 0),
                    fmt: fmtCompact,
                    higher: true,
                  },
                  {
                    label: "Most Active LPs",
                    icon: <Users size={13} />,
                    values: loaded.map(({ anal }) => anal?.analytics?.uniqueLps ?? 0),
                    fmt: (v: number) => String(v),
                    higher: true,
                  },
                  {
                    label: "Pool Count",
                    icon: <Zap size={13} />,
                    values: loaded.map(({ hook }) => hook.poolCount),
                    fmt: (v: number) => String(v),
                    higher: true,
                  },
                  {
                    label: "Risk Score (Safety)",
                    icon: <Shield size={13} />,
                    values: loaded.map(({ hook }) => hook.hookScore ?? 0),
                    fmt: (v: number) => `${v}/100`,
                    higher: true,
                  },
                  {
                    label: "Active Callbacks",
                    icon: <Zap size={13} />,
                    values: loaded.map(({ hook }) => Object.values(hook.callbacks).filter(Boolean).length),
                    fmt: (v: number) => `${v}/14`,
                    higher: false, // fewer is "safer"
                  },
                ].map(({ label, icon, values, fmt, higher }) => {
                  const best = higher
                    ? values.indexOf(Math.max(...values))
                    : values.indexOf(Math.min(...values));
                  return (
                    <div key={label} className="flex items-center gap-2 text-xs">
                      <span className="text-gray-600 w-4">{icon}</span>
                      <span className="text-gray-500 flex-1">{label}</span>
                      <div className="flex items-center gap-2">
                        {values.map((v, i) => (
                          <span key={i} className={`tabular-nums font-mono ${i === best ? "font-bold" : "text-gray-600"}`}
                            style={{ color: i === best ? HOOK_COLORS[i] : undefined }}>
                            {i === best && <Trophy size={9} className="inline mr-0.5" />}
                            {fmt(v)}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </ChartSection>

          {/* ── Section: Active Traders & LP Activity ─────────────────────── */}
          <ChartSection title="Trader & LP Activity" icon={<Users size={14} className="text-purple-400" />}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* LP vs Swap Count bars */}
              <div>
                <p className="text-xs text-gray-500 mb-3">Unique LPs & Total Swaps per Hook</p>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={loaded.map(({ hook, anal, idx }) => ({
                        name: hook.name ? hook.name.slice(0, 14) : `Hook ${idx+1}`,
                        lps:   anal?.analytics?.uniqueLps ?? 0,
                        swaps: Number(anal?.analytics?.swapCount ?? 0),
                        pools: hook.poolCount,
                        color: HOOK_COLORS[idx],
                      }))}
                      margin={{ top: 4, right: 8, bottom: 0, left: -10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#9ca3af" }} />
                      <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} />
                      <Tooltip
                        contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
                        formatter={(v: number, name: string) => [
                          v.toLocaleString(),
                          name === "lps" ? "Unique LPs" : name === "swaps" ? "Total Swaps" : "Pools",
                        ]}
                      />
                      <Legend formatter={(n: string) => (
                        <span style={{ fontSize: 10, color: "#9ca3af" }}>
                          {n === "lps" ? "Unique LPs" : n === "swaps" ? "Total Swaps" : "Pools"}
                        </span>
                      )} />
                      <Bar dataKey="lps" name="lps" radius={[3,3,0,0]}>
                        {loaded.map(({ idx }, i) => <Cell key={i} fill={HOOK_COLORS[idx]} />)}
                      </Bar>
                      <Bar dataKey="swaps" name="swaps" fill="#8b5cf6" opacity={0.7} radius={[3,3,0,0]} />
                      <Bar dataKey="pools" name="pools" fill="#06b6d4" opacity={0.5} radius={[3,3,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Risk Profile Radar */}
              <div>
                <p className="text-xs text-gray-500 mb-3">Security Profile (0–100)</p>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart
                      data={[
                        { dim: "Hook\nScore",    ...Object.fromEntries(loaded.map(({ hook, idx }) => [`h${idx}`, hook.hookScore ?? 50])) },
                        { dim: "Verified",        ...Object.fromEntries(loaded.map(({ hook, idx }) => [`h${idx}`, hook.isVerified ? 100 : 20])) },
                        { dim: "Audited",          ...Object.fromEntries(loaded.map(({ hook, idx }) => [`h${idx}`, hook.auditStatus === "AUDITED" ? 100 : hook.auditStatus === "FLAGGED" ? 5 : 30])) },
                        { dim: "Non-Proxy",        ...Object.fromEntries(loaded.map(({ hook, idx }) => [`h${idx}`, hook.proxyType === "NONE" ? 100 : 30])) },
                        { dim: "Low\nCallbacks",  ...Object.fromEntries(loaded.map(({ hook, idx }) => [`h${idx}`, Math.max(0, 100 - Object.values(hook.callbacks).filter(Boolean).length * 7)])) },
                        { dim: "Pool\nAdoption",  ...Object.fromEntries(loaded.map(({ hook, idx }) => [`h${idx}`, Math.min(100, hook.poolCount / 5)])) },
                      ]}
                      margin={{ top: 8, right: 24, bottom: 8, left: 24 }}
                    >
                      <PolarGrid stroke="rgba(255,255,255,0.06)" />
                      <PolarAngleAxis dataKey="dim" tick={{ fontSize: 9, fill: "#9ca3af" }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                      {loaded.map(({ hook, idx }) => (
                        <Radar
                          key={hook.address}
                          name={hook.name ?? `Hook ${idx+1}`}
                          dataKey={`h${idx}`}
                          stroke={HOOK_COLORS[idx]}
                          fill={HOOK_COLORS[idx]}
                          fillOpacity={0.12}
                          strokeWidth={1.5}
                        />
                      ))}
                      <Legend formatter={(n) => <span style={{ fontSize: 10, color: "#9ca3af" }}>{n}</span>} />
                      <Tooltip contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </ChartSection>

          {/* ── Section: Fee APY vs Impermanent Loss ──────────────────────── */}
          <ChartSection
            title="Fee LP vs Impermanent Loss"
            icon={<AlertTriangle size={14} className="text-orange-400" />}
            subtitle="Comparison of potential LP fee earnings against IL risk across various price scenarios"
          >
            {/* Fee APY summary */}
            <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
              {loaded.map(({ hook, anal, idx }) => {
                const feeApy = calcFeeApy(anal?.analytics ?? null, anal?.pools ?? []);
                const a = anal?.analytics;
                const dailyFee = feeApy / 365;
                const il100 = Math.abs(calcIL(2) * 100);
                const bedays = dailyFee > 0 ? Math.ceil(il100 / dailyFee) : null;

                return (
                  <div key={hook.address} className="rounded-xl p-4 space-y-2"
                    style={{ background: `${HOOK_COLORS[idx]}0d`, border: `1px solid ${HOOK_COLORS[idx]}30` }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: HOOK_COLORS[idx] }}>
                      {hook.name ?? shortAddress(hook.address, 6)}
                    </p>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Est. Fee APY</span>
                        <span className="font-bold" style={{ color: feeApy > 20 ? "#10b981" : feeApy > 0 ? HOOK_COLORS[idx] : "#6b7280" }}>
                          {feeApy > 0 ? `${feeApy.toFixed(1)}%` : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">IL at +100%</span>
                        <span className="text-red-400">-{il100.toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Break-even</span>
                        <span className={bedays && bedays < 30 ? "text-emerald-400" : "text-orange-400"}>
                          {bedays ? `${bedays} days` : "∞"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Avg Fee Tier</span>
                        <span className="text-gray-300">
                          {(avgFee(anal?.pools ?? []) * 100).toFixed(3)}%
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* IL Curve Comparison */}
            <div>
              <p className="text-xs text-gray-500 mb-3">
                IL Curve + Net P&L (30-day fee - IL) per price change scenario
              </p>
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={IL_SCENARIOS.map(({ label, ratio }) => {
                      const ilPct = calcIL(ratio) * 100;
                      const row: Record<string, number | string> = { label, il: parseFloat(ilPct.toFixed(2)) };
                      loaded.forEach(({ anal, idx }) => {
                        const feeApy = calcFeeApy(anal?.analytics ?? null, anal?.pools ?? []);
                        const fee30d = feeApy / 365 * 30;
                        row[`net${idx}`] = parseFloat((ilPct + fee30d).toFixed(2));
                        row[`fee${idx}`] = parseFloat(fee30d.toFixed(2));
                      });
                      return row;
                    })}
                    margin={{ top: 4, right: 8, bottom: 0, left: -10 }}
                  >
                    <defs>
                      <linearGradient id="ilGradC" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0}   />
                      </linearGradient>
                      {loaded.map(({ idx }) => (
                        <linearGradient key={idx} id={`netGrad${idx}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={HOOK_COLORS[idx]} stopOpacity={0.25} />
                          <stop offset="95%" stopColor={HOOK_COLORS[idx]} stopOpacity={0}    />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} />
                    <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      contentStyle={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
                      formatter={(v: number, name: string) => {
                        if (name === "il") return [`${v > 0 ? "+" : ""}${v.toFixed(2)}%`, "Impermanent Loss"];
                        const m = name.match(/(net|fee)(\d)/);
                        if (m) {
                          const i = parseInt(m[2]);
                          const label = m[1] === "net" ? "Net P&L" : "Fee 30d";
                          return [`${v > 0 ? "+" : ""}${v.toFixed(2)}%`, `${label} (${loaded[i]?.hook.name ?? `Hook ${i+1}`})`];
                        }
                        return [v, name];
                      }}
                    />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 2" />
                    {/* IL curve (common to all) */}
                    <Area type="monotone" dataKey="il" stroke="#ef4444" fill="url(#ilGradC)"
                      strokeWidth={2} dot={false} name="il" />
                    {/* Net P&L per hook */}
                    {loaded.map(({ idx }) => (
                      <Area key={idx} type="monotone" dataKey={`net${idx}`}
                        stroke={HOOK_COLORS[idx]} fill={`url(#netGrad${idx})`}
                        strokeWidth={1.5} dot={false} strokeDasharray="5 2"
                        name={`net${idx}`} />
                    ))}
                    <Legend
                      formatter={(name: string) => {
                        if (name === "il") return <span style={{ fontSize: 10, color: "#ef4444" }}>Impermanent Loss</span>;
                        const m = name.match(/net(\d)/);
                        if (m) {
                          const i = parseInt(m[1]);
                          return <span style={{ fontSize: 10, color: HOOK_COLORS[i] }}>
                            Net P&L {loaded[i]?.hook.name ?? `H${i+1}`}
                          </span>;
                        }
                        return <span style={{ fontSize: 10 }}>{name}</span>;
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[10px] text-gray-700 mt-2">
                * Red IL = loss from price divergence. Dashed line = Net P&L after estimated 30-day fees.
                The higher the net line above 0%, the more profitable it is for LPs.
              </p>
            </div>
          </ChartSection>

          {/* ── Section: Pros/Cons Comparison ────────────────────────────── */}
          <ChartSection title="Pros & Cons" icon={<Info size={14} className="text-indigo-400" />}>
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
              {loaded.map(({ hook, idx }) => {
                const desc = describeHook({
                  callbacks: hook.callbacks, riskLevel: hook.riskLevel,
                  hookScore: hook.hookScore, proxyType: hook.proxyType,
                  isVerified: hook.isVerified, auditStatus: hook.auditStatus,
                  poolCount: hook.poolCount, tvlUsd: hook.tvlUsd,
                  chainId: hook.chainId, name: hook.name,
                });
                return (
                  <div key={hook.address} className="space-y-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">{desc.icon}</span>
                      <span className="text-xs font-bold" style={{ color: HOOK_COLORS[idx] }}>{desc.archetype}</span>
                    </div>
                    <p className="text-[11px] text-gray-400 leading-relaxed">{desc.summary.slice(0, 200)}…</p>

                    <div>
                      <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <ThumbsUp size={9} /> Pros
                      </p>
                      <ul className="space-y-1">
                        {desc.pros.slice(0, 3).map((p, i) => (
                          <li key={i} className="text-[11px] text-gray-400 flex items-start gap-1.5">
                            <span className="text-emerald-500 mt-0.5 text-[9px] flex-shrink-0">✓</span>{p}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-red-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <ThumbsDown size={9} /> Cons
                      </p>
                      <ul className="space-y-1">
                        {desc.cons.slice(0, 3).map((c, i) => (
                          <li key={i} className="text-[11px] text-gray-400 flex items-start gap-1.5">
                            <span className="text-red-500 mt-0.5 text-[9px] flex-shrink-0">✗</span>{c}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                );
              })}
            </div>
          </ChartSection>

          {/* ── Section: Callback Matrix ─────────────────────────────────── */}
          <ChartSection title="Callback Matrix" icon={<Zap size={14} className="text-yellow-400" />}
            subtitle="Yellow = differences between hooks">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="py-2 px-3 text-left text-gray-500 w-44">Callback</th>
                    {loaded.map(({ hook, idx }) => (
                      <th key={hook.address} className="py-2 px-3 text-center font-mono"
                        style={{ color: HOOK_COLORS[idx] }}>
                        {shortAddress(hook.address, 4)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {allCallbackKeys.map((key) => {
                    const vals = loaded.map((x) => x.hook.callbacks[key] ?? false);
                    const allSame = vals.every((v) => v === vals[0]);
                    const isDelta = key.includes("ReturnsDelta");
                    return (
                      <tr key={key}
                        className={!allSame ? "bg-yellow-500/5" : "hover:bg-white/2"}
                        style={{ transition: "background 0.15s" }}>
                        <td className="py-2 px-3 font-mono"
                          style={{ color: isDelta ? "#c084fc" : "#9ca3af" }}>
                          {CALLBACK_LABELS[key] ?? key}
                          {isDelta && <span className="ml-1 text-[9px] text-purple-600">Δ</span>}
                        </td>
                        {vals.map((v, i) => (
                          <td key={i} className="py-2 px-3 text-center">
                            {v
                              ? <span className="font-bold text-sm" style={{ color: HOOK_COLORS[loaded[i].idx] }}>✓</span>
                              : <span className="text-gray-800">—</span>}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ChartSection>

          {/* ── Section: Overview Table ───────────────────────────────────── */}
          <ChartSection title="Property Details" icon={<Shield size={14} className="text-gray-400" />}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/8">
                  <th className="p-3 text-left text-gray-600 font-medium text-xs w-36">Property</th>
                  {loaded.map(({ hook, idx }) => (
                    <th key={hook.address} className="p-3 text-left font-medium">
                      <div className="font-mono text-xs mb-0.5" style={{ color: HOOK_COLORS[idx] }}>
                        {shortAddress(hook.address, 6)}
                      </div>
                      {hook.name && <div className="text-white text-xs">{hook.name}</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                <TR label="Risk Level">
                  {loaded.map(({ hook }) => (
                    <td key={hook.address} className="p-3">
                      <RiskBadge level={hook.riskLevel} score={hook.hookScore} />
                    </td>
                  ))}
                </TR>
                <TR label="Audit Status">
                  {loaded.map(({ hook }) => (
                    <td key={hook.address} className="p-3 text-xs"
                      style={{ color: hook.auditStatus === "AUDITED" ? "#4ade80" : hook.auditStatus === "FLAGGED" ? "#f87171" : "#9ca3af" }}>
                      {hook.auditStatus}
                    </td>
                  ))}
                </TR>
                <TR label="Source Code">
                  {loaded.map(({ hook }) => (
                    <td key={hook.address} className="p-3 text-xs">
                      <span className={hook.isVerified ? "text-green-400" : "text-gray-600"}>
                        {hook.isVerified ? "✓ Verified" : "✗ Unverified"}
                      </span>
                    </td>
                  ))}
                </TR>
                <TR label="Chain">
                  {loaded.map(({ hook }) => (
                    <td key={hook.address} className="p-3 text-xs text-gray-400">
                      {chainIcon(hook.chainId)} {chainName(hook.chainId)}
                    </td>
                  ))}
                </TR>
                <TR label="Proxy">
                  {loaded.map(({ hook }) => (
                    <td key={hook.address} className="p-3 text-xs"
                      style={{ color: hook.proxyType === "NONE" ? "#4ade80" : "#fb923c" }}>
                      {hook.proxyType}
                    </td>
                  ))}
                </TR>
                <TR label="TVL">
                  {loaded.map(({ hook, anal }) => (
                    <td key={hook.address} className="p-3 text-xs text-blue-400 font-medium">
                      {formatTvl(anal?.analytics?.tvlUsd ?? hook.tvlUsd ?? 0)}
                    </td>
                  ))}
                </TR>
                <TR label="Volume 7d">
                  {loaded.map(({ hook, anal }) => (
                    <td key={hook.address} className="p-3 text-xs text-gray-300">
                      {formatTvl(anal?.analytics?.volume7dUsd ?? 0)}
                    </td>
                  ))}
                </TR>
                <TR label="Unique LPs">
                  {loaded.map(({ hook, anal }) => (
                    <td key={hook.address} className="p-3 text-xs text-gray-300">
                      {anal?.analytics?.uniqueLps ?? "—"}
                    </td>
                  ))}
                </TR>
                <TR label="Pools">
                  {loaded.map(({ hook }) => (
                    <td key={hook.address} className="p-3 text-xs text-gray-300">{hook.poolCount}</td>
                  ))}
                </TR>
                <TR label="Deployer">
                  {loaded.map(({ hook }) => (
                    <td key={hook.address} className="p-3 text-xs font-mono text-gray-500">
                      {hook.deployer ? shortAddress(hook.deployer) : "—"}
                    </td>
                  ))}
                </TR>
              </tbody>
            </table>
          </ChartSection>

          {/* ── Security Flags ───────────────────────────────────────────── */}
          <ChartSection title="Security Flags" icon={<Shield size={14} className="text-red-400" />}>
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
              {loaded.map(({ hook, idx }) => (
                <div key={hook.address}>
                  <p className="text-xs font-mono mb-2" style={{ color: HOOK_COLORS[idx] }}>
                    {shortAddress(hook.address)}
                  </p>
                  {hook.securityFlags.length === 0 ? (
                    <p className="text-[11px] text-gray-600">No security flags detected</p>
                  ) : (
                    <div className="space-y-1.5">
                      {hook.securityFlags.map((f) => (
                        <div key={f.id} className="text-[11px] p-2 rounded-lg"
                          style={{
                            background: f.severity === "CRITICAL" ? "rgba(239,68,68,0.1)" : "rgba(249,115,22,0.08)",
                            border: `1px solid ${f.severity === "CRITICAL" ? "rgba(239,68,68,0.25)" : "rgba(249,115,22,0.2)"}`,
                            color: f.severity === "CRITICAL" ? "#fca5a5" : "#fdba74",
                          }}>
                          <span className="font-semibold">{f.category}</span>
                          <span className="opacity-70 ml-1">· {f.severity}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ChartSection>

        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ChartSection({ title, icon, subtitle, children }: {
  title: string; icon?: ReactNode; subtitle?: string; children: ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wider">{title}</h2>
      </div>
      {subtitle && <p className="text-[10px] text-gray-600 mb-4">{subtitle}</p>}
      {!subtitle && <div className="mb-4" />}
      {children}
    </section>
  );
}

function Kv({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col" style={{ background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: "4px 8px" }}>
      <span className="text-[9px] text-gray-600 uppercase tracking-wide">{label}</span>
      <span className="font-semibold tabular-nums" style={{ color: color ?? "#e2e8f0", fontSize: 12 }}>{value}</span>
    </div>
  );
}

function TR({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr>
      <td className="p-3 text-gray-600 font-medium text-xs">{label}</td>
      {children}
    </tr>
  );
}
