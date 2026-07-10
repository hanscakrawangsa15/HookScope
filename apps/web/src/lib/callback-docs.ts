export interface CallbackDoc {
  name: string;
  label: string;
  timing: "before" | "after";
  category: "swap" | "liquidity" | "init" | "donate" | "delta";
  risk: "low" | "medium" | "high";
  description: string;
  useCases: string[];
  warning?: string;
}

export const CALLBACK_DOCS: Record<string, CallbackDoc> = {
  beforeInitialize: {
    name: "beforeInitialize",
    label: "Before Initialize",
    timing: "before",
    category: "init",
    risk: "low",
    description: "Executed before the pool is created. Allows the hook to validate or reject pool creation, or initialize internal hook state.",
    useCases: ["Custom pricing curve setup", "Whitelist pool creator", "Custom oracle initialization", "Parameter validation"],
  },
  afterInitialize: {
    name: "afterInitialize",
    label: "After Initialize",
    timing: "after",
    category: "init",
    risk: "low",
    description: "Executed after the pool is successfully created. Suitable for oracle initialization, state tracking, or registration with external systems.",
    useCases: ["Oracle initialization", "Pool registry", "Initial liquidity snapshot", "Event emission"],
  },
  beforeAddLiquidity: {
    name: "beforeAddLiquidity",
    label: "Before Add Liquidity",
    timing: "before",
    category: "liquidity",
    risk: "medium",
    description: "Executed before liquidity is added. Can block or modify liquidity additions — often used for access control.",
    useCases: ["KYC/whitelist check", "Minimum deposit enforcement", "Custom fee tiers", "Epoch-based liquidity"],
    warning: "Can block users from adding liquidity if conditions are not met.",
  },
  afterAddLiquidity: {
    name: "afterAddLiquidity",
    label: "After Add Liquidity",
    timing: "after",
    category: "liquidity",
    risk: "low",
    description: "Executed after liquidity is successfully added. Commonly used to distribute rewards to liquidity providers.",
    useCases: ["Reward distribution", "Liquidity mining", "LP token minting", "Position tracking"],
  },
  beforeRemoveLiquidity: {
    name: "beforeRemoveLiquidity",
    label: "Before Remove Liquidity",
    timing: "before",
    category: "liquidity",
    risk: "high",
    description: "Executed before liquidity is withdrawn. Can prevent withdrawals — potentially a dangerous locking mechanism if abused.",
    useCases: ["Lock period enforcement", "Vesting schedule", "Emergency pause", "Harvest-before-withdraw"],
    warning: "⚠️ HIGH RISK: If this hook has a bug or permanent condition, liquidity could be locked forever.",
  },
  afterRemoveLiquidity: {
    name: "afterRemoveLiquidity",
    label: "After Remove Liquidity",
    timing: "after",
    category: "liquidity",
    risk: "low",
    description: "Executed after liquidity is successfully withdrawn. Used for auto-compounding yield or state cleanup.",
    useCases: ["Auto-compound yield", "Reward claiming on exit", "Position cleanup", "Fee collection"],
  },
  beforeSwap: {
    name: "beforeSwap",
    label: "Before Swap",
    timing: "before",
    category: "swap",
    risk: "medium",
    description: "Executed before every swap. The most common callback — used for dynamic fees, MEV protection, or pre-swap logic. This hook sees every swap.",
    useCases: ["Dynamic fee based on volatility", "MEV protection / sandwich prevention", "TWAP oracle update", "Pre-swap validation"],
  },
  afterSwap: {
    name: "afterSwap",
    label: "After Swap",
    timing: "after",
    category: "swap",
    risk: "medium",
    description: "Executed after every swap completes. Gets access to the swap's BalanceDelta — useful for analytics, fee collection, or triggering actions.",
    useCases: ["On-chain analytics", "Fee redistribution", "Auto-rebalancing", "Limit order execution"],
  },
  beforeDonate: {
    name: "beforeDonate",
    label: "Before Donate",
    timing: "before",
    category: "donate",
    risk: "low",
    description: "Executed before a donation (fee injection) to the pool. Rarely used — only relevant for custom fee injection mechanisms.",
    useCases: ["Custom fee injection logic", "Donation validation", "Protocol fee routing"],
  },
  afterDonate: {
    name: "afterDonate",
    label: "After Donate",
    timing: "after",
    category: "donate",
    risk: "low",
    description: "Executed after a donation to the pool. Can be used for tracking or distributing donated fees.",
    useCases: ["Fee tracking", "Reward distribution from donations"],
  },
  beforeSwapReturnsDelta: {
    name: "beforeSwapReturnsDelta",
    label: "Before Swap Δ (Custom Accounting)",
    timing: "before",
    category: "delta",
    risk: "high",
    description: "Advanced version of beforeSwap that can return a BeforeSwapDelta — allows the hook to take or contribute tokens to/from the swap in a custom way. The most powerful and most risky mechanism.",
    useCases: ["Custom AMM curve (replacing x*y=k)", "Hook-level liquidity", "Fee-on-transfer token handling", "Custom concentrated liquidity"],
    warning: "⚠️ VERY HIGH RISK: The hook can custom-modify the token amounts received/sent in a swap. Audit required.",
  },
  afterSwapReturnsDelta: {
    name: "afterSwapReturnsDelta",
    label: "After Swap Δ (Custom Accounting)",
    timing: "after",
    category: "delta",
    risk: "high",
    description: "Advanced version of afterSwap that can return an int128 delta — allows the hook to take a portion of fees or tokens after the swap.",
    useCases: ["Protocol fee extraction", "Fee splitting between hook and pool", "Custom fee rebate", "MEV capture"],
    warning: "⚠️ HIGH RISK: The hook can take tokens from every swap. Ensure the fee formula is transparent.",
  },
  afterAddLiquidityReturnsDelta: {
    name: "afterAddLiquidityReturnsDelta",
    label: "After Add Liquidity Δ",
    timing: "after",
    category: "delta",
    risk: "medium",
    description: "Allows the hook to modify the LP's balance when adding liquidity — can grant bonus tokens or take a fee on deposit.",
    useCases: ["LP bonus token distribution", "Deposit fee", "Custom LP accounting"],
  },
  afterRemoveLiquidityReturnsDelta: {
    name: "afterRemoveLiquidityReturnsDelta",
    label: "After Remove Liquidity Δ",
    timing: "after",
    category: "delta",
    risk: "high",
    description: "Allows the hook to modify the LP's balance when withdrawing liquidity — can potentially take a portion of tokens on withdrawal.",
    useCases: ["Withdrawal fee", "Yield distribution on exit", "Penalty mechanism"],
    warning: "⚠️ HIGH RISK: The hook can reduce the number of tokens received on withdrawal.",
  },
};

export function getRiskColor(risk: CallbackDoc["risk"]): string {
  return risk === "high"   ? "text-orange-400 bg-orange-500/10 border-orange-500/20" :
         risk === "medium" ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/20" :
                             "text-green-400  bg-green-500/10  border-green-500/20";
}

export function getCategoryColor(cat: CallbackDoc["category"]): string {
  return cat === "delta"     ? "text-purple-400 bg-purple-500/10 border-purple-500/20" :
         cat === "swap"      ? "text-blue-400   bg-blue-500/10   border-blue-500/20"   :
         cat === "liquidity" ? "text-cyan-400   bg-cyan-500/10   border-cyan-500/20"   :
         cat === "donate"    ? "text-pink-400   bg-pink-500/10   border-pink-500/20"   :
                               "text-gray-400   bg-gray-500/10   border-gray-500/20";
}
