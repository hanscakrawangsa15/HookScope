"use client";

/**
 * PoolRangeChart — Uniswap V3-style interactive price range editor.
 *
 * Renders the same candlestick price history as the background, but adds:
 *  • Two draggable vertical handles for min/max price
 *  • A highlighted band between them (like Uniswap V3's position editor)
 *  • Current-price line with label
 *  • "In range" / "Out of range" visual indicator
 *
 * Drag a handle → convert pixel Y → price → nearest usable tick → call onRangeChange.
 */

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { TrendingUp } from "lucide-react";
import { api } from "@/lib/api";

// ── tick/price helpers ─────────────────────────────────────────────────────────
// log-space conversion to avoid overflow at extreme ticks (±887272)
function tickToPrice(tick: number, decimalsA: number, decimalsB: number): number {
  const clampedTick = Math.max(-887272, Math.min(887272, tick));
  const result = Math.exp(clampedTick * Math.log(1.0001) + (decimalsA - decimalsB) * Math.log(10));
  return isFinite(result) ? result : 0;
}
function priceToTick(price: number, decimalsA: number, decimalsB: number): number {
  if (price <= 0) return 0;
  return (Math.log(price) - (decimalsA - decimalsB) * Math.log(10)) / Math.log(1.0001);
}
function nearestUsableTick(tick: number, spacing: number, min: number, max: number): number {
  const r = Math.round(tick / spacing) * spacing;
  if (r < min) return Math.ceil(min / spacing) * spacing;
  if (r > max) return Math.floor(max / spacing) * spacing;
  return r;
}
function formatPrice(v: number): string {
  if (v === 0) return "0";
  if (v < 0.0001 || v > 1_000_000) return v.toExponential(4);
  return v < 1 ? v.toFixed(6) : v.toFixed(2);
}

// ── chart geometry ─────────────────────────────────────────────────────────────
const VIEW_W = 1000;
const VIEW_H = 300;
const PAD_TOP = 12;
const PAD_BOTTOM = 30;
const PAD_LEFT = 8;
const PAD_RIGHT = 68;

interface Candle { bucketStart: number; open: number; high: number; low: number; close: number }
type Period = "1h" | "24h" | "7d";
const PERIODS: Period[] = ["1h", "24h", "7d"];
const BUCKET_MS: Record<Period, number> = { "1h": 5 * 60 * 1000, "24h": 30 * 60 * 1000, "7d": 4 * 60 * 60 * 1000 };

function buildCandles(points: { timestamp: string; price: number }[], bucketMs: number, livePrice: number | null): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const p of points) {
    const t = new Date(p.timestamp).getTime();
    const bStart = Math.floor(t / bucketMs) * bucketMs;
    const existing = buckets.get(bStart);
    if (!existing) buckets.set(bStart, { bucketStart: bStart, open: p.price, high: p.price, low: p.price, close: p.price });
    else { existing.high = Math.max(existing.high, p.price); existing.low = Math.min(existing.low, p.price); existing.close = p.price; }
  }
  if (livePrice != null) {
    const bStart = Math.floor(Date.now() / bucketMs) * bucketMs;
    const existing = buckets.get(bStart);
    if (!existing) buckets.set(bStart, { bucketStart: bStart, open: livePrice, high: livePrice, low: livePrice, close: livePrice });
    else { existing.high = Math.max(existing.high, livePrice); existing.low = Math.min(existing.low, livePrice); existing.close = livePrice; }
  }
  return [...buckets.values()].sort((a, b) => a.bucketStart - b.bucketStart);
}

function isFullRangeSpan(lo: number, hi: number): boolean {
  return lo <= 0 || hi <= 0 || hi / lo > 1_000_000;
}

// ── Props ──────────────────────────────────────────────────────────────────────
export interface PoolRangeChartProps {
  hookAddress: string;
  poolId: string;
  chainId: number;
  currentTick?: number | null;
  decimalsA?: number;
  decimalsB?: number;
  currentPrice?: number | null;
  tickLower?: number | null;
  tickUpper?: number | null;
  tickSpacing?: number;
  minTick?: number;
  maxTick?: number;
  symbolA?: string;
  symbolB?: string;
  /** Called when user drags the handles to new price positions */
  onRangeChange?: (tickLower: number, tickUpper: number) => void;
}

// ── Main component ─────────────────────────────────────────────────────────────
export function PoolRangeChart({
  hookAddress, poolId, chainId, currentTick, decimalsA = 18, decimalsB = 18, currentPrice,
  tickLower, tickUpper, tickSpacing = 60, minTick = -887272, maxTick = 887272,
  symbolA = "A", symbolB = "B", onRangeChange,
}: PoolRangeChartProps) {
  const [period, setPeriod] = useState<Period>("24h");
  const [history, setHistory] = useState<{ timestamp: string; price: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState<Candle | null>(null);

  // Drag state
  const [dragging, setDragging] = useState<"lower" | "upper" | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const fetchHistory = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.priceHistory.get(hookAddress, poolId, { chainId, period });
      setHistory(res.data);
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }, [hookAddress, poolId, chainId, period]);

  // Chart is static — fetch once on mount/period change, no polling.
  // Only the price range handles remain interactive.
  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const livePrice = currentPrice ??
    (currentTick != null ? tickToPrice(currentTick, decimalsA, decimalsB) : null);

  const candles = useMemo(
    () => buildCandles(history, BUCKET_MS[period], livePrice),
    [history, period, livePrice]
  );

  const priceLo = tickLower != null ? tickToPrice(tickLower, decimalsA, decimalsB) : null;
  const priceHi = tickUpper != null ? tickToPrice(tickUpper, decimalsA, decimalsB) : null;
  const fullRange = priceLo != null && priceHi != null && isFullRangeSpan(
    Math.min(priceLo, priceHi), Math.max(priceLo, priceHi)
  );
  const inRange = livePrice != null && priceLo != null && priceHi != null &&
    !fullRange && livePrice >= Math.min(priceLo, priceHi) && livePrice <= Math.max(priceLo, priceHi);

  // ── Chart scale — computed unconditionally (hooks must come before any return) ─
  const hasCandles = candles.length > 0;

  const rawMin = hasCandles ? Math.min(...candles.map(c => c.low)) : (livePrice ?? 1) * 0.98;
  const rawMax = hasCandles ? Math.max(...candles.map(c => c.high)) : (livePrice ?? 1) * 1.02;

  // ── Logarithmic price scale ────────────────────────────────────────────────
  // Crypto prices move geometrically (%, not $), so log scale is the correct
  // representation. A 10% move looks the same whether price is $0.001 or $1M.
  // Linear scale would compress all small-price candles into a single pixel.
  const { logMin, logMax } = useMemo(() => {
    const safeMin = Math.max(rawMin > 0 ? rawMin : 1e-10, 1e-18);
    let lo = Math.log(safeMin);
    let hi = Math.log(Math.max(rawMax, safeMin * 1.001));
    if (!fullRange && priceLo != null && priceHi != null) {
      const safeRangeLo = Math.max(Math.min(priceLo, priceHi), 1e-18);
      const safeRangeHi = Math.max(Math.max(priceLo, priceHi), safeRangeLo * 1.001);
      lo = Math.min(lo, Math.log(safeRangeLo));
      hi = Math.max(hi, Math.log(safeRangeHi));
    }
    if (lo === hi) { lo -= 0.03; hi += 0.03; }
    const pad = (hi - lo) * 0.10;
    return { logMin: lo - pad, logMax: hi + pad };
  }, [rawMin, rawMax, fullRange, priceLo, priceHi]);

  // Keep minPrice/maxPrice as real values for labels
  const minPrice = Math.exp(logMin);
  const maxPrice = Math.exp(logMax);

  const plotW = VIEW_W - PAD_LEFT - PAD_RIGHT;
  const plotH = VIEW_H - PAD_TOP - PAD_BOTTOM;
  const n = Math.max(candles.length, 1);
  const slot = plotW / n;
  const bodyWidth = Math.max(2, Math.min(slot * 0.6, 36));

  // Log-scale Y mapping: equal pixel distance = equal percentage price change
  const yFor = useCallback(
    (price: number) => {
      if (price <= 0) return PAD_TOP + plotH; // clamp to bottom
      const logP = Math.log(price);
      return PAD_TOP + (1 - (logP - logMin) / (logMax - logMin)) * plotH;
    },
    [logMin, logMax, plotH]
  );
  const xFor = (i: number) => PAD_LEFT + slot * i + slot / 2;

  // ── Drag handlers — MUST be before any conditional return ──────────────────
  const getSvgY = useCallback((clientY: number): number => {
    if (!svgRef.current) return 0;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleY = VIEW_H / rect.height;
    return (clientY - rect.top) * scaleY;
  }, []);

  // Inverse log scale: pixel → price
  const yToPrice = useCallback(
    (pixelY: number) => Math.exp(logMin + (1 - (pixelY - PAD_TOP) / plotH) * (logMax - logMin)),
    [logMin, logMax, plotH]
  );

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging || !onRangeChange) return;
    const svgY = getSvgY(e.clientY);
    const newPrice = yToPrice(svgY);
    const newTick = Math.round(priceToTick(newPrice, decimalsA, decimalsB));
    const snapped = nearestUsableTick(newTick, tickSpacing, minTick, maxTick);

    const curLo = tickLower ?? nearestUsableTick(minTick, tickSpacing, minTick, maxTick);
    const curHi = tickUpper ?? nearestUsableTick(maxTick, tickSpacing, minTick, maxTick);

    if (dragging === "lower") {
      onRangeChange(Math.min(snapped, curHi - tickSpacing), curHi);
    } else {
      onRangeChange(curLo, Math.max(snapped, curLo + tickSpacing));
    }
  }, [dragging, onRangeChange, yToPrice, decimalsA, decimalsB, tickSpacing, minTick, maxTick, tickLower, tickUpper]);

  const stopDrag = useCallback(() => setDragging(null), []);

  // ── Derived render values (non-hook, safe after all useCallback/useMemo) ────

  // Y-axis ticks: log-spaced (equal % between ticks) not linearly-spaced.
  // Produces clean "×10", "×2" etc markers instead of cramped labels near zero.
  const Y_TICKS = 5;
  const yTickVals = Array.from({ length: Y_TICKS }, (_, i) =>
    Math.exp(logMin + (logMax - logMin) * i / (Y_TICKS - 1))
  );

  const xLabelCount = Math.min(5, n);
  const xLabelIndices = Array.from({ length: xLabelCount }, (_, i) =>
    Math.floor((i * (n - 1)) / Math.max(1, xLabelCount - 1))
  );

  // Adaptive SMA window: ~20% of data points, min 3, max 21.
  // Short window for sparse data (few candles) prevents SMA from disappearing;
  // longer window for dense data smooths noise effectively.
  const SMA_P = Math.max(3, Math.min(21, Math.round(candles.length * 0.2)));
  const smaPoints: { x: number; y: number }[] = [];
  for (let i = SMA_P - 1; i < candles.length; i++) {
    const avg = candles.slice(i - SMA_P + 1, i + 1).reduce((s, c) => s + c.close, 0) / SMA_P;
    smaPoints.push({ x: xFor(i), y: yFor(avg) });
  }

  const effectiveLowerPrice = fullRange
    ? minPrice + (maxPrice - minPrice) * 0.05
    : (priceLo != null ? Math.min(priceLo, priceHi ?? priceLo) : null);
  const effectiveUpperPrice = fullRange
    ? maxPrice - (maxPrice - minPrice) * 0.05
    : (priceHi != null ? Math.max(priceHi, priceLo ?? priceHi) : null);

  const lowerY = effectiveLowerPrice != null ? yFor(effectiveLowerPrice) : null;
  const upperY = effectiveUpperPrice != null ? yFor(effectiveUpperPrice) : null;
  const currentY = livePrice != null ? yFor(livePrice) : null;
  const showHandles = onRangeChange != null && (lowerY != null || upperY != null);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
          <TrendingUp size={11} className="text-emerald-400" />
          {symbolA}/{symbolB}
          {livePrice != null && (
            <span className="ml-2 font-bold text-[13px]"
              style={{ color: fullRange ? "#10b981" : inRange ? "#10b981" : "#f59e0b" }}>
              {fullRange ? "● Full Range" : inRange ? "● In Range" : "○ Out of Range"}{" "}
              {formatPrice(livePrice)}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-1">
          {PERIODS.map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className="text-[10px] px-1.5 py-0.5 rounded cursor-pointer"
              style={{
                background: period === p ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.04)",
                border: period === p ? "1px solid rgba(16,185,129,0.4)" : "1px solid rgba(255,255,255,0.08)",
                color: period === p ? "#6ee7b7" : "#6b7280",
              }}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Chart — shimmer while loading, full chart once ready */}
      {loading ? (
        <div style={{ height: VIEW_H }} className="shimmer rounded-xl" />
      ) : (
      <div style={{ height: VIEW_H }} className="relative select-none"
        onMouseMove={handleMouseMove}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
      >
        <svg ref={svgRef} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" height="100%" preserveAspectRatio="none">

          {/* Grid */}
          {yTickVals.map((v, i) => (
            <line key={i} x1={PAD_LEFT} x2={VIEW_W - PAD_RIGHT} y1={yFor(v)} y2={yFor(v)}
              stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
          ))}

          {/* Range band — always shown (greyed when full range) */}
          {showHandles && lowerY != null && upperY != null && (
            <rect x={PAD_LEFT} width={plotW}
              y={Math.min(lowerY, upperY)}
              height={Math.abs(lowerY - upperY)}
              fill={fullRange ? "rgba(99,102,241,0.05)" : inRange ? "rgba(16,185,129,0.12)" : "rgba(99,102,241,0.10)"}
            />
          )}

          {/* Candles */}
          {hasCandles && candles.map((c, i) => {
            const x = xFor(i);
            const isUp = c.close >= c.open;
            const color = isUp ? "#10b981" : "#ef4444";
            const bodyTop = yFor(Math.max(c.open, c.close));
            const bodyH = Math.max(1, yFor(Math.min(c.open, c.close)) - bodyTop);
            return (
              <g key={c.bucketStart}
                onMouseEnter={() => setHovered(c)}
                onMouseLeave={() => setHovered(h => (h?.bucketStart === c.bucketStart ? null : h))}>
                <rect x={x - slot / 2} y={PAD_TOP} width={slot} height={plotH} fill="transparent" />
                <line x1={x} x2={x} y1={yFor(c.high)} y2={yFor(c.low)} stroke={color} strokeWidth={1} />
                <rect x={x - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={bodyH} fill={color} />
              </g>
            );
          })}

          {/* Empty state */}
          {!hasCandles && (
            <text x={VIEW_W / 2} y={VIEW_H / 2 + 4} textAnchor="middle" fontSize={11} fill="#4b5563">
              Mengakumulasi data harga... (~20 detik)
            </text>
          )}

          {/* SMA line */}
          {smaPoints.length >= 2 && (
            <polyline points={smaPoints.map(p => `${p.x},${p.y}`).join(" ")}
              fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeOpacity={0.7}
              strokeLinejoin="round" strokeLinecap="round" />
          )}

          {/* Current price line */}
          {currentY != null && (
            <>
              <line x1={PAD_LEFT} x2={VIEW_W - PAD_RIGHT} y1={currentY} y2={currentY}
                stroke="#ffffff" strokeWidth={1} strokeOpacity={0.3} strokeDasharray="4 3" />
              <rect x={VIEW_W - PAD_RIGHT + 4} y={currentY - 8} width={PAD_RIGHT - 4} height={16}
                fill="#1f2937" rx={3} />
              <text x={VIEW_W - PAD_RIGHT + 6} y={currentY + 4} fontSize={8} fill="#d1d5db">
                {formatPrice(livePrice ?? 0)}
              </text>
            </>
          )}

          {/* ── Lower price handle ── */}
          {showHandles && lowerY != null && (
            <g style={{ cursor: dragging === "lower" ? "grabbing" : "ns-resize" }}
              onMouseDown={(e) => { e.preventDefault(); setDragging("lower"); }}>
              <line x1={PAD_LEFT} x2={VIEW_W - PAD_RIGHT} y1={lowerY} y2={lowerY}
                stroke={fullRange ? "#4b5563" : "#6366f1"} strokeWidth={fullRange ? 1 : 2}
                strokeOpacity={dragging === "lower" ? 1 : 0.8} strokeDasharray={fullRange ? "6 4" : undefined} />
              <circle cx={PAD_LEFT + plotW * 0.15} cy={lowerY} r={7}
                fill={fullRange ? "#374151" : "#6366f1"} stroke="#1f2937" strokeWidth={2} />
              <circle cx={PAD_LEFT + plotW * 0.15} cy={lowerY} r={3} fill="white" opacity={fullRange ? 0.3 : 0.7} />
              {/* Label */}
              <rect x={PAD_LEFT + 2} y={lowerY - 18} width={fullRange ? 64 : 90} height={16} rx={3}
                fill={fullRange ? "#1f2937" : "#312e81"} fillOpacity={0.95} />
              <text x={PAD_LEFT + 6} y={lowerY - 7} fontSize={9}
                fill={fullRange ? "#6b7280" : "#a5b4fc"} fontWeight="600">
                {fullRange ? "← Full" : `Min: ${formatPrice(effectiveLowerPrice!)}`}
              </text>
            </g>
          )}

          {/* ── Upper price handle ── */}
          {showHandles && upperY != null && (
            <g style={{ cursor: dragging === "upper" ? "grabbing" : "ns-resize" }}
              onMouseDown={(e) => { e.preventDefault(); setDragging("upper"); }}>
              <line x1={PAD_LEFT} x2={VIEW_W - PAD_RIGHT} y1={upperY} y2={upperY}
                stroke={fullRange ? "#4b5563" : "#6366f1"} strokeWidth={fullRange ? 1 : 2}
                strokeOpacity={dragging === "upper" ? 1 : 0.8} strokeDasharray={fullRange ? "6 4" : undefined} />
              <circle cx={PAD_LEFT + plotW * 0.85} cy={upperY} r={7}
                fill={fullRange ? "#374151" : "#6366f1"} stroke="#1f2937" strokeWidth={2} />
              <circle cx={PAD_LEFT + plotW * 0.85} cy={upperY} r={3} fill="white" opacity={fullRange ? 0.3 : 0.7} />
              <rect x={PAD_LEFT + plotW * 0.85 - 46} y={upperY + 3}
                width={fullRange ? 60 : 90} height={16} rx={3}
                fill={fullRange ? "#1f2937" : "#312e81"} fillOpacity={0.95} />
              <text x={PAD_LEFT + plotW * 0.85 - 42} y={upperY + 14} fontSize={9}
                fill={fullRange ? "#6b7280" : "#a5b4fc"} fontWeight="600">
                {fullRange ? "Full →" : `Max: ${formatPrice(effectiveUpperPrice!)}`}
              </text>
            </g>
          )}

          {/* Y-axis labels */}
          {yTickVals.map((v, i) => (
            <text key={i} x={VIEW_W - PAD_RIGHT + 4} y={yFor(v) + 3} fontSize={8} fill="#6b7280">
              {formatPrice(v)}
            </text>
          ))}

          {/* X-axis labels */}
          {hasCandles && xLabelIndices.map(idx => (
            <text key={idx} x={xFor(idx)} y={VIEW_H - 8} fontSize={8} fill="#6b7280" textAnchor="middle">
              {new Date(candles[idx].bucketStart).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
            </text>
          ))}
        </svg>

        {/* Hover tooltip */}
        {hovered && (
          <div className="absolute top-1 left-1 px-2 py-1.5 rounded-md pointer-events-none leading-relaxed text-[10px]"
            style={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="text-gray-500">{new Date(hovered.bucketStart).toLocaleTimeString("id-ID")}</div>
            <div>O <span className="text-white">{formatPrice(hovered.open)}</span>{" "}
              H <span className="text-emerald-400">{formatPrice(hovered.high)}</span></div>
            <div>L <span className="text-red-400">{formatPrice(hovered.low)}</span>{" "}
              C <span className="text-white">{formatPrice(hovered.close)}</span></div>
          </div>
        )}
      </div>
      )} {/* end loading conditional */}

      {/* Footer */}
      <div className="flex items-center gap-2 mt-1.5 text-[9px]">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-600" />
        <span className="text-gray-600">Chart statis · range interaktif</span>
        <span className="text-yellow-600 ml-1">─ SMA-7</span>
        {onRangeChange && (
          <span className="text-indigo-400 ml-1">
            {fullRange ? "↕ Drag untuk set custom range" : "↕ Drag handle untuk ubah range"}
          </span>
        )}
      </div>
    </div>
  );
}
