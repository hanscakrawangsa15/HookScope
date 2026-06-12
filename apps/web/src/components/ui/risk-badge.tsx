interface RiskBadgeProps {
  level: string;
  score?: number | null;
  size?: "sm" | "md";
}

const RISK_STYLES: Record<string, { bg: string; text: string; border: string; glow?: string; dot: string }> = {
  CRITICAL: {
    bg:     "rgba(239,68,68,0.12)",
    text:   "#fca5a5",
    border: "rgba(239,68,68,0.35)",
    glow:   "0 0 12px rgba(239,68,68,0.25)",
    dot:    "#ef4444",
  },
  HIGH: {
    bg:     "rgba(249,115,22,0.10)",
    text:   "#fdba74",
    border: "rgba(249,115,22,0.30)",
    glow:   "0 0 10px rgba(249,115,22,0.18)",
    dot:    "#f97316",
  },
  MEDIUM: {
    bg:     "rgba(234,179,8,0.10)",
    text:   "#fde047",
    border: "rgba(234,179,8,0.28)",
    dot:    "#eab308",
  },
  LOW: {
    bg:     "rgba(34,197,94,0.08)",
    text:   "#86efac",
    border: "rgba(34,197,94,0.25)",
    dot:    "#22c55e",
  },
  UNKNOWN: {
    bg:     "rgba(255,255,255,0.05)",
    text:   "#9ca3af",
    border: "rgba(255,255,255,0.10)",
    dot:    "#6b7280",
  },
};

export function RiskBadge({ level, score, size = "sm" }: RiskBadgeProps) {
  const s = RISK_STYLES[level] ?? RISK_STYLES.UNKNOWN;
  const label = level === "UNKNOWN" ? "UNANALYZED" : level;

  return (
    <span
      className="inline-flex items-center gap-1.5 font-semibold tracking-wide"
      style={{
        background:   s.bg,
        color:        s.text,
        border:       `1px solid ${s.border}`,
        boxShadow:    s.glow,
        borderRadius: "9999px",
        padding:      size === "md" ? "4px 12px" : "2px 8px",
        fontSize:     size === "md" ? "12px" : "10px",
        letterSpacing: "0.06em",
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: s.dot, flexShrink: 0,
        boxShadow: level === "CRITICAL" ? `0 0 4px ${s.dot}` : undefined }} />
      {label}
      {score != null && (
        <span style={{ opacity: 0.7, fontWeight: 400 }}>· {score}</span>
      )}
    </span>
  );
}
