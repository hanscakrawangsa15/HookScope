"use client";

import { useState } from "react";
import { ArrowRightLeft } from "lucide-react";

// Inverse of the tickToPrice formula used everywhere else in the LP flow
// (price-snapshot-service.ts, pool-candlestick-chart.tsx, every panel's presetTicks()).
function priceToTick(price: number, decimalsA: number, decimalsB: number): number {
  return Math.log(price / 10 ** (decimalsA - decimalsB)) / Math.log(1.0001);
}

function tickToPrice(tick: number, decimalsA: number, decimalsB: number): number {
  return Math.pow(1.0001, tick) * 10 ** (decimalsA - decimalsB);
}

function nearestUsableTick(tick: number, tickSpacing: number, minTick: number, maxTick: number): number {
  const rounded = Math.round(tick / tickSpacing) * tickSpacing;
  if (rounded < minTick) return Math.ceil(minTick / tickSpacing) * tickSpacing;
  if (rounded > maxTick) return Math.floor(maxTick / tickSpacing) * tickSpacing;
  return rounded;
}

interface ManualRangeInputProps {
  currentTick: number | null;
  tickSpacing: number;
  decimalsA: number;
  decimalsB: number;
  minTick: number;
  maxTick: number;
  symbolA: string;
  symbolB: string;
  onApply: (ticks: { tickLower: number; tickUpper: number }) => void;
}

export function ManualRangeInput({
  currentTick, tickSpacing, decimalsA, decimalsB, minTick, maxTick, symbolA, symbolB, onApply,
}: ManualRangeInputProps) {
  const [minPriceStr, setMinPriceStr] = useState("");
  const [maxPriceStr, setMaxPriceStr] = useState("");
  const [error, setError] = useState<string | null>(null);

  const currentPrice = currentTick != null ? tickToPrice(currentTick, decimalsA, decimalsB) : null;

  const handleApply = () => {
    const minPrice = Number(minPriceStr);
    const maxPrice = Number(maxPriceStr);
    if (!minPriceStr || !maxPriceStr || !(minPrice > 0) || !(maxPrice > 0)) {
      setError("Masukkan harga min dan max yang valid");
      return;
    }
    if (minPrice >= maxPrice) {
      setError("Harga min harus lebih kecil dari harga max");
      return;
    }
    setError(null);
    const rawLower = priceToTick(minPrice, decimalsA, decimalsB);
    const rawUpper = priceToTick(maxPrice, decimalsA, decimalsB);
    const tickLower = nearestUsableTick(rawLower, tickSpacing, minTick, maxTick);
    const tickUpper = nearestUsableTick(rawUpper, tickSpacing, minTick, maxTick);
    onApply({ tickLower: Math.min(tickLower, tickUpper), tickUpper: Math.max(tickLower, tickUpper) });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] text-gray-500">Range manual ({symbolB} per {symbolA})</span>
        {currentPrice != null && (
          <span className="text-[10px] text-gray-600">Harga saat ini: {currentPrice.toPrecision(6)}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="number" min="0" step="any" placeholder="Min price"
          value={minPriceStr}
          onChange={(e) => setMinPriceStr(e.target.value)}
          className="w-full text-xs rounded-lg px-2.5 py-1.5 bg-black/20 text-gray-300 border border-white/10 outline-none"
        />
        <ArrowRightLeft size={11} className="text-gray-600 flex-shrink-0" />
        <input
          type="number" min="0" step="any" placeholder="Max price"
          value={maxPriceStr}
          onChange={(e) => setMaxPriceStr(e.target.value)}
          className="w-full text-xs rounded-lg px-2.5 py-1.5 bg-black/20 text-gray-300 border border-white/10 outline-none"
        />
        <button
          onClick={handleApply}
          className="text-[10px] px-2 py-1.5 rounded-lg cursor-pointer whitespace-nowrap"
          style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)", color: "#93c5fd" }}
        >
          Terapkan
        </button>
      </div>
      {error && <p className="text-[10px] text-red-400 px-1">{error}</p>}
    </div>
  );
}
