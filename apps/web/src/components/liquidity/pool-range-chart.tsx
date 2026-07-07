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
function tickToPrice(tick: number, decimalsA: number, decimalsB: number): number {
  return Math.pow(1.0001, tick) * 10 ** (decimalsA - decimalsB);
}
function priceToTick(price: number, decimalsA: number, decimalsB: number): number {
  if (price <= 0) return 0;
  return Math.log(price / 10 ** (decimalsA - decimalsB)) / Math.log(1.0001);
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

  useEffect(() => {
    fetchHistory();
    const id = setInterval(() => fetchHistory(true), 10_000);
    return () => clearInterval(id);
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

  // ── Chart scale ────────────────────────────────────────────────────────────
  if (loading) return <div className="h-64 shimmer rounded-xl" />;

  const hasCandles = candles.length > 0;

  let minPrice = hasCandles ? Math.min(...candles.map(c => c.low)) : (livePrice ?? 0) * 0.98;
  let maxPrice = hasCandles ? Math.max(...candles.map(c => c.high)) : (livePrice ?? 0) * 1.02;

  // Widen domain to fit range handles (but not full-range)
  if (!fullRange && priceLo != null && priceHi != null) {
    const lo = Math.min(priceLo, priceHi);
    const hi = Math.max(priceLo, priceHi);
    minPrice = Math.min(minPrice, lo);
    maxPrice = Math.max(maxPrice, hi);
  }
  if (minPrice === maxPrice) { minPrice *= 0.97; maxPrice *= 1.03; }
  const pad = (maxPrice - minPrice) * 0.10;
  minPrice -= pad;
  maxPrice += pad;

  const plotW = VIEW_W - PAD_LEFT - PAD_RIGHT;
  const plotH = VIEW_H - PAD_TOP - PAD_BOTTOM;
  const n = Math.max(candles.length, 1);
  const slot = plotW / n;
  const bodyWidth = Math.max(2, Math.min(slot * 0.6, 36));

  const yFor = (price: number) => PAD_TOP + (1 - (price - minPrice) / (maxPrice - minPrice)) * plotH;
  const xFor = (i: number) => PAD_LEFT + slot * i + slot / 2;
  // Inverse: pixel Y → price
  const yToPrice = (pixelY: number) => minPrice + (1 - (pixelY - PAD_TOP) / plotH) * (maxPrice - minPrice);

  // SMA-7
  const SMA = 7;
  const smaPoints: { x: number; y: number }[] = [];
  for (let i = SMA - 1; i < candles.length; i++) {
    const avg = candles.slice(i - SMA + 1, i + 1).reduce((s, c) => s + c.close, 0) / SMA;
    smaPoints.push({ x: xFor(i), y: yFor(avg) });
  }

  const Y_TICKS = 5;
  const yTickVals = Array.from({ length: Y_TICKS }, (_, i) => minPrice + ((maxPrice - minPrice) * i) / (Y_TICKS - 1));
  const xLabelCount = Math.min(5, n);
  const xLabelIndices = Array.from({ length: xLabelCount }, (_, i) =>
    Math.floor((i * (n - 1)) / Math.max(1, xLabelCount - 1))
  );

  // Handle positions
  const lowerY = !fullRange && priceLo != null ? yFor(Math.min(priceLo, priceHi ?? priceLo)) : null;
  const upperY = !fullRange && priceHi != null ? yFor(Math.max(priceHi, priceLo ?? priceHi)) : null;
  const currentY = livePrice != null ? yFor(livePrice) : null;

  // ── Drag handlers ──────────────────────────────────────────────────────────
  const getSvgY = (clientY: number): number => {
    if (!svgRef.current) return 0;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleY = VIEW_H / rect.height;
    return (clientY - rect.top) * scaleY;
  };

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

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
          <TrendingUp size={11} className="text-emerald-400" />
          {symbolA}/{symbolB}
          {livePrice != null && (
            <span className="ml-2 font-bold text-[13px]"
              style={{ color: inRange ? "#10b981" : "#f59e0b" }}>
              {inRange ? "● In Range" : "○ Out of Range"} {formatPrice(livePrice)}
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

      {/* Chart */}
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

          {/* Range band */}
          {!fullRange && lowerY != null && upperY != null && (
            <rect x={PAD_LEFT} width={plotW}
              y={Math.min(lowerY, upperY)}
              height={Math.abs(lowerY - upperY)}
              fill={inRange ? "rgba(16,185,129,0.12)" : "rgba(99,102,241,0.10)"}
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
          {!fullRange && lowerY != null && (
            <g style={{ cursor: dragging === "lower" ? "grabbing" : "ns-resize" }}
              onMouseDown={(e) => { e.preventDefault(); setDragging("lower"); }}>
              {/* Handle line */}
              <line x1={PAD_LEFT} x2={VIEW_W - PAD_RIGHT} y1={lowerY} y2={lowerY}
                stroke="#6366f1" strokeWidth={2} strokeOpacity={dragging === "lower" ? 1 : 0.8} />
              {/* Handle knob */}
              <circle cx={PAD_LEFT + plotW * 0.15} cy={lowerY} r={6}
                fill="#6366f1" stroke="#1f2937" strokeWidth={2} />
              <circle cx={PAD_LEFT + plotW * 0.15} cy={lowerY} r={3} fill="white" opacity={0.6} />
              {/* Label */}
              <rect x={PAD_LEFT + 2} y={lowerY - 18} width={90} height={16} rx={3}
                fill="#312e81" fillOpacity={0.95} />
              <text x={PAD_LEFT + 6} y={lowerY - 7} fontSize={9} fill="#a5b4fc" fontWeight="600">
                Min: {formatPrice(Math.min(priceLo!, priceHi ?? priceLo!))}
              </text>
            </g>
          )}

          {/* ── Upper price handle ── */}
          {!fullRange && upperY != null && (
            <g style={{ cursor: dragging === "upper" ? "grabbing" : "ns-resize" }}
              onMouseDown={(e) => { e.preventDefault(); setDragging("upper"); }}>
              <line x1={PAD_LEFT} x2={VIEW_W - PAD_RIGHT} y1={upperY} y2={upperY}
                stroke="#6366f1" strokeWidth={2} strokeOpacity={dragging === "upper" ? 1 : 0.8} />
              <circle cx={PAD_LEFT + plotW * 0.85} cy={upperY} r={6}
                fill="#6366f1" stroke="#1f2937" strokeWidth={2} />
              <circle cx={PAD_LEFT + plotW * 0.85} cy={upperY} r={3} fill="white" opacity={0.6} />
              <rect x={PAD_LEFT + plotW * 0.85 - 46} y={upperY + 3} width={90} height={16} rx={3}
                fill="#312e81" fillOpacity={0.95} />
              <text x={PAD_LEFT + plotW * 0.85 - 42} y={upperY + 14} fontSize={9} fill="#a5b4fc" fontWeight="600">
                Max: {formatPrice(Math.max(priceHi!, priceLo ?? priceHi!))}
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

      {/* Footer */}
      <div className="flex items-center gap-2 mt-1.5 text-[9px]">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-gray-600">Live · ~20s</span>
        <span className="text-yellow-600 ml-1">─ SMA-7</span>
        {onRangeChange && !fullRange && (
          <span className="text-indigo-400 ml-1">⟷ Drag handle untuk atur range harga</span>
        )}
        {fullRange && (
          <span className="text-gray-600 ml-auto">Full range</span>
        )}
      </div>
    </div>
  );
}
