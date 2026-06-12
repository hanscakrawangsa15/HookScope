import { cn, CALLBACK_LABELS } from "@/lib/utils";

interface CallbackGridProps {
  callbacks: Record<string, boolean>;
  compact?: boolean;
}

const DELTA_CALLBACKS = new Set([
  "beforeSwapReturnsDelta",
  "afterSwapReturnsDelta",
  "afterAddLiquidityReturnsDelta",
  "afterRemoveLiquidityReturnsDelta",
]);

const GROUPS = [
  {
    label: "Lifecycle",
    keys: [
      "beforeInitialize", "afterInitialize",
      "beforeAddLiquidity", "afterAddLiquidity",
      "beforeRemoveLiquidity", "afterRemoveLiquidity",
      "beforeSwap", "afterSwap",
      "beforeDonate", "afterDonate",
    ],
  },
  {
    label: "Delta Returns",
    keys: [
      "beforeSwapReturnsDelta", "afterSwapReturnsDelta",
      "afterAddLiquidityReturnsDelta", "afterRemoveLiquidityReturnsDelta",
    ],
  },
];

export function CallbackGrid({ callbacks, compact = false }: CallbackGridProps) {
  const activeCount = Object.values(callbacks).filter(Boolean).length;

  if (compact) {
    // Compact mode: a dense grid of tiny squares (used in HookCard)
    const allKeys = GROUPS.flatMap((g) => g.keys);
    return (
      <div>
        <div className="flex flex-wrap gap-1">
          {allKeys.map((key) => {
            const active = callbacks[key];
            const isDelta = DELTA_CALLBACKS.has(key);
            return (
              <div
                key={key}
                title={`${CALLBACK_LABELS[key] ?? key}${active ? " ✓" : " ✗"}`}
                className="relative group"
                style={{
                  width: 14, height: 14,
                  borderRadius: 3,
                  background: active
                    ? isDelta
                      ? "rgba(168,85,247,0.45)"
                      : "rgba(59,130,246,0.45)"
                    : "rgba(255,255,255,0.05)",
                  border: `1px solid ${
                    active
                      ? isDelta ? "rgba(168,85,247,0.5)" : "rgba(59,130,246,0.4)"
                      : "rgba(255,255,255,0.06)"
                  }`,
                  boxShadow: active
                    ? isDelta
                      ? "0 0 5px rgba(168,85,247,0.3)"
                      : "0 0 5px rgba(59,130,246,0.25)"
                    : "none",
                }}
              />
            );
          })}
        </div>
        <p className="text-[10px] text-gray-600 mt-1.5">
          {activeCount} / 14 callbacks active
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {GROUPS.map((group) => (
        <div key={group.label}>
          <p className="text-[11px] text-gray-500 font-semibold uppercase tracking-wider mb-2">
            {group.label}
            {group.label === "Delta Returns" && (
              <span className="ml-2 text-purple-400 normal-case font-normal">⚡ custom accounting</span>
            )}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {group.keys.map((key) => {
              const active = callbacks[key];
              const isDelta = DELTA_CALLBACKS.has(key);
              return (
                <div
                  key={key}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-mono border transition-all",
                    active
                      ? isDelta
                        ? "border-purple-500/30 text-purple-200"
                        : "border-blue-500/25 text-blue-200"
                      : "border-white/5 text-gray-700"
                  )}
                  style={{
                    background: active
                      ? isDelta
                        ? "rgba(168,85,247,0.08)"
                        : "rgba(59,130,246,0.08)"
                      : "rgba(255,255,255,0.02)",
                    boxShadow: active
                      ? isDelta
                        ? "inset 0 1px 0 rgba(168,85,247,0.1)"
                        : "inset 0 1px 0 rgba(59,130,246,0.1)"
                      : "none",
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{
                      background: active
                        ? isDelta ? "#a855f7" : "#60a5fa"
                        : "#374151",
                      boxShadow: active
                        ? isDelta ? "0 0 4px rgba(168,85,247,0.6)" : "0 0 4px rgba(96,165,250,0.5)"
                        : "none",
                    }}
                  />
                  <span className="truncate">{CALLBACK_LABELS[key] ?? key}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
