import { cn, riskBgColor } from "@/lib/utils";

interface RiskBadgeProps {
  level: string;
  score?: number | null;
  size?: "sm" | "md";
}

export function RiskBadge({ level, score, size = "sm" }: RiskBadgeProps) {
  return (
    <span className={cn(
      "badge",
      riskBgColor(level),
      size === "md" && "text-sm px-3 py-1"
    )}>
      {level === "UNKNOWN" ? "UNANALYZED" : level}
      {score != null && ` · ${score}`}
    </span>
  );
}
