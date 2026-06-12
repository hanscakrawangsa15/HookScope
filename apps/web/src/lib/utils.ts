import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortAddress(address: string, chars = 6): string {
  if (!address) return "";
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function riskColor(level: string): string {
  switch (level) {
    case "LOW":      return "text-green-500";
    case "MEDIUM":   return "text-yellow-500";
    case "HIGH":     return "text-orange-500";
    case "CRITICAL": return "text-red-500";
    default:         return "text-gray-400";
  }
}

export function riskBgColor(level: string): string {
  switch (level) {
    case "LOW":      return "bg-green-500/10 text-green-400 border-green-500/20";
    case "MEDIUM":   return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
    case "HIGH":     return "bg-orange-500/10 text-orange-400 border-orange-500/20";
    case "CRITICAL": return "bg-red-500/10 text-red-400 border-red-500/20";
    default:         return "bg-gray-500/10 text-gray-400 border-gray-500/20";
  }
}

export function chainName(chainId: number): string {
  const names: Record<number, string> = {
    1: "Ethereum",
    8453: "Base",
    42161: "Arbitrum",
    10: "Optimism",
    11155111: "Sepolia",
    84532: "Base Sepolia",
  };
  return names[chainId] ?? `Chain ${chainId}`;
}

export function chainIcon(chainId: number): string {
  const icons: Record<number, string> = {
    1: "⟠",
    8453: "🔵",
    42161: "🔷",
    10: "🔴",
    11155111: "⟠",
    84532: "🔵",
  };
  return icons[chainId] ?? "🔗";
}

export function formatTvl(usd: number | null): string {
  if (usd === null || !isFinite(usd)) return "—";
  // Sanity cap: values above $100T are data errors, not real TVL
  if (usd > 100_000_000_000_000) return "—";
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${usd.toFixed(0)}`;
}

export function timeAgo(date: string | null): string {
  if (!date) return "Unknown";
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export const CALLBACK_LABELS: Record<string, string> = {
  beforeInitialize: "Before Init",
  afterInitialize: "After Init",
  beforeAddLiquidity: "Before Add",
  afterAddLiquidity: "After Add",
  beforeRemoveLiquidity: "Before Remove",
  afterRemoveLiquidity: "After Remove",
  beforeSwap: "Before Swap",
  afterSwap: "After Swap",
  beforeDonate: "Before Donate",
  afterDonate: "After Donate",
  beforeSwapReturnsDelta: "Swap Δ",
  afterSwapReturnsDelta: "Post-Swap Δ",
  afterAddLiquidityReturnsDelta: "Add Liq Δ",
  afterRemoveLiquidityReturnsDelta: "Remove Liq Δ",
};
