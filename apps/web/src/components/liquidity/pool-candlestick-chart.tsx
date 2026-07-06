"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { TrendingUp } from "lucide-react";
import { api } from "@/lib/api";

// Same 1.0001^tick math used server-side (price-snapshot-service.ts) and across
// every panel's presetTicks() — kept consistent so the chart's live candle lines
// up with the historical snapshots it's built from.
function tickToPrice(tick: number, decimalsA: number, decimalsB: number): number {
  return Math.pow(1.0001, tick) * 10 ** (decimalsA - decimalsB);
}

function formatPrice(v: number): string {
  if (v === 0) return "0";
  // 4 decimal places (5 sig figs), not 2 — at extreme magnitudes a typical
  // sub-1% price move only shows up past the 2nd significant digit, otherwise
  // every nearby gridline/candle prints the same rounded label and the chart
  // looks frozen even though the underlying values differ.
  if (v < 0.0001 || v > 1_000_000) return v.toExponential(4);
  return v < 1 ? v.toFixed(6) : v.toFixed(2);
}

type Period = "1h" | "24h" | "7d";
const PERIODS: Period[] = ["1h", "24h", "7d"];

// Bucket width per period — chosen so a typical ~2-minute snapshot cadence still
// produces a readable number of candles (≈12–48) instead of one bar per sample.
const BUCKET_MS: Record<Period, number> = {
  "1h": 5 * 60 * 1000,
  "24h": 30 * 60 * 1000,
  "7d": 4 * 60 * 60 * 1000,
};

interface Candle { bucketStart: number; open: number; high: number; low: number; close: number }

function buildCandles(
  points: { timestamp: string; price: number }[],
  bucketMs: number,
  livePrice: number | null,
): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const p of points) {
    const t = new Date(p.timestamp).getTime();
    const bucketStart = Math.floor(t / bucketMs) * bucketMs;
    const existing = buckets.get(bucketStart);
    if (!existing) {
      buckets.set(bucketStart, { bucketStart, open: p.price, high: p.price, low: p.price, close: p.price });
    } else {
      existing.high = Math.max(existing.high, p.price);
      existing.low = Math.min(existing.low, p.price);
      existing.close = p.price;
    }
  }
  if (livePrice != null) {
    const bucketStart = Math.floor(Date.now() / bucketMs) * bucketMs;
    const existing = buckets.get(bucketStart);
    if (!existing) {
      buckets.set(bucketStart, { bucketStart, open: livePrice, high: livePrice, low: livePrice, close: livePrice });
    } else {
      existing.high = Math.max(existing.high, livePrice);
      existing.low = Math.min(existing.low, livePrice);
      existing.close = livePrice;
    }
  }
  return [...buckets.values()].sort((a, b) => a.bucketStart - b.bucketStart);
}

// "Full range" (MIN_TICK..MAX_TICK) converts to a price ratio of roughly 1e-39..1e38
// — real but useless to print. Anything spanning more than 6 orders of magnitude is
// effectively "the whole axis", so label it instead of dumping scientific notation.
function isFullRangeSpan(lower: number, upper: number): boolean {
  if (lower <= 0 || upper <= 0) return true;
  return upper / lower > 1_000_000;
}

interface PoolCandlestickChartProps {
  hookAddress: string;
  poolId: string;
  chainId: number;
  // Tick-based pools (EVM v4, Orca, Raydium CLMM) supply currentTick + decimals
  // so the live point and selected range can be derived via 1.0001^tick.
  // Constant-product pools (Raydium AMM v4/CPMM) have no tick — they supply
  // currentPrice directly instead, and never pass tickLower/tickUpper.
  currentTick?: number | null;
  decimalsA?: number;
  decimalsB?: number;
  currentPrice?: number | null;
  tickLower?: number | null;
  tickUpper?: number | null;
  symbolA?: string;
  symbolB?: string;
}

const VIEW_W = 1000;
const VIEW_H = 280;
const PAD_TOP = 12;
const PAD_BOTTOM = 26;
const PAD_LEFT = 6;
const PAD_RIGHT = 62;

export function PoolCandlestickChart({
  hookAddress, poolId, chainId, currentTick, decimalsA, decimalsB, currentPrice,
  tickLower, tickUpper, symbolA = "A", symbolB = "B",
}: PoolCandlestickChartProps) {
  const [period, setPeriod] = useState<Period>("24h");
  const [history, setHistory] = useState<{ timestamp: string; price: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState<Candle | null>(null);

  const fetchHistory = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.priceHistory.get(hookAddress, poolId, { chainId, period });
      setHistory(res.data);
    } catch {
      /* non-fatal — chart just shows the "accumulating" placeholder */
    } finally {
      setLoading(false);
    }
  }, [hookAddress, poolId, chainId, period]);

  // Poll every 10s so the on-demand price-history endpoint creates a fresh
  // snapshot roughly every 20s (staleness threshold in price-history.ts),
  // giving LP-relevant real-time price updates instead of the original 30s.
  useEffect(() => {
    fetchHistory();
    const id = setInterval(() => fetchHistory(true), 10_000);
    return () => clearInterval(id);
  }, [fetchHistory]);

  const livePrice = currentPrice ??
    (currentTick != null && decimalsA != null && decimalsB != null ? tickToPrice(currentTick, decimalsA, decimalsB) : null);
  const candles = useMemo(
    () => buildCandles(history, BUCKET_MS[period], livePrice),
    [history, period, livePrice]
  );

  const rangeLowerPrice = tickLower != null && decimalsA != null && decimalsB != null ? tickToPrice(tickLower, decimalsA, decimalsB) : null;
  const rangeUpperPrice = tickUpper != null && decimalsA != null && decimalsB != null ? tickToPrice(tickUpper, decimalsA, decimalsB) : null;
  const rangeLo = rangeLowerPrice != null && rangeUpperPrice != null ? Math.min(rangeLowerPrice, rangeUpperPrice) : null;
  const rangeHi = rangeLowerPrice != null && rangeUpperPrice != null ? Math.max(rangeLowerPrice, rangeUpperPrice) : null;
  const fullRange = rangeLo != null && rangeHi != null && isFullRangeSpan(rangeLo, rangeHi);

  if (loading) return <div className="h-64 shimmer rounded-xl" />;

  if (candles.length === 0) {
    return (
      <div>
        <ChartHeader period={period} setPeriod={setPeriod} symbolA={symbolA} symbolB={symbolB} />
        <div className="h-56 flex items-center justify-center text-xs text-gray-600 rounded-xl text-center px-4"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
          Mengakumulasi histori harga — candle dan garis tren akan muncul setelah ±20 detik.
        </div>
      </div>
    );
  }

  let minPrice = Math.min(...candles.map((c) => c.low));
  let maxPrice = Math.max(...candles.map((c) => c.high));
  // Only widen the visible domain for a *bounded* selected range — a full-range
  // band would blow the scale out to ~1e-39/1e38 and flatten every candle.
  if (!fullRange && rangeLo != null && rangeHi != null) {
    minPrice = Math.min(minPrice, rangeLo);
    maxPrice = Math.max(maxPrice, rangeHi);
  }
  if (minPrice === maxPrice) { minPrice *= 0.99; maxPrice *= 1.01; }
  const pricePad = (maxPrice - minPrice) * 0.08;
  minPrice -= pricePad;
  maxPrice += pricePad;

  const plotW = VIEW_W - PAD_LEFT - PAD_RIGHT;
  const plotH = VIEW_H - PAD_TOP - PAD_BOTTOM;
  const n = candles.length;
  const slot = plotW / n;
  // Cap body width — with very few candles, slot * 0.6 alone would draw an
  // implausibly fat single bar that dominates the chart.
  const bodyWidth = Math.max(2, Math.min(slot * 0.6, 36));

  const yFor = (price: number) => PAD_TOP + (1 - (price - minPrice) / (maxPrice - minPrice)) * plotH;
  const xFor = (i: number) => PAD_LEFT + slot * i + slot / 2;

  const Y_TICKS = 5;
  const yTickValues = Array.from({ length: Y_TICKS }, (_, i) => minPrice + ((maxPrice - minPrice) * i) / (Y_TICKS - 1));

  const xLabelCount = Math.min(5, n);
  const xLabelIndices = Array.from(
    { length: xLabelCount },
    (_, i) => Math.floor((i * (n - 1)) / Math.max(1, xLabelCount - 1))
  );

  const bandTop = !fullRange && rangeHi != null ? yFor(rangeHi) : null;
  const bandBottom = !fullRange && rangeLo != null ? yFor(rangeLo) : null;

  // Simple Moving Average (period 7) — smooths noise and shows trend direction.
  const SMA_PERIOD = 7;
  const smaPoints: { x: number; y: number }[] = [];
  for (let i = SMA_PERIOD - 1; i < n; i++) {
    const avg = candles.slice(i - SMA_PERIOD + 1, i + 1).reduce((s, c) => s + c.close, 0) / SMA_PERIOD;
    smaPoints.push({ x: xFor(i), y: yFor(avg) });
  }

  // Trend direction from last SMA slope
  const trendDir = smaPoints.length >= 2
    ? smaPoints.at(-1)!.y < smaPoints.at(-2)!.y ? "↑" : smaPoints.at(-1)!.y > smaPoints.at(-2)!.y ? "↓" : "→"
    : "→";
  const trendColor = trendDir === "↑" ? "#10b981" : trendDir === "↓" ? "#ef4444" : "#6b7280";

  // Current live price from the most recent candle close
  const latestClose = candles.at(-1)?.close ?? null;

  return (
    <div>
      {/* Header with live price ticker */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
          <TrendingUp size={11} className="text-emerald-400" />
          Price — {symbolA}/{symbolB}
        </h3>
        <div className="flex items-center gap-3">
          {latestClose != null && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="font-mono font-bold text-[13px]" style={{ color: trendColor }}>
                {trendDir} {formatPrice(latestClose)}
              </span>
            </div>
          )}
          <div className="flex items-center gap-1">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className="text-[10px] px-1.5 py-0.5 rounded cursor-pointer transition-all"
                style={{
                  background: period === p ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.04)",
                  border: period === p ? "1px solid rgba(16,185,129,0.4)" : "1px solid rgba(255,255,255,0.08)",
                  color: period === p ? "#6ee7b7" : "#6b7280",
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ height: VIEW_H }} className="relative">
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" height="100%" preserveAspectRatio="none">
          {yTickValues.map((v, i) => (
            <line key={i} x1={PAD_LEFT} x2={VIEW_W - PAD_RIGHT} y1={yFor(v)} y2={yFor(v)}
              stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
          ))}

          {bandTop != null && bandBottom != null && (
            <rect
              x={PAD_LEFT} width={plotW}
              y={bandTop} height={Math.max(1, bandBottom - bandTop)}
              fill="#6366f1" fillOpacity={0.12} stroke="#818cf8" strokeOpacity={0.4} strokeDasharray="4 3"
            />
          )}

          {candles.map((c, i) => {
            const x = xFor(i);
            const isUp = c.close >= c.open;
            const color = isUp ? "#10b981" : "#ef4444";
            const bodyTop = yFor(Math.max(c.open, c.close));
            const bodyBottom = yFor(Math.min(c.open, c.close));
            const bodyHeight = Math.max(1, bodyBottom - bodyTop);
            return (
              <g key={c.bucketStart}
                onMouseEnter={() => setHovered(c)}
                onMouseLeave={() => setHovered((h) => (h?.bucketStart === c.bucketStart ? null : h))}
              >
                <rect x={x - slot / 2} y={PAD_TOP} width={slot} height={plotH} fill="transparent" />
                <line x1={x} x2={x} y1={yFor(c.high)} y2={yFor(c.low)} stroke={color} strokeWidth={1} />
                <rect x={x - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={bodyHeight} fill={color} />
              </g>
            );
          })}

          {yTickValues.map((v, i) => (
            <text key={i} x={VIEW_W - PAD_RIGHT + 6} y={yFor(v) + 3} fontSize={9} fill="#6b7280">
              {formatPrice(v)}
            </text>
          ))}
          {/* SMA-7 trend line — visible direction signal for LP range selection */}
          {smaPoints.length >= 2 && (
            <polyline
              points={smaPoints.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="#f59e0b"
              strokeWidth={1.5}
              strokeOpacity={0.8}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {xLabelIndices.map((idx) => (
            <text key={idx} x={xFor(idx)} y={VIEW_H - 8} fontSize={9} fill="#6b7280" textAnchor="middle">
              {new Date(candles[idx].bucketStart).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
            </text>
          ))}
        </svg>

        {hovered && (
          <div className="absolute top-1 left-1 px-2 py-1.5 rounded-md text-[10px] pointer-events-none leading-relaxed"
            style={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="text-gray-500">
              {new Date(hovered.bucketStart).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
            </div>
            <div className="text-gray-300">
              O <span className="text-gray-100">{formatPrice(hovered.open)}</span>
              {" "}H <span className="text-emerald-400">{formatPrice(hovered.high)}</span>
            </div>
            <div className="text-gray-300">
              L <span className="text-red-400">{formatPrice(hovered.low)}</span>
              {" "}C <span className="text-gray-100">{formatPrice(hovered.close)}</span>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 mt-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-[9px] text-gray-600">Live · update ~20s</span>
        {smaPoints.length >= 2 && (
          <span className="text-[9px] ml-2 flex items-center gap-1" style={{ color: "#f59e0b" }}>
            <span>─</span> SMA-7 trend
          </span>
        )}
        {rangeLo != null && rangeHi != null && (
          <span className="text-[9px] text-gray-600 ml-auto">
            Range terpilih:{" "}
            <span className="text-indigo-400">
              {fullRange ? "Full range" : `${formatPrice(rangeLo)} – ${formatPrice(rangeHi)}`}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

function ChartHeader({
  period, setPeriod, symbolA, symbolB,
}: { period: Period; setPeriod: (p: Period) => void; symbolA: string; symbolB: string }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
        <TrendingUp size={11} className="text-emerald-400" />
        Price — {symbolA}/{symbolB}
      </h3>
      <div className="flex items-center gap-1">
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className="text-[10px] px-1.5 py-0.5 rounded cursor-pointer transition-all"
            style={{
              background: period === p ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.04)",
              border: period === p ? "1px solid rgba(16,185,129,0.4)" : "1px solid rgba(255,255,255,0.08)",
              color: period === p ? "#6ee7b7" : "#6b7280",
            }}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
