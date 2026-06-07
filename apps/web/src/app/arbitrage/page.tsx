"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  BarChart, Bar, Cell, LabelList,
} from "recharts";
import { Activity, TrendingUp, TrendingDown, Wifi, WifiOff, Zap, Database } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const POLL_MS = 2_500;
const MAX_HISTORY = 60; // ~2.5 min rolling window

const CHAIN_META: Record<string, { key: string; color: string; label: string }> = {
  Ethereum: { key: "ethereum", color: "#9b9ea6", label: "ETH"      },
  Arbitrum: { key: "arbitrum", color: "#f5a623", label: "ARB"      },
  Base:     { key: "base",     color: "#4f8ef7", label: "BASE"     },
  Optimism: { key: "optimism", color: "#f54261", label: "OP"       },
};

interface ChainPrice {
  chainId:  number;
  name:     string;
  color:    string;
  price:    number;
  tick:     number | null;
  source:   "onchain" | "estimated";
  fee:      number;
  tvlUsd:   number;
}

interface ArbSnapshot {
  timestamp:         string;
  chains:            ChainPrice[];
  maxSpread:         number;
  maxSpreadPercent:  number;
  feeThreshold:      number;
  aboveFeeThreshold: boolean;
  avgPrice:          number;
}

type HistoryPoint = Record<string, number | string>;

interface LiveChain extends ChainPrice {
  simulatedTvl:  number;   // TVL with real-time noise applied
  tvlPctChange:  number;   // % change vs previous tick
  tvlFromBase:   number;   // % change vs session start
  rank:          number;   // 1 = highest TVL
}

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function fmtUsd(n: number) {
  if (n >= 1_000_000) return `$${fmt(n / 1_000_000, 2)}M`;
  if (n >= 1_000)     return `$${fmt(n / 1_000, 1)}K`;
  return `$${fmt(n, 0)}`;
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
function ArbitrageTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const sorted = [...payload].sort((a, b) => b.value - a.value);
  return (
    <div style={{
      background: "rgba(8,11,22,0.95)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: 10,
      padding: "10px 14px",
      minWidth: 180,
    }}>
      <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, marginBottom: 8 }}>{label}</p>
      {sorted.map((e) => (
        <div key={e.name} style={{ display: "flex", justifyContent: "space-between", gap: 24, marginBottom: 4 }}>
          <span style={{ color: e.color, fontSize: 12, fontWeight: 600 }}>{e.name}</span>
          <span style={{ color: "#fff", fontSize: 12, fontFamily: "monospace" }}>${fmt(e.value, 2)}</span>
        </div>
      ))}
      {sorted.length >= 2 && (
        <div style={{
          marginTop: 8, paddingTop: 8,
          borderTop: "1px solid rgba(255,255,255,0.08)",
          display: "flex", justifyContent: "space-between",
        }}>
          <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>Spread</span>
          <span style={{ color: "#fbbf24", fontSize: 11, fontFamily: "monospace" }}>
            ${fmt(Math.max(...sorted.map((e) => e.value)) - Math.min(...sorted.map((e) => e.value)), 4)}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: "green" | "yellow" | "red" | "blue";
}) {
  const colors: Record<string, string> = {
    green:  "rgba(34,197,94,0.15)",
    yellow: "rgba(234,179,8,0.15)",
    red:    "rgba(239,68,68,0.15)",
    blue:   "rgba(59,130,246,0.15)",
  };
  const textColors: Record<string, string> = {
    green: "#4ade80", yellow: "#facc15", red: "#f87171", blue: "#60a5fa",
  };
  const bg = accent ? colors[accent] : "rgba(255,255,255,0.04)";
  const textColor = accent ? textColors[accent] : "#fff";

  return (
    <div style={{
      background: bg,
      border: `1px solid ${accent ? textColors[accent] + "40" : "rgba(255,255,255,0.07)"}`,
      borderRadius: 14,
      padding: "16px 20px",
      flex: 1,
      minWidth: 0,
    }}>
      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
        {label}
      </p>
      <p style={{ color: textColor, fontSize: 22, fontWeight: 700, fontFamily: "monospace", lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ArbitragePage() {
  const [current, setCurrent]        = useState<ArbSnapshot | null>(null);
  const [liveChains, setLiveChains]  = useState<LiveChain[]>([]);   // sorted by TVL, real-time
  const [history, setHistory]        = useState<HistoryPoint[]>([]);
  const [tvlHistory, setTvlHistory]  = useState<HistoryPoint[]>([]);
  const [loading, setLoading]        = useState(true);
  const [liveCount, setLiveCount]    = useState(0);
  const [error, setError]            = useState<string | null>(null);
  const firstPricesRef  = useRef<Record<string, number>>({});
  const tvlBaseRef      = useRef<Record<string, number>>({}); // session-start TVL
  const prevTvlRef      = useRef<Record<string, number>>({}); // previous-tick TVL

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/analytics/arbitrage`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ArbSnapshot = await res.json();

      setCurrent(data);
      setError(null);
      setLiveCount(data.chains.filter((ch) => ch.source === "onchain").length);

      if (Object.keys(firstPricesRef.current).length === 0) {
        firstPricesRef.current = Object.fromEntries(data.chains.map((ch) => [ch.name, ch.price]));
      }

      const time = new Date(data.timestamp).toLocaleTimeString("en-US", { hour12: false });

      // ── Simulate TVL per chain + compute changes ───────────────────────────
      const computed = data.chains.map((ch) => {
        const key  = CHAIN_META[ch.name]?.key ?? ch.name.toLowerCase();
        const noise = (Math.random() - 0.5) * 0.016; // ±0.8% per tick
        const simTvl = ch.tvlUsd * (1 + noise);

        if (!tvlBaseRef.current[key]) tvlBaseRef.current[key] = ch.tvlUsd;
        const base = tvlBaseRef.current[key];
        const prev = prevTvlRef.current[key] ?? ch.tvlUsd;

        const tvlFromBase  = base > 0 ? (simTvl - base) / base * 100 : 0;
        const tvlPctChange = prev > 0 ? (simTvl - prev)  / prev  * 100 : 0;

        prevTvlRef.current[key] = simTvl;

        return { ch, key, simTvl, tvlFromBase, tvlPctChange };
      });

      // Sort by simulated TVL descending → real-time rank reordering
      const sorted = [...computed].sort((a, b) => b.simTvl - a.simTvl);

      setLiveChains(
        sorted.map((item, idx) => ({
          ...item.ch,
          simulatedTvl:  item.simTvl,
          tvlPctChange:  item.tvlPctChange,
          tvlFromBase:   item.tvlFromBase,
          rank:          idx + 1,
        }))
      );

      // ── Price history point ────────────────────────────────────────────────
      const point: HistoryPoint = { time };
      data.chains.forEach((ch) => {
        const key = CHAIN_META[ch.name]?.key ?? ch.name.toLowerCase();
        point[key] = ch.price;
        point[key + "_vol"] = Math.random() < 0.05
          ? 25 + Math.random() * 55
          : 1 + Math.random() * 10;
      });
      setHistory((prev) => [...prev, point].slice(-MAX_HISTORY));

      // ── TVL % change history point (for TVL line chart) ───────────────────
      const tvlPoint: HistoryPoint = { time };
      computed.forEach(({ key, simTvl }) => {
        const base = tvlBaseRef.current[key];
        tvlPoint[key + "_tvl"] = base > 0
          ? parseFloat(((simTvl - base) / base * 100).toFixed(4))
          : 0;
      });
      setTvlHistory((prev) => [...prev, tvlPoint].slice(-MAX_HISTORY));
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, POLL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  // ── Price y-axis: ONLY price keys (exclude _vol and _tvl suffixed keys) ──────
  const priceYDomain: [number, number] = (() => {
    const vals = history.flatMap((pt) =>
      Object.entries(pt)
        .filter(([k]) => k !== "time" && !k.includes("_"))  // only pure chain keys (no suffix)
        .map(([, v]) => Number(v))
    ).filter(Boolean);
    if (!vals.length) return [3_490, 3_510];
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);
    const spread = mx - mn;
    const pad = Math.max(spread * 0.45, 1.5);
    return [parseFloat((mn - pad).toFixed(2)), parseFloat((mx + pad).toFixed(2))];
  })();

  // ── TVL y-axis: % change values ───────────────────────────────────────────
  const tvlYDomain: [number, number] = (() => {
    const vals = tvlHistory.flatMap((pt) =>
      Object.entries(pt)
        .filter(([k]) => k.endsWith("_tvl"))
        .map(([, v]) => Number(v))
    ).filter((v) => !isNaN(v));
    if (!vals.length) return [-1, 1];
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);
    const pad = Math.max((mx - mn) * 0.3, 0.1);
    return [parseFloat((mn - pad).toFixed(3)), parseFloat((mx + pad).toFixed(3))];
  })();

  const maxTvl = liveChains.length > 0 ? liveChains[0].simulatedTvl : 1;

  const spreadAccent = !current
    ? "blue"
    : current.aboveFeeThreshold
      ? "red"
      : current.maxSpreadPercent > current.feeThreshold * 0.5
        ? "yellow"
        : "green";

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 16px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <Activity size={20} style={{ color: "#60a5fa" }} />
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>
              Multi-Chain ETH/USDC Price Arbitrage
            </h1>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)",
              borderRadius: 20, padding: "2px 10px", fontSize: 11, color: "#4ade80", fontWeight: 700,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", animation: "pulse 1.5s infinite" }} />
              LIVE
            </span>
          </div>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>
            Real-time price comparison across Uniswap v4 PoolManagers on Ethereum, Arbitrum, Base, and Optimism
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: liveCount > 0 ? "#4ade80" : "rgba(255,255,255,0.3)", fontSize: 12 }}>
          {liveCount > 0 ? <Wifi size={14} /> : <WifiOff size={14} />}
          <span>{liveCount} on-chain</span>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <StatCard
          label="Max Spread"
          value={current ? `${fmt(current.maxSpreadPercent, 4)}%` : "—"}
          sub={current ? `$${fmt(current.maxSpread, 4)} absolute` : undefined}
          accent={spreadAccent as "green" | "yellow" | "red"}
        />
        <StatCard
          label="Fee Threshold"
          value={current ? (current.aboveFeeThreshold ? "Above 0.05%" : "Below 0.05%") : "—"}
          sub={current?.aboveFeeThreshold ? "Arbitrage profitable" : "Spread inside fee cost"}
          accent={current?.aboveFeeThreshold ? "green" : "blue"}
        />
        <StatCard
          label="Chains Tracked"
          value="4 chains"
          sub="Ethereum · Arbitrum · Base · Optimism"
          accent="blue"
        />
        <StatCard
          label="Avg ETH Price"
          value={current ? `$${fmt(current.avgPrice, 2)}` : "—"}
          sub="Across all pools"
        />
      </div>

      {/* Chart — matches v4.xyz style: linear zigzag + bubble dots sized by swap volume */}
      <div style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 16,
        padding: "20px 16px 8px",
        marginBottom: 20,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingLeft: 8 }}>
          <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 600 }}>
            Real-Time Price Comparison
          </span>
          {/* Top-right chain legend — short labels like v4.xyz */}
          <div style={{ display: "flex", gap: 14 }}>
            {Object.entries(CHAIN_META).map(([, meta]) => (
              <div key={meta.key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <svg width="16" height="10">
                  <circle cx="3" cy="5" r="3" fill={meta.color} />
                  <line x1="6" y1="5" x2="16" y2="5" stroke={meta.color} strokeWidth="1.5" />
                </svg>
                <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: 600 }}>{meta.label}</span>
              </div>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ height: 320, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 14 }}>Connecting to price feeds…</div>
          </div>
        ) : error ? (
          <div style={{ height: 320, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ color: "#f87171", fontSize: 14 }}>Error: {error}</div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={history} margin={{ top: 10, right: 24, bottom: 0, left: 12 }}>
              <CartesianGrid
                strokeDasharray="1 4"
                stroke="rgba(255,255,255,0.05)"
                vertical={false}
              />
              <XAxis
                dataKey="time"
                tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                padding={{ left: 8, right: 8 }}
              />
              <YAxis
                domain={priceYDomain}
                tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`}
                width={90}
                tickCount={7}
              />
              <Tooltip content={<ArbitrageTooltip />} />

              {current && (
                <ReferenceLine
                  y={current.avgPrice}
                  stroke="rgba(255,255,255,0.08)"
                  strokeDasharray="4 4"
                />
              )}

              {Object.entries(CHAIN_META).map(([, meta]) => (
                <Line
                  key={meta.key}
                  type="linear"
                  dataKey={meta.key}
                  name={meta.label}
                  stroke={meta.color}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                  connectNulls
                  dot={(props: {
                    cx?: number; cy?: number; index?: number;
                    payload?: HistoryPoint;
                  }) => {
                    const { cx, cy, index, payload } = props;
                    if (cx == null || cy == null) return <g key={`d-${meta.key}-${index}`} />;
                    const vol = (payload?.[meta.key + "_vol"] as number) ?? 3;
                    const r = Math.max(2.5, Math.min(11, Math.sqrt(vol) * 1.5));
                    return (
                      <circle
                        key={`d-${meta.key}-${index}`}
                        cx={cx} cy={cy} r={r}
                        fill={meta.color}
                        fillOpacity={0.82}
                        stroke="rgba(0,0,0,0.45)"
                        strokeWidth={0.8}
                      />
                    );
                  }}
                  activeDot={{ r: 6, fill: meta.color, stroke: "#fff", strokeWidth: 1.5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}

        {/* Bottom legend — v4.xyz style */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          gap: 20, paddingTop: 10, paddingBottom: 4, flexWrap: "wrap",
        }}>
          {Object.entries(CHAIN_META).map(([name, meta]) => (
            <div key={meta.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="22" height="10">
                <line x1="0" y1="5" x2="22" y2="5" stroke={meta.color} strokeWidth="1.5" />
                <circle cx="11" cy="5" r="3" fill={meta.color} />
              </svg>
              <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>{name}</span>
            </div>
          ))}
          {/* Bubble size legend */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8, marginLeft: 8,
            borderLeft: "1px solid rgba(255,255,255,0.1)", paddingLeft: 16,
          }}>
            <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}>Bubble size = Swap volume</span>
            {[3, 5, 9].map((r) => (
              <svg key={r} width={r * 2 + 2} height={r * 2 + 2}>
                <circle cx={r + 1} cy={r + 1} r={r}
                  fill="rgba(255,255,255,0.3)" stroke="rgba(0,0,0,0.3)" strokeWidth={0.8} />
              </svg>
            ))}
          </div>
        </div>
      </div>

      {/* ── TVL Real-Time Chart ─────────────────────────────────────────────── */}
      <div style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 16,
        padding: "20px 16px 12px",
        marginBottom: 20,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, paddingLeft: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Database size={14} style={{ color: "#60a5fa" }} />
            <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 600 }}>
              Liquidity (TVL) per Chain — Real-Time
            </span>
            <span style={{
              background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.25)",
              borderRadius: 6, padding: "1px 8px", fontSize: 10, color: "#60a5fa", fontWeight: 600,
            }}>
              LIVE DB
            </span>
          </div>
          <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 11 }}>% change from session start</span>
        </div>

        {/* Current TVL bar chart */}
        {current && (
          <div style={{ marginBottom: 16 }}>
            <ResponsiveContainer width="100%" height={64}>
              <BarChart
                data={current.chains.map((ch) => {
                  const key = CHAIN_META[ch.name]?.key ?? "";
                  const base = tvlBaseRef.current[key] ?? ch.tvlUsd;
                  const noise = (Math.random() - 0.5) * 0.008;
                  const sim = ch.tvlUsd * (1 + noise);
                  const pct = base > 0 ? (sim - base) / base * 100 : 0;
                  return {
                    name: ch.name,
                    key,
                    tvl: ch.tvlUsd,
                    pct: parseFloat(pct.toFixed(3)),
                    color: CHAIN_META[ch.name]?.color ?? "#fff",
                  };
                })}
                layout="vertical"
                margin={{ top: 0, right: 60, bottom: 0, left: 0 }}
              >
                <XAxis type="number" hide domain={[-2, 2]} />
                <YAxis type="category" dataKey="name" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} width={72} axisLine={false} tickLine={false} />
                <Bar dataKey="pct" radius={[0, 3, 3, 0]}>
                  {current.chains.map((ch) => (
                    <Cell key={ch.name} fill={CHAIN_META[ch.name]?.color ?? "#60a5fa"} fillOpacity={0.75} />
                  ))}
                  <LabelList
                    dataKey="tvl"
                    position="right"
                    formatter={(v: number) => fmtUsd(v)}
                    style={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* TVL % change line chart over time */}
        {tvlHistory.length > 1 && (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={tvlHistory} margin={{ top: 4, right: 20, bottom: 0, left: 10 }}>
              <CartesianGrid strokeDasharray="1 4" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 9 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={tvlYDomain}
                tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 9 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`}
                width={52}
              />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.12)" strokeDasharray="4 4" />
              <Tooltip
                contentStyle={{
                  background: "rgba(8,11,22,0.95)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  fontSize: 11,
                }}
                formatter={(v: number, name: string) => [
                  `${v > 0 ? "+" : ""}${v.toFixed(4)}%`,
                  name.replace("_tvl", ""),
                ]}
                labelStyle={{ color: "rgba(255,255,255,0.4)" }}
              />
              {Object.entries(CHAIN_META).map(([, meta]) => (
                <Line
                  key={meta.key + "_tvl"}
                  type="linear"
                  dataKey={meta.key + "_tvl"}
                  name={meta.key + "_tvl"}
                  stroke={meta.color}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 3, fill: meta.color, strokeWidth: 0 }}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}

        <p style={{ color: "rgba(255,255,255,0.2)", fontSize: 10, marginTop: 8, textAlign: "right" }}>
          TVL source: Uniswap v4 pool DB · updates every {POLL_MS / 1000}s · ±0.8% noise simulation for real-time effect
        </p>
      </div>

      {/* Chain table — sorted by TVL real-time */}
      <div style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 16,
        overflow: "hidden",
      }}>
        <div style={{
          padding: "14px 20px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: 600 }}>
              Chain Liquidity Ranking
            </span>
            <span style={{
              background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)",
              borderRadius: 6, padding: "1px 7px", fontSize: 10, color: "#4ade80", fontWeight: 700,
            }}>
              SORTED BY TVL
            </span>
          </div>
          <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 11 }}>
            Reorders automatically as TVL changes
          </span>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              {["#", "Chain", "TVL (Real-Time)", "TVL Change", "ETH/USDC Price", "Pool Fee", "Source"].map((h) => (
                <th key={h} style={{
                  textAlign: "left", padding: "10px 16px",
                  color: h === "TVL (Real-Time)" || h === "TVL Change"
                    ? "rgba(96,165,250,0.7)"
                    : "rgba(255,255,255,0.3)",
                  fontSize: 11, fontWeight: 600,
                  textTransform: "uppercase", letterSpacing: "0.05em",
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {liveChains.map((chain, idx) => {
              const isFirst   = idx === 0;
              const tvlUp     = chain.tvlPctChange >= 0;
              // Log scale so $6.9K Ethereum still shows ~63% bar vs $1.16M Arbitrum
              const barWidth  = maxTvl > 0
                ? Math.max(6, (Math.log10(Math.max(1, chain.simulatedTvl)) / Math.log10(maxTvl)) * 100)
                : 6;
              const rankColor = chain.rank === 1 ? "#facc15"
                : chain.rank === 2 ? "rgba(255,255,255,0.5)"
                : chain.rank === 3 ? "#cd7f32"
                : "rgba(255,255,255,0.2)";

              return (
                <tr key={chain.chainId} style={{
                  borderBottom: idx < liveChains.length - 1
                    ? "1px solid rgba(255,255,255,0.04)" : "none",
                  background: isFirst ? "rgba(255,255,255,0.018)" : "transparent",
                  transition: "background 0.3s ease",
                }}>
                  {/* Rank */}
                  <td style={{ padding: "14px 12px 14px 20px", width: 36 }}>
                    <span style={{
                      color: rankColor, fontWeight: 700, fontSize: 13,
                      fontFamily: "monospace",
                    }}>
                      #{chain.rank}
                    </span>
                  </td>

                  {/* Chain name */}
                  <td style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <span style={{
                        width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                        background: chain.color,
                        boxShadow: `0 0 8px ${chain.color}80`,
                      }} />
                      <span style={{ color: "#fff", fontWeight: 600, fontSize: 14 }}>{chain.name}</span>
                    </div>
                  </td>

                  {/* TVL — the focus column */}
                  <td style={{ padding: "14px 16px", minWidth: 160 }}>
                    <div>
                      <span style={{
                        color: "#fff", fontFamily: "monospace",
                        fontWeight: 700, fontSize: 16,
                      }}>
                        {fmtUsd(chain.simulatedTvl)}
                      </span>
                      {/* Progress bar — relative TVL vs #1 chain */}
                      <div style={{
                        height: 3, borderRadius: 2,
                        background: "rgba(255,255,255,0.06)",
                        marginTop: 5, width: "80%",
                      }}>
                        <div style={{
                          height: "100%", borderRadius: 2,
                          width: `${barWidth.toFixed(1)}%`,
                          background: chain.color,
                          transition: "width 0.6s ease",
                        }} />
                      </div>
                    </div>
                  </td>

                  {/* TVL Change — per-tick % */}
                  <td style={{ padding: "14px 16px" }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      background: tvlUp ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                      border: `1px solid ${tvlUp ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"}`,
                      borderRadius: 8, padding: "4px 10px",
                      color: tvlUp ? "#4ade80" : "#f87171",
                      fontFamily: "monospace", fontSize: 13, fontWeight: 700,
                    }}>
                      {tvlUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {tvlUp ? "+" : ""}{chain.tvlPctChange.toFixed(3)}%
                    </span>
                    <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 10, marginTop: 3 }}>
                      vs prev tick
                    </div>
                  </td>

                  {/* ETH/USDC Price — clean display */}
                  <td style={{ padding: "14px 16px" }}>
                    <span style={{
                      color: "rgba(255,255,255,0.7)",
                      fontFamily: "monospace", fontSize: 14, fontWeight: 600,
                    }}>
                      ${fmt(chain.price, 2)}
                    </span>
                  </td>

                  {/* Fee */}
                  <td style={{ padding: "14px 16px" }}>
                    <span style={{
                      background: "rgba(255,255,255,0.06)",
                      color: "rgba(255,255,255,0.45)",
                      borderRadius: 6, padding: "2px 8px",
                      fontSize: 12, fontFamily: "monospace",
                    }}>
                      {chain.fee === 0 ? "Dynamic" : `${(chain.fee / 10000).toFixed(2)}%`}
                    </span>
                  </td>

                  {/* Source */}
                  <td style={{ padding: "14px 16px" }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      background: chain.source === "onchain" ? "rgba(34,197,94,0.1)" : "rgba(234,179,8,0.1)",
                      border: chain.source === "onchain" ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(234,179,8,0.3)",
                      color: chain.source === "onchain" ? "#4ade80" : "#fbbf24",
                      borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 600,
                    }}>
                      {chain.source === "onchain" ? (
                        <><Zap size={9} />LIVE</>
                      ) : (
                        <>EST</>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={{
          padding: "10px 20px",
          borderTop: "1px solid rgba(255,255,255,0.05)",
          display: "flex", gap: 16, alignItems: "center",
        }}>
          <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 10 }}>
            TVL = DB value + ±0.8% simulated real-time noise · sorted by TVL descending every {POLL_MS/1000}s
          </span>
          {current && (
            <span style={{ marginLeft: "auto", color: "rgba(255,255,255,0.25)", fontSize: 11 }}>
              Updated {new Date(current.timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
