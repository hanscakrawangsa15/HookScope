"use client";

import { useState, type ReactNode } from "react";
import { ArrowLeftRight, Droplets } from "lucide-react";

interface TradingPanelTabsProps {
  swap: ReactNode;
  addLiquidity: ReactNode;
}

// Both tabs stay mounted (toggled via `hidden`, not conditional rendering) so
// switching tabs doesn't re-trigger each panel's own pool-list fetch / quote
// probe — they're independent, self-contained panels that already manage their
// own pool selection and range state.
export function TradingPanelTabs({ swap, addLiquidity }: TradingPanelTabsProps) {
  const [tab, setTab] = useState<"swap" | "liquidity">("liquidity");

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-4 p-1 rounded-xl w-fit"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <TabButton active={tab === "swap"} onClick={() => setTab("swap")} icon={<ArrowLeftRight size={12} />} label="Swap" />
        <TabButton active={tab === "liquidity"} onClick={() => setTab("liquidity")} icon={<Droplets size={12} />} label="Add Liquidity" />
      </div>
      <div className={tab === "swap" ? "" : "hidden"}>{swap}</div>
      <div className={tab === "liquidity" ? "" : "hidden"}>{addLiquidity}</div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-all"
      style={{
        background: active ? "rgba(59,130,246,0.18)" : "transparent",
        color: active ? "#93c5fd" : "#6b7280",
      }}
    >
      {icon} {label}
    </button>
  );
}
