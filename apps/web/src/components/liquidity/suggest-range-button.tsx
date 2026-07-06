"use client";

import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

interface SuggestRangeButtonProps {
  hookAddress: string;
  poolId: string;
  chainId: number;
  currentTick: number | null;
  tickSpacing: number;
  minTick: number;
  maxTick: number;
  onApply: (ticks: { tickLower: number; tickUpper: number }) => void;
}

export function SuggestRangeButton({
  hookAddress, poolId, chainId, currentTick, tickSpacing, minTick, maxTick, onApply,
}: SuggestRangeButtonProps) {
  const [loading, setLoading] = useState(false);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSuggest = async () => {
    if (currentTick == null) return;
    setLoading(true);
    setError(null);
    setReasoning(null);
    try {
      const res = await api.priceHistory.suggestRange(hookAddress, poolId, {
        chainId, currentTick, tickSpacing, minTick, maxTick,
      });
      onApply({ tickLower: res.tickLower, tickUpper: res.tickUpper });
      if (res.usedFallback) {
        setReasoning(`Belum cukup histori harga (${res.sampleSize} data) — menggunakan rentang default ±10%.`);
      } else {
        const dir = res.trendBiasPct > 0 ? "naik" : res.trendBiasPct < 0 ? "turun" : "netral";
        setReasoning(
          `Lebar ±${res.widthPct}% berdasarkan volatilitas, bias ${dir} ${Math.abs(res.trendBiasPct)}% mengikuti tren ${res.sampleSize} data harga terakhir.`
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengambil saran range");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1">
      <button
        onClick={handleSuggest}
        disabled={loading || currentTick == null}
        className="text-[10px] px-2 py-1 rounded-lg cursor-pointer flex items-center gap-1 disabled:opacity-50"
        style={{ background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.3)", color: "#d8b4fe" }}
      >
        {loading ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
        Suggest Range
      </button>
      {reasoning && <p className="text-[10px] text-gray-500 px-1">{reasoning}</p>}
      {error && <p className="text-[10px] text-red-400 px-1">{error}</p>}
    </div>
  );
}
