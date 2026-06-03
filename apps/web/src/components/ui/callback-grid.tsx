import { cn, CALLBACK_LABELS } from "@/lib/utils";

interface CallbackGridProps {
  callbacks: Record<string, boolean>;
  compact?: boolean;
}

export function CallbackGrid({ callbacks, compact = false }: CallbackGridProps) {
  const DELTA_CALLBACKS = new Set([
    "beforeSwapReturnsDelta",
    "afterSwapReturnsDelta",
    "afterAddLiquidityReturnsDelta",
    "afterRemoveLiquidityReturnsDelta",
  ]);

  const groups = [
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
      label: "Delta Returns (advanced)",
      keys: [
        "beforeSwapReturnsDelta", "afterSwapReturnsDelta",
        "afterAddLiquidityReturnsDelta", "afterRemoveLiquidityReturnsDelta",
      ],
    },
  ];

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.label}>
          {!compact && (
            <p className="text-xs text-gray-500 mb-1.5">{group.label}</p>
          )}
          <div className={cn(
            "grid gap-1.5",
            compact ? "grid-cols-4" : "grid-cols-2 sm:grid-cols-3"
          )}>
            {group.keys.map((key) => {
              const active = callbacks[key];
              const isDelta = DELTA_CALLBACKS.has(key);
              return (
                <div
                  key={key}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-mono border",
                    active
                      ? isDelta
                        ? "bg-purple-500/10 border-purple-500/30 text-purple-300"
                        : "bg-blue-500/10 border-blue-500/30 text-blue-300"
                      : "bg-white/3 border-white/5 text-gray-600"
                  )}
                >
                  <span className={cn(
                    "w-1.5 h-1.5 rounded-full flex-shrink-0",
                    active ? (isDelta ? "bg-purple-400" : "bg-blue-400") : "bg-gray-600"
                  )} />
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
