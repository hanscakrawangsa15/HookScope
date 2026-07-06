"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  BarChart, Bar, Cell, LabelList,
} from "recharts";
import { Activity, TrendingUp, TrendingDown, Wifi, WifiOff, Zap, Database } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const POLL_MS = 2_500;
const MAX_HISTORY = 60;

const CHAIN_META: Record<string, { key: string; color: string; label: string; asset: string }> = {
  Ethereum: { key: "ethereum", color: "#a0a4b0", label: "ETH",    asset: "ETH/USDC" },
  Arbitrum: { key: "arbitrum", color: "#f5a623", label: "ARB",    asset: "ETH/USDC" },
  Base:     { key: "base",     color: "#4f8ef7", label: "BASE",   asset: "ETH/USDC" },
  Optimism: { key: "optimism", color: "#f54261", label: "OP",     asset: "ETH/USDC" },
  Solana:   { key: "solana",   color: "#9945FF", label: "SOL",    asset: "SOL/USDC" },
};

interface ChainPrice {
  chainId:  number;
  name:     string;
  color:    string;
  price:    number;
  tick:     number | null;
  source:   "onchain" | "estimated" | "graph";
  fee:      number;
  tvlUsd:   number;
  asset:    string;
}

interface ArbSnapshot {
  timestamp:         string;
  chains:            ChainPrice[];
  maxSpread:         number;
  maxSpreadPercent:  number;
  feeThreshold:      number;
  aboveFeeThreshold: boolean;
  avgPrice:          number;
  solPrice:          number;
}

type HistoryPoint = Record<string, number | string>;

interface LiveChain extends ChainPrice {
  simulatedTvl: number;
  tvlPctChange: number;
  tvlFromBase:  number;
  rank:         number;
}

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function fmtUsd(n: number) {
  if (n >= 1_000_000_000) return `$${fmt(n / 1_000_000_000, 2)}B`;
  if (n >= 1_000_000)     return `$${fmt(n / 1_000_000, 2)}M`;
  if (n >= 1_000)         return `$${fmt(n / 1_000, 1)}K`;
  return `$${fmt(n, 0)}`;
}

// ── Custom Tooltip ────────────────────────────────────────────────────────────
function ArbitrageTooltip({ active, payload, label, isSolanaActive }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; dataKey: string }>;
  label?: string;
  isSolanaActive?: boolean;
}) {
  if (!active || !payload?.length) return null;

  // Separate EVM lines from Solana (different asset)
  const evmLines    = payload.filter((p) => p.dataKey !== "solana");
  const solanaLine  = payload.find((p)   => p.dataKey === "solana");
  const evmSorted   = [...evmLines].sort((a, b) => b.value - a.value);

  return (
    <div style={{
      background: "rgba(8,11,22,0.96)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: 12,
      padding: "12px 16px",
      minWidth: 200,
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    }}>
      <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, marginBottom: 10, letterSpacing: "0.05em" }}>{label}</p>

      {/* EVM prices */}
      {evmSorted.length > 0 && (
        <>
          <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            ETH / USDC
          </p>
          {evmSorted.map((e) => (
            <div key={e.name} style={{ display: "flex", justifyContent: "space-between", gap: 24, marginBottom: 4, alignItems: "center" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: e.color, display: "inline-block" }} />
                <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: 600 }}>{e.name}</span>
              </span>
              <span style={{ color: "#fff", fontSize: 12, fontFamily: "monospace" }}>${fmt(e.value, 2)}</span>
            </div>
          ))}
          {evmSorted.length >= 2 && (
            <div style={{
              marginTop: 8, paddingTop: 8,
              borderTop: "1px solid rgba(255,255,255,0.06)",
              display: "flex", justifyContent: "space-between",
            }}>
              <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>Spread</span>
              <span style={{ color: "#fbbf24", fontSize: 11, fontFamily: "monospace" }}>
                ${fmt(Math.max(...evmSorted.map((e) => e.value)) - Math.min(...evmSorted.map((e) => e.value)), 4)}
              </span>
            </div>
          )}
        </>
      )}

      {/* Solana price — separate section */}
      {solanaLine && isSolanaActive && (
        <div style={{
          marginTop: evmSorted.length > 0 ? 10 : 0,
          paddingTop: evmSorted.length > 0 ? 10 : 0,
          borderTop: evmSorted.length > 0 ? "1px solid rgba(153,69,255,0.2)" : "none",
        }}>
          <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            SOL / USDC
          </p>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 24, alignItems: "center" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#9945FF", display: "inline-block" }} />
              <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: 600 }}>Solana</span>
            </span>
            <span style={{ color: "#fff", fontSize: 12, fontFamily: "monospace" }}>${fmt(solanaLine.value, 2)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: "green" | "yellow" | "red" | "blue" | "purple";
}) {
  const colors: Record<string, string> = {
    green:  "rgba(34,197,94,0.12)",
    yellow: "rgba(234,179,8,0.12)",
    red:    "rgba(239,68,68,0.12)",
    blue:   "rgba(59,130,246,0.12)",
    purple: "rgba(153,69,255,0.12)",
  };
  const borders: Record<string, string> = {
    green:  "rgba(34,197,94,0.25)",
    yellow: "rgba(234,179,8,0.25)",
    red:    "rgba(239,68,68,0.25)",
    blue:   "rgba(59,130,246,0.25)",
    purple: "rgba(153,69,255,0.25)",
  };
  const textColors: Record<string, string> = {
    green: "#4ade80", yellow: "#facc15", red: "#f87171", blue: "#60a5fa", purple: "#a855f7",
  };
  const bg = accent ? colors[accent] : "rgba(255,255,255,0.03)";
  const border = accent ? borders[accent] : "rgba(255,255,255,0.07)";
  const textColor = accent ? textColors[accent] : "#fff";

  return (
    <div style={{
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 14,
      padding: "16px 20px",
      flex: 1,
      minWidth: 0,
    }}>
      <p style={{ color: "rgba(255,255,255,0.38)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
        {label}
      </p>
      <p style={{ color: textColor, fontSize: 22, fontWeight: 700, fontFamily: "monospace", lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

// ── Gradient defs (injected once) ─────────────────────────────────────────────
function ChartGradients() {
  return (
    <defs>
      {Object.entries(CHAIN_META).map(([, meta]) => (
        <linearGradient key={meta.key} id={`grad-${meta.key}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={meta.color} stopOpacity={0.18} />
          <stop offset="100%" stopColor={meta.color} stopOpacity={0}    />
        </linearGradient>
      ))}
    </defs>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ArbitragePage() {
  const [current, setCurrent]        = useState<ArbSnapshot | null>(null);
  const [liveChains, setLiveChains]  = useState<LiveChain[]>([]);
  const [history, setHistory]        = useState<HistoryPoint[]>([]);
  const [tvlHistory, setTvlHistory]  = useState<HistoryPoint[]>([]);
  const [loading, setLoading]        = useState(true);
  const [liveCount, setLiveCount]    = useState(0);
  const [error, setError]            = useState<string | null>(null);
  const [showSolana, setShowSolana]  = useState(true);
  const firstPricesRef = useRef<Record<string, number>>({});
  const tvlBaseRef     = useRef<Record<string, number>>({});
  const prevTvlRef     = useRef<Record<string, number>>({});

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

      // Simulate TVL per chain + compute changes
      const computed = data.chains.map((ch) => {
        const key   = CHAIN_META[ch.name]?.key ?? ch.name.toLowerCase();
        const noise = (Math.random() - 0.5) * 0.016;
        const simTvl = ch.tvlUsd * (1 + noise);

        if (!tvlBaseRef.current[key]) tvlBaseRef.current[key] = ch.tvlUsd;
        const base = tvlBaseRef.current[key];
        const prev = prevTvlRef.current[key] ?? ch.tvlUsd;

        const tvlFromBase  = base > 0 ? (simTvl - base)  / base  * 100 : 0;
        const tvlPctChange = prev > 0 ? (simTvl - prev)   / prev  * 100 : 0;
        prevTvlRef.current[key] = simTvl;

        return { ch, key, simTvl, tvlFromBase, tvlPctChange };
      });

      const sorted = [...computed].sort((a, b) => b.simTvl - a.simTvl);
      setLiveChains(
        sorted.map((item, idx) => ({
          ...item.ch,
          simulatedTvl: item.simTvl,
          tvlPctChange: item.tvlPctChange,
          tvlFromBase:  item.tvlFromBase,
          rank:         idx + 1,
        }))
      );

      // Price history
      const point: HistoryPoint = { time };
      data.chains.forEach((ch) => {
        const key = CHAIN_META[ch.name]?.key ?? ch.name.toLowerCase();
        point[key] = ch.price;
      });
      setHistory((prev) => [...prev, point].slice(-MAX_HISTORY));

      // TVL % change history
      const tvlPoint: HistoryPoint = { time };
      computed.forEach(({ key, simTvl }) => {
        const base = tvlBaseRef.current[key];
        tvlPoint[key + "_tvl"] = base > 0 ? parseFloat(((simTvl - base) / base * 100).toFixed(4)) : 0;
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

  // Y-axis domain for EVM price lines only (ETH/USDC — don't mix with SOL ~$150)
  const evmMeta = Object.entries(CHAIN_META).filter(([, m]) => m.asset === "ETH/USDC");
  const priceYDomain: [number, number] = (() => {
    const vals = history.flatMap((pt) =>
      evmMeta.map(([, m]) => Number(pt[m.key])).filter(Boolean)
    );
    if (!vals.length) return [3_490, 3_510];
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);
    const spread = mx - mn;
    const pad = Math.max(spread * 0.45, 1.5);
    return [parseFloat((mn - pad).toFixed(2)), parseFloat((mx + pad).toFixed(2))];
  })();

  // SOL/USDC uses right Y-axis
  const solYDomain: [number, number] = (() => {
    const vals = history.map((pt) => Number(pt["solana"])).filter(Boolean);
    if (!vals.length) return [140, 160];
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);
    const pad = Math.max((mx - mn) * 0.5, 0.5);
    return [parseFloat((mn - pad).toFixed(2)), parseFloat((mx + pad).toFixed(2))];
  })();

  const tvlYDomain: [number, number] = (() => {
    const vals = tvlHistory.flatMap((pt) =>
      Object.entries(pt).filter(([k]) => k.endsWith("_tvl")).map(([, v]) => Number(v))
    ).filter((v) => !isNaN(v));
    if (!vals.length) return [-1, 1];
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);
    const pad = Math.max((mx - mn) * 0.3, 0.1);
    return [parseFloat((mn - pad).toFixed(3)), parseFloat((mx + pad).toFixed(3))];
  })();

  const maxTvl = liveChains.length > 0 ? Math.max(...liveChains.map((c) => c.simulatedTvl)) : 1;
  const spreadAccent = !current ? "blue"
    : current.aboveFeeThreshold ? "red"
    : current.maxSpreadPercent > current.feeThreshold * 0.5 ? "yellow"
    : "green";

  const evm    = Object.entries(CHAIN_META).filter(([, m]) => m.asset === "ETH/USDC");
  const solMeta = CHAIN_META["Solana"];

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 16px" }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <Activity size={20} style={{ color: "#60a5fa" }} />
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>
              Multi-Chain Price Arbitrage
            </h1>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.28)",
              borderRadius: 20, padding: "2px 10px", fontSize: 11, color: "#4ade80", fontWeight: 700,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", animation: "pulse 1.5s infinite" }} />
              LIVE
            </span>
          </div>
          <p style={{ color: "rgba(255,255,255,0.38)", fontSize: 13 }}>
            ETH/USDC across Uniswap v4 (Ethereum, Arbitrum, Base, Optimism) · SOL/USDC on Solana DEX ecosystem
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: liveCount > 0 ? "#4ade80" : "rgba(255,255,255,0.25)", fontSize: 12 }}>
          {liveCount > 0 ? <Wifi size={14} /> : <WifiOff size={14} />}
          <span>{liveCount} on-chain</span>
        </div>
      </div>

      {/* ── Stat cards ────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <StatCard
          label="Max Spread (EVM)"
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
          value="5 chains"
          sub="ETH · ARB · BASE · OP · Solana"
          accent="blue"
        />
        <StatCard
          label="SOL / USDC"
          value={current?.solPrice ? `$${fmt(current.solPrice, 2)}` : "—"}
          sub="Solana DEX — DeFiLlama"
          accent="purple"
        />
        <StatCard
          label="Avg ETH Price"
          value={current ? `$${fmt(current.avgPrice, 2)}` : "—"}
          sub="Across EVM pools"
        />
      </div>

      {/* ── Price chart ────────────────────────────────────────────────────── */}
      <div style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 18,
        padding: "20px 16px 8px",
        marginBottom: 20,
      }}>
        {/* Chart header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingLeft: 4 }}>
          <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, fontWeight: 600 }}>
            Real-Time Price Comparison
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Solana toggle */}
            <button
              onClick={() => setShowSolana((v) => !v)}
              aria-pressed={showSolana}
              aria-label="Toggle Solana price axis"
              className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-400"
              style={{
                display: "flex", alignItems: "center", gap: 5,
                background: showSolana ? "rgba(153,69,255,0.15)" : "rgba(255,255,255,0.04)",
                border: showSolana ? "1px solid rgba(153,69,255,0.4)" : "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8, minHeight: 36, padding: "8px 12px", cursor: "pointer",
                color: showSolana ? "#a855f7" : "rgba(255,255,255,0.3)", fontSize: 11, fontWeight: 600,
                transition: "background 0.2s ease, border-color 0.2s ease",
              }}
            >
              ◎ SOL axis
            </button>
            {/* Chain legend */}
            <div style={{ display: "flex", gap: 12 }}>
              {[...evm, ["Solana", solMeta] as [string, typeof solMeta]].map(([, meta]) => (
                <div key={meta.key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color, display: "inline-block", boxShadow: `0 0 6px ${meta.color}80` }} />
                  <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600 }}>{meta.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ height: 340, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 13 }}>Connecting to price feeds…</div>
          </div>
        ) : error ? (
          <div style={{ height: 340, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ color: "#f87171", fontSize: 13 }}>Error: {error}</div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={history} margin={{ top: 10, right: showSolana ? 70 : 20, bottom: 0, left: 10 }}>
              <ChartGradients />

              <CartesianGrid
                strokeDasharray="2 6"
                stroke="rgba(255,255,255,0.04)"
                vertical={false}
              />
              <XAxis
                dataKey="time"
                tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                padding={{ left: 12, right: 12 }}
              />
              {/* Left Y-axis: ETH/USDC */}
              <YAxis
                yAxisId="eth"
                domain={priceYDomain}
                tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                width={82}
                tickCount={6}
              />
              {/* Right Y-axis: SOL/USDC */}
              {showSolana && (
                <YAxis
                  yAxisId="sol"
                  orientation="right"
                  domain={solYDomain}
                  tick={{ fill: "rgba(153,69,255,0.5)", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                  width={58}
                  tickCount={5}
                />
              )}

              <Tooltip
                content={<ArbitrageTooltip isSolanaActive={showSolana} />}
                cursor={{ stroke: "rgba(255,255,255,0.08)", strokeWidth: 1, strokeDasharray: "4 4" }}
              />

              {current && (
                <ReferenceLine
                  yAxisId="eth"
                  y={current.avgPrice}
                  stroke="rgba(255,255,255,0.07)"
                  strokeDasharray="4 4"
                />
              )}

              {/* EVM area fills */}
              {evm.map(([, meta]) => (
                <Area
                  key={`area-${meta.key}`}
                  yAxisId="eth"
                  type="monotone"
                  dataKey={meta.key}
                  fill={`url(#grad-${meta.key})`}
                  stroke="none"
                  isAnimationActive={false}
                  connectNulls
                  dot={false}
                  activeDot={false}
                />
              ))}

              {/* EVM price lines */}
              {evm.map(([, meta]) => (
                <Line
                  key={meta.key}
                  yAxisId="eth"
                  type="monotone"
                  dataKey={meta.key}
                  name={meta.label}
                  stroke={meta.color}
                  strokeWidth={2}
                  isAnimationActive={false}
                  connectNulls
                  dot={false}
                  activeDot={{
                    r: 5,
                    fill: meta.color,
                    stroke: "rgba(0,0,0,0.5)",
                    strokeWidth: 2,
                    filter: `drop-shadow(0 0 6px ${meta.color})`,
                  }}
                />
              ))}

              {/* Solana line — right axis, dashed to distinguish */}
              {showSolana && (
                <>
                  <Area
                    yAxisId="sol"
                    type="monotone"
                    dataKey="solana"
                    fill="url(#grad-solana)"
                    stroke="none"
                    isAnimationActive={false}
                    connectNulls
                    dot={false}
                    activeDot={false}
                  />
                  <Line
                    yAxisId="sol"
                    type="monotone"
                    dataKey="solana"
                    name="SOL"
                    stroke="#9945FF"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    isAnimationActive={false}
                    connectNulls
                    dot={false}
                    activeDot={{
                      r: 5,
                      fill: "#9945FF",
                      stroke: "rgba(0,0,0,0.5)",
                      strokeWidth: 2,
                      filter: "drop-shadow(0 0 8px #9945FF)",
                    }}
                  />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}

        {/* Bottom legend */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          gap: 20, paddingTop: 12, paddingBottom: 4, flexWrap: "wrap",
        }}>
          {evm.map(([name, meta]) => (
            <div key={meta.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="24" height="10">
                <line x1="0" y1="5" x2="24" y2="5" stroke={meta.color} strokeWidth="2" />
              </svg>
              <span style={{ color: "rgba(255,255,255,0.38)", fontSize: 11 }}>{name}</span>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="24" height="10">
              <line x1="0" y1="5" x2="24" y2="5" stroke="#9945FF" strokeWidth="2" strokeDasharray="6 3" />
            </svg>
            <span style={{ color: "rgba(153,69,255,0.7)", fontSize: 11 }}>Solana (SOL/USDC · right axis)</span>
          </div>
        </div>
      </div>

      {/* ── TVL Real-Time Chart ───────────────────────────────────────────── */}
      <div style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 18,
        padding: "20px 16px 12px",
        marginBottom: 20,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, paddingLeft: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Database size={14} style={{ color: "#60a5fa" }} />
            <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, fontWeight: 600 }}>
              Liquidity (TVL) per Chain — Real-Time
            </span>
            <span style={{
              background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.22)",
              borderRadius: 6, padding: "1px 8px", fontSize: 10, color: "#60a5fa", fontWeight: 600,
            }}>
              LIVE DB
            </span>
          </div>
          <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 11 }}>% change from session start</span>
        </div>

        {/* Current TVL bars */}
        {current && (
          <div style={{ marginBottom: 16 }}>
            <ResponsiveContainer width="100%" height={72}>
              <BarChart
                data={current.chains.map((ch) => {
                  const key  = CHAIN_META[ch.name]?.key ?? "";
                  const base = tvlBaseRef.current[key] ?? ch.tvlUsd;
                  const noise = (Math.random() - 0.5) * 0.008;
                  const sim  = ch.tvlUsd * (1 + noise);
                  const pct  = base > 0 ? (sim - base) / base * 100 : 0;
                  return {
                    name: ch.name,
                    tvl:  ch.tvlUsd,
                    pct:  parseFloat(pct.toFixed(3)),
                    color: CHAIN_META[ch.name]?.color ?? "#fff",
                  };
                })}
                layout="vertical"
                margin={{ top: 0, right: 70, bottom: 0, left: 0 }}
              >
                <XAxis type="number" hide domain={[-2, 2]} />
                <YAxis
                  type="category" dataKey="name"
                  tick={{ fill: "rgba(255,255,255,0.38)", fontSize: 11 }}
                  width={76} axisLine={false} tickLine={false}
                />
                <Bar dataKey="pct" radius={[0, 4, 4, 0]}>
                  {current.chains.map((ch) => (
                    <Cell key={ch.name} fill={CHAIN_META[ch.name]?.color ?? "#60a5fa"} fillOpacity={0.7} />
                  ))}
                  <LabelList
                    dataKey="tvl"
                    position="right"
                    formatter={(v: number) => fmtUsd(v)}
                    style={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* TVL % change line chart */}
        {tvlHistory.length > 1 && (
          <ResponsiveContainer width="100%" height={190}>
            <ComposedChart data={tvlHistory} margin={{ top: 4, right: 20, bottom: 0, left: 8 }}>
              <defs>
                {Object.entries(CHAIN_META).map(([, meta]) => (
                  <linearGradient key={`tvl-grad-${meta.key}`} id={`tvl-grad-${meta.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={meta.color} stopOpacity={0.12} />
                    <stop offset="100%" stopColor={meta.color} stopOpacity={0}    />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="2 6" stroke="rgba(255,255,255,0.03)" vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fill: "rgba(255,255,255,0.18)", fontSize: 9 }}
                tickLine={false} axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={tvlYDomain}
                tick={{ fill: "rgba(255,255,255,0.18)", fontSize: 9 }}
                tickLine={false} axisLine={false}
                tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`}
                width={50}
              />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" strokeDasharray="4 4" />
              <Tooltip
                contentStyle={{
                  background: "rgba(8,11,22,0.95)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 10, fontSize: 11,
                }}
                formatter={(v: number, name: string) => [
                  `${v > 0 ? "+" : ""}${v.toFixed(4)}%`,
                  name.replace("_tvl", ""),
                ]}
                labelStyle={{ color: "rgba(255,255,255,0.35)" }}
              />
              {Object.entries(CHAIN_META).map(([, meta]) => (
                <Area
                  key={`tvl-area-${meta.key}`}
                  type="monotone"
                  dataKey={meta.key + "_tvl"}
                  fill={`url(#tvl-grad-${meta.key})`}
                  stroke="none"
                  isAnimationActive={false}
                  connectNulls
                  dot={false}
                  activeDot={false}
                />
              ))}
              {Object.entries(CHAIN_META).map(([, meta]) => (
                <Line
                  key={meta.key + "_tvl"}
                  type="monotone"
                  dataKey={meta.key + "_tvl"}
                  name={meta.key}
                  stroke={meta.color}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 3, fill: meta.color, strokeWidth: 0 }}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}

        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, marginTop: 8, textAlign: "right" }}>
          TVL: Uniswap v4 DB (EVM) + Solana hook analytics · ±0.8% noise · updates every {POLL_MS / 1000}s
        </p>
      </div>

      {/* ── Chain ranking table ────────────────────────────────────────────── */}
      <div style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 18,
        overflow: "hidden",
      }}>
        <div style={{
          padding: "14px 20px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "rgba(255,255,255,0.65)", fontSize: 13, fontWeight: 600 }}>
              Chain Liquidity Ranking
            </span>
            <span style={{
              background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)",
              borderRadius: 6, padding: "1px 7px", fontSize: 10, color: "#4ade80", fontWeight: 700,
            }}>
              SORTED BY TVL
            </span>
          </div>
          <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 11 }}>
            Reorders automatically as TVL changes
          </span>
        </div>

        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              {["#", "Chain", "TVL (Real-Time)", "TVL Change", "Price", "Asset", "Source"].map((h) => (
                <th key={h} style={{
                  textAlign: "left", padding: "10px 16px",
                  color: h === "TVL (Real-Time)" || h === "TVL Change"
                    ? "rgba(96,165,250,0.6)"
                    : "rgba(255,255,255,0.25)",
                  fontSize: 10, fontWeight: 600,
                  textTransform: "uppercase", letterSpacing: "0.06em",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {liveChains.map((chain, idx) => {
              const isFirst  = idx === 0;
              const tvlUp    = chain.tvlPctChange >= 0;
              const isSol    = chain.chainId === 1399811149;
              const barWidth = maxTvl > 0
                ? Math.max(6, (Math.log10(Math.max(1, chain.simulatedTvl)) / Math.log10(maxTvl)) * 100)
                : 6;
              const rankColor = chain.rank === 1 ? "#facc15"
                : chain.rank === 2 ? "rgba(255,255,255,0.45)"
                : chain.rank === 3 ? "#cd7f32"
                : "rgba(255,255,255,0.18)";

              return (
                <tr key={chain.chainId} style={{
                  borderBottom: idx < liveChains.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                  background: isFirst ? "rgba(255,255,255,0.016)" : "transparent",
                  transition: "background 0.3s ease",
                }}>
                  <td style={{ padding: "14px 12px 14px 20px", width: 36 }}>
                    <span style={{ color: rankColor, fontWeight: 700, fontSize: 13, fontFamily: "monospace" }}>
                      #{chain.rank}
                    </span>
                  </td>

                  <td style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <span style={{
                        width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                        background: chain.color,
                        boxShadow: `0 0 8px ${chain.color}90`,
                      }} />
                      <span style={{ color: "#fff", fontWeight: 600, fontSize: 14 }}>{chain.name}</span>
                      {isSol && (
                        <span style={{
                          background: "rgba(153,69,255,0.15)", border: "1px solid rgba(153,69,255,0.3)",
                          borderRadius: 4, padding: "1px 5px", fontSize: 9, color: "#a855f7", fontWeight: 700,
                        }}>◎ SOL</span>
                      )}
                    </div>
                  </td>

                  <td style={{ padding: "14px 16px", minWidth: 160 }}>
                    <div>
                      <span style={{ color: "#fff", fontFamily: "monospace", fontWeight: 700, fontSize: 16 }}>
                        {fmtUsd(chain.simulatedTvl)}
                      </span>
                      <div style={{
                        height: 3, borderRadius: 2,
                        background: "rgba(255,255,255,0.05)",
                        marginTop: 6, width: "80%",
                      }}>
                        <div style={{
                          height: "100%", borderRadius: 2,
                          width: `${barWidth.toFixed(1)}%`,
                          background: `linear-gradient(90deg, ${chain.color}cc, ${chain.color}66)`,
                          transition: "width 0.6s ease",
                        }} />
                      </div>
                    </div>
                  </td>

                  <td style={{ padding: "14px 16px" }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      background: tvlUp ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                      border: `1px solid ${tvlUp ? "rgba(34,197,94,0.22)" : "rgba(239,68,68,0.22)"}`,
                      borderRadius: 8, padding: "4px 10px",
                      color: tvlUp ? "#4ade80" : "#f87171",
                      fontFamily: "monospace", fontSize: 13, fontWeight: 700,
                    }}>
                      {tvlUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {tvlUp ? "+" : ""}{chain.tvlPctChange.toFixed(3)}%
                    </span>
                    <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 10, marginTop: 3 }}>vs prev tick</div>
                  </td>

                  <td style={{ padding: "14px 16px" }}>
                    <span style={{ color: "rgba(255,255,255,0.75)", fontFamily: "monospace", fontSize: 14, fontWeight: 600 }}>
                      ${fmt(chain.price, 2)}
                    </span>
                  </td>

                  <td style={{ padding: "14px 16px" }}>
                    <span style={{
                      background: isSol ? "rgba(153,69,255,0.1)" : "rgba(255,255,255,0.05)",
                      color: isSol ? "#a855f7" : "rgba(255,255,255,0.4)",
                      border: isSol ? "1px solid rgba(153,69,255,0.25)" : "1px solid transparent",
                      borderRadius: 6, padding: "3px 8px",
                      fontSize: 11, fontFamily: "monospace",
                    }}>
                      {chain.asset ?? (isSol ? "SOL/USDC" : "ETH/USDC")}
                    </span>
                  </td>

                  <td style={{ padding: "14px 16px" }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      background: chain.source === "onchain" ? "rgba(34,197,94,0.08)" : isSol ? "rgba(153,69,255,0.1)" : "rgba(234,179,8,0.08)",
                      border: chain.source === "onchain"
                        ? "1px solid rgba(34,197,94,0.25)"
                        : isSol ? "1px solid rgba(153,69,255,0.25)" : "1px solid rgba(234,179,8,0.25)",
                      color: chain.source === "onchain" ? "#4ade80" : isSol ? "#a855f7" : "#fbbf24",
                      borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 600,
                    }}>
                      {chain.source === "onchain" ? <><Zap size={9} />LIVE</> : isSol ? <>◎ DL</> : <>EST</>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>

        <div style={{
          padding: "10px 20px",
          borderTop: "1px solid rgba(255,255,255,0.04)",
          display: "flex", gap: 16, alignItems: "center",
        }}>
          <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>
            TVL = DB + ±0.8% simulated noise · Solana TVL = sum of indexed DEX programs · sorted by TVL every {POLL_MS/1000}s
          </span>
          {current && (
            <span style={{ marginLeft: "auto", color: "rgba(255,255,255,0.45)", fontSize: 11 }}>
              Updated {new Date(current.timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
