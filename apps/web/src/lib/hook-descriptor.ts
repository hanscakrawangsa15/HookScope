/**
 * Generates a rich description (archetype, summary, pros, cons)
 * for any Uniswap v4 hook purely from its on-chain metadata.
 * No LLM or external API required — everything is derived from
 * the callback bitmask, proxy type, audit status, and pool stats.
 */

export interface HookDescription {
  archetype: string;
  archetypeId: string;
  archetypeColor: string;
  icon: string;
  summary: string;
  riskSummary: string;
  pros: string[];
  cons: string[];
  usageNote: string;
}

interface HookMeta {
  callbacks: Record<string, boolean>;
  riskLevel: string;
  hookScore: number | null;
  proxyType: string;
  isVerified: boolean;
  auditStatus: string;
  poolCount: number;
  tvlUsd: number | null;
  chainId: number;
  name: string | null;
}

// ── Per-callback benefit/risk text ─────────────────────────────────────────

const CB_PROS: Record<string, string> = {
  beforeInitialize:              "Can customize pool parameters at initialization (initial fee, tick spacing, etc.)",
  afterInitialize:               "Enables oracle or additional state to be initialized right after pool creation",
  beforeAddLiquidity:            "Can validate and restrict LP positions (e.g., whitelist or custom range)",
  afterAddLiquidity:             "Enables automatic yield strategies or hedging when LPs add liquidity",
  beforeRemoveLiquidity:         "Protects LPs from exploitation — can block sudden withdrawals by malicious actors",
  afterRemoveLiquidity:          "Automatically distributes rewards when LPs exit their position",
  beforeSwap:                    "Allows dynamic fees, MEV protection, and price validation before swaps",
  afterSwap:                     "Enables on-chain analytics, automatic rebalancing, and fee redistribution",
  beforeDonate:                  "Can control who is allowed to send donations to the pool",
  afterDonate:                   "Automatically distributes donations to LPs or the protocol",
  beforeSwapReturnsDelta:        "Custom AMM curve implementation — full control over price and swap token amounts",
  afterSwapReturnsDelta:         "Can redirect a portion of swap output for protocol purposes",
  afterAddLiquidityReturnsDelta: "Custom LP token minting — enables unique receipt tokens per pool",
  afterRemoveLiquidityReturnsDelta: "Custom withdrawal logic — LPs receive tokens in a different composition",
};

const CB_CONS: Record<string, string> = {
  beforeInitialize:              "Can prevent pool creation — centralizes control over pool creation",
  afterInitialize:               "Adds gas cost when the pool is first created",
  beforeAddLiquidity:            "Can unilaterally block LP deposits — centralization risk",
  afterAddLiquidity:             "Gas overhead on every liquidity addition",
  beforeRemoveLiquidity:         "Can lock LP funds indefinitely — critical risk if the owner is malicious",
  afterRemoveLiquidity:          "Additional gas overhead on every liquidity withdrawal",
  beforeSwap:                    "Can block or revert swaps — requires full trust in the hook owner",
  afterSwap:                     "Gas overhead on every swap — potential MEV extraction",
  beforeDonate:                  "Can block donations to the pool",
  afterDonate:                   "Adds complexity to the fee flow",
  beforeSwapReturnsDelta:        "Can extract value from swappers — VERY HIGH trust level required",
  afterSwapReturnsDelta:         "Can modify the final swap amount — potential front-running by the hook",
  afterAddLiquidityReturnsDelta: "Can alter the LP tokens received — critical risk",
  afterRemoveLiquidityReturnsDelta: "Can alter the tokens withdrawn — critical risk",
};

// ── Archetype detection ─────────────────────────────────────────────────────

interface Archetype {
  id: string;
  name: string;
  icon: string;
  color: string;
  summary: (meta: HookMeta, active: string[]) => string;
}

function hasCb(active: string[], ...names: string[]): boolean {
  return names.every((n) => active.includes(n));
}
function anyCb(active: string[], ...names: string[]): boolean {
  return names.some((n) => active.includes(n));
}

const SOLANA_CHAIN_ID = 1399811149;

const ARCHETYPES: Array<{ test: (a: string[], m: HookMeta) => boolean; data: Archetype }> = [
  // ── Solana programs ── must be first so they short-circuit EVM archetypes
  {
    test: (_a, m) => m.chainId === SOLANA_CHAIN_ID,
    data: {
      id: "solana_program", name: "Solana DEX Program", icon: "◎", color: "#9945FF",
      summary: (m, a) =>
        `An on-chain Solana AMM program implementing swap logic, liquidity position management, ` +
        `and full fee collection. ` +
        (m.name ? `${m.name} is one of the largest DEXs in the Solana ecosystem. ` : "") +
        (m.poolCount > 0
          ? `Serving more than ${m.poolCount.toLocaleString()} active pools`
          : "Pools are being indexed") +
        (m.tvlUsd && m.tvlUsd > 1000
          ? ` with total TVL of ${formatUsdShort(m.tvlUsd)}.`
          : "."),
    },
  },
  {
    test: (a) => a.length === 0,
    data: {
      id: "noop", name: "No-Op Hook", icon: "⬜", color: "#6b7280",
      summary: (m) =>
        `This hook implements no callbacks — it functions as a placeholder or empty wrapper. ` +
        `Pools using it behave identically to a standard Uniswap v4 pool with no modifications. ` +
        (m.poolCount > 0 ? `Nevertheless, ${m.poolCount} pools are recorded using this address as a hook.` : ""),
    },
  },
  {
    test: (a) => a.filter((c) => c.includes("ReturnsDelta")).length >= 3,
    data: {
      id: "custom_amm", name: "Custom AMM Protocol", icon: "⚡", color: "#f97316",
      summary: (m, a) =>
        `This hook implements a custom AMM curve via Delta Returns callbacks — the Uniswap v4 mechanism enabling full control over token flows. ` +
        `With ${a.length}/14 callbacks active, this is a highly powerful and complex hook. ` +
        `${m.poolCount > 0 ? `Currently serving ${m.poolCount} pools` : "No active pools yet"}` +
        `${m.tvlUsd && m.tvlUsd > 1000 ? ` with approximately $${(m.tvlUsd / 1e6).toFixed(2)}M TVL.` : "."}`,
    },
  },
  {
    test: (a) => anyCb(a, "beforeSwap", "afterSwap") && anyCb(a, "beforeAddLiquidity", "afterAddLiquidity", "beforeRemoveLiquidity", "afterRemoveLiquidity"),
    data: {
      id: "defi_protocol", name: "Full DeFi Protocol Hook", icon: "🏦", color: "#8b5cf6",
      summary: (m, a) =>
        `This hook is a full DeFi protocol controlling both swap operations and liquidity management. ` +
        `With ${a.length}/14 callbacks active, it acts as a protocol layer on top of Uniswap v4 — ` +
        `most likely a lending protocol, yield optimizer, or concentrated liquidity manager. ` +
        `${m.poolCount > 0 ? `Used by ${m.poolCount} active pools.` : ""}`,
    },
  },
  {
    test: (a) => anyCb(a, "beforeSwap", "afterSwap") && !anyCb(a, "beforeAddLiquidity", "afterAddLiquidity", "beforeRemoveLiquidity", "afterRemoveLiquidity"),
    data: {
      id: "swap_hook", name: "Swap Control Hook", icon: "🔄", color: "#3b82f6",
      summary: (m, a) =>
        `This hook focuses on controlling and optimizing swaps without touching liquidity management. ` +
        `Commonly used for dynamic fees (fees that change with volatility), MEV protection, ` +
        `TWAP oracles, or limit orders. ` +
        `${m.poolCount > 0 ? `Active across ${m.poolCount} pools` : "No active pools yet"}` +
        `${m.tvlUsd && m.tvlUsd > 0 ? ` — TVL ${formatUsdShort(m.tvlUsd)}.` : "."}`,
    },
  },
  {
    test: (a) => anyCb(a, "beforeAddLiquidity", "afterAddLiquidity", "beforeRemoveLiquidity", "afterRemoveLiquidity") && !anyCb(a, "beforeSwap", "afterSwap"),
    data: {
      id: "lp_manager", name: "LP Manager Hook", icon: "💧", color: "#06b6d4",
      summary: (m, a) =>
        `This hook controls liquidity provider position management without touching swaps themselves. ` +
        `Typically used for concentrated liquidity automation, LP position guards, ` +
        `or reward distribution to LPs. ` +
        `${m.poolCount > 0 ? `Used by ${m.poolCount} pools with ${m.isVerified ? "verified source code" : "unverified source code"}.` : ""}`,
    },
  },
  {
    test: (a) => anyCb(a, "beforeInitialize", "afterInitialize") && a.length <= 2,
    data: {
      id: "initializer", name: "Pool Initializer Hook", icon: "🔧", color: "#64748b",
      summary: (m) =>
        `This hook is only active when the pool is first created — customizing pool initialization parameters. ` +
        `After the pool is created, the hook no longer intervenes in normal operations (swap/liquidity). ` +
        `${m.poolCount > 0 ? `${m.poolCount} pools were created using this hook.` : ""}`,
    },
  },
  {
    test: (a) => anyCb(a, "beforeDonate", "afterDonate") && a.length <= 3,
    data: {
      id: "fee_distributor", name: "Fee Distributor Hook", icon: "💰", color: "#eab308",
      summary: (m) =>
        `This hook controls donation flows and fee distribution within the pool. ` +
        `Usually part of a protocol that distributes pool revenue to stakers or a treasury. ` +
        `${m.poolCount > 0 ? `${m.poolCount} pools registered.` : ""}`,
    },
  },
];

function formatUsdShort(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

// ── Main export ─────────────────────────────────────────────────────────────

export function describeHook(meta: HookMeta): HookDescription {
  const active = Object.entries(meta.callbacks)
    .filter(([, v]) => v)
    .map(([k]) => k);

  // Find archetype
  const found = ARCHETYPES.find((a) => a.test(active, meta));
  const arch = found?.data ?? {
    id: "misc", name: "Multi-Purpose Hook", icon: "🪝", color: "#94a3b8",
    summary: (m: HookMeta, a: string[]) =>
      `This hook implements a unique combination of ${a.length} callbacks that does not match a standard archetype. ` +
      `Likely an experimental hook or custom protocol. ` +
      `${m.poolCount > 0 ? `${m.poolCount} active pools use this hook.` : ""}`,
  };

  // Build pros list — from active callbacks, select top 4 most relevant
  const pros: string[] = [];
  const activePriority = [
    "beforeSwap", "afterSwap",
    "beforeSwapReturnsDelta", "afterSwapReturnsDelta",
    "beforeAddLiquidity", "afterAddLiquidity",
    "beforeRemoveLiquidity", "afterRemoveLiquidity",
    "afterAddLiquidityReturnsDelta", "afterRemoveLiquidityReturnsDelta",
    "beforeInitialize", "afterInitialize",
    "beforeDonate", "afterDonate",
  ].filter((c) => active.includes(c));

  for (const cb of activePriority.slice(0, 4)) {
    if (CB_PROS[cb]) pros.push(CB_PROS[cb]);
  }

  // Structural pros
  if (meta.isVerified) pros.push(
    meta.chainId === SOLANA_CHAIN_ID
      ? "Program has been audited by a trusted third party — transparent and safe to use"
      : "Source code verified on Etherscan — transparent and publicly auditable"
  );
  if (meta.auditStatus === "AUDITED") pros.push("Has undergone a security audit by a third party");
  if (meta.proxyType === "NONE") pros.push("Non-upgradeable — logic cannot be changed by anyone after deployment");
  if (meta.poolCount >= 10) pros.push(`Battle-tested by ${meta.poolCount} active pools — has a real track record`);
  if (meta.hookScore != null && meta.hookScore >= 80) pros.push(`High HookScore (${meta.hookScore}/100) — passed all automated security checks`);

  // Build cons list
  const cons: string[] = [];
  for (const cb of activePriority.slice(0, 4)) {
    if (CB_CONS[cb]) cons.push(CB_CONS[cb]);
  }

  // Structural cons
  if (!meta.isVerified) cons.push("Source code not verified — cannot be publicly audited");
  if (meta.proxyType !== "NONE") cons.push(`${meta.proxyType} proxy — logic can be upgraded by the owner at any time without notice`);
  if (active.length > 8) cons.push(`${active.length}/14 callbacks active — large attack surface, higher gas cost`);
  if (meta.auditStatus === "FLAGGED") cons.push("This hook has been flagged as suspicious by the audit system");
  if (meta.hookScore != null && meta.hookScore < 50) cons.push(`Low HookScore (${meta.hookScore}/100) — several negative security signals detected`);

  // Risk summary
  const RISK_TEXT: Record<string, string> = {
    LOW: "LOW risk profile. This hook is safe to interact with based on callback analysis and metadata.",
    MEDIUM: "MEDIUM risk profile. Some callbacks have potential impact on fund flows — review the source code if available.",
    HIGH: "HIGH risk profile. Active callbacks can affect the token amounts received. Independent verification is strongly recommended.",
    CRITICAL: "⚠ CRITICAL risk profile. This hook has the ability to fully control token flows. Do not interact without a thorough audit.",
    UNKNOWN: "Risk not yet analyzed — run batch-analyze to get an assessment.",
  };

  const usageNotes: string[] = [];
  if (meta.proxyType !== "NONE") usageNotes.push("monitor upgrade events on the explorer");
  if (!meta.isVerified) usageNotes.push("ask the deployer to verify the source code");
  if (active.some((c) => c.includes("ReturnsDelta"))) usageNotes.push("audit custom accounting logic before large deposits");
  if (meta.auditStatus !== "AUDITED") usageNotes.push("consider waiting for an audit to be completed");

  return {
    archetype:       arch.name,
    archetypeId:     arch.id,
    archetypeColor:  arch.color,
    icon:            arch.icon,
    summary:         arch.summary(meta, active),
    riskSummary:     RISK_TEXT[meta.riskLevel] ?? RISK_TEXT.UNKNOWN,
    pros:            pros.slice(0, 5),
    cons:            cons.slice(0, 5),
    usageNote:       usageNotes.length > 0
      ? `Tips: ${usageNotes.join(", ")}.`
      : "This hook can be used with the level of trust appropriate to the risk level above.",
  };
}
