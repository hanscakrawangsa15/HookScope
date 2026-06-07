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
    description: "Dieksekusi sebelum pool dibuat. Memungkinkan hook untuk memvalidasi atau menolak pembuatan pool, atau menginisialisasi state internal hook.",
    useCases: ["Custom pricing curve setup", "Whitelist pool creator", "Custom oracle initialization", "Parameter validation"],
  },
  afterInitialize: {
    name: "afterInitialize",
    label: "After Initialize",
    timing: "after",
    category: "init",
    risk: "low",
    description: "Dieksekusi setelah pool berhasil dibuat. Cocok untuk inisialisasi oracle, state tracking, atau registrasi ke sistem eksternal.",
    useCases: ["Oracle initialization", "Pool registry", "Initial liquidity snapshot", "Event emission"],
  },
  beforeAddLiquidity: {
    name: "beforeAddLiquidity",
    label: "Before Add Liquidity",
    timing: "before",
    category: "liquidity",
    risk: "medium",
    description: "Dieksekusi sebelum likuiditas ditambahkan. Dapat memblokir atau memodifikasi penambahan likuiditas — sering digunakan untuk access control.",
    useCases: ["KYC/whitelist check", "Minimum deposit enforcement", "Custom fee tiers", "Epoch-based liquidity"],
    warning: "Dapat memblokir pengguna dari menambah likuiditas jika kondisi tidak terpenuhi.",
  },
  afterAddLiquidity: {
    name: "afterAddLiquidity",
    label: "After Add Liquidity",
    timing: "after",
    category: "liquidity",
    risk: "low",
    description: "Dieksekusi setelah likuiditas berhasil ditambahkan. Umum digunakan untuk distribusi reward kepada liquidity provider.",
    useCases: ["Reward distribution", "Liquidity mining", "LP token minting", "Position tracking"],
  },
  beforeRemoveLiquidity: {
    name: "beforeRemoveLiquidity",
    label: "Before Remove Liquidity",
    timing: "before",
    category: "liquidity",
    risk: "high",
    description: "Dieksekusi sebelum likuiditas ditarik. Dapat mencegah withdrawal — berpotensi menjadi mekanisme lock yang berbahaya jika disalahgunakan.",
    useCases: ["Lock period enforcement", "Vesting schedule", "Emergency pause", "Harvest-before-withdraw"],
    warning: "⚠️ HIGH RISK: Jika hook ini memiliki bug atau kondisi permanen, likuiditas bisa terkunci selamanya.",
  },
  afterRemoveLiquidity: {
    name: "afterRemoveLiquidity",
    label: "After Remove Liquidity",
    timing: "after",
    category: "liquidity",
    risk: "low",
    description: "Dieksekusi setelah likuiditas berhasil ditarik. Digunakan untuk auto-compound yield atau pembersihan state.",
    useCases: ["Auto-compound yield", "Reward claiming on exit", "Position cleanup", "Fee collection"],
  },
  beforeSwap: {
    name: "beforeSwap",
    label: "Before Swap",
    timing: "before",
    category: "swap",
    risk: "medium",
    description: "Dieksekusi sebelum setiap swap. Callback paling umum — digunakan untuk dynamic fee, MEV protection, atau pre-swap logic. Hook ini melihat semua swap.",
    useCases: ["Dynamic fee berdasarkan volatilitas", "MEV protection / sandwich prevention", "TWAP oracle update", "Pre-swap validation"],
  },
  afterSwap: {
    name: "afterSwap",
    label: "After Swap",
    timing: "after",
    category: "swap",
    risk: "medium",
    description: "Dieksekusi setelah setiap swap selesai. Mendapat akses ke BalanceDelta hasil swap — berguna untuk analytics, fee collection, atau trigger action.",
    useCases: ["On-chain analytics", "Fee redistribution", "Auto-rebalancing", "Limit order execution"],
  },
  beforeDonate: {
    name: "beforeDonate",
    label: "Before Donate",
    timing: "before",
    category: "donate",
    risk: "low",
    description: "Dieksekusi sebelum donasi (fee injection) ke pool. Jarang digunakan — hanya relevan untuk mekanisme fee injection khusus.",
    useCases: ["Custom fee injection logic", "Donation validation", "Protocol fee routing"],
  },
  afterDonate: {
    name: "afterDonate",
    label: "After Donate",
    timing: "after",
    category: "donate",
    risk: "low",
    description: "Dieksekusi setelah donasi ke pool. Dapat digunakan untuk tracking atau distribusi fee yang didonasikan.",
    useCases: ["Fee tracking", "Reward distribution from donations"],
  },
  beforeSwapReturnsDelta: {
    name: "beforeSwapReturnsDelta",
    label: "Before Swap Δ (Custom Accounting)",
    timing: "before",
    category: "delta",
    risk: "high",
    description: "Versi lanjutan beforeSwap yang dapat mengembalikan BeforeSwapDelta — memungkinkan hook untuk mengambil atau menyumbangkan token ke/dari swap secara custom. Mekanisme paling powerful dan paling berisiko.",
    useCases: ["Custom AMM curve (menggantikan x*y=k)", "Hook-level liquidity", "Fee-on-transfer token handling", "Concentrated liquidity custom"],
    warning: "⚠️ VERY HIGH RISK: Hook dapat secara custom mengubah jumlah token yang diterima/dikirim dalam swap. Wajib audit.",
  },
  afterSwapReturnsDelta: {
    name: "afterSwapReturnsDelta",
    label: "After Swap Δ (Custom Accounting)",
    timing: "after",
    category: "delta",
    risk: "high",
    description: "Versi lanjutan afterSwap yang dapat mengembalikan int128 delta — memungkinkan hook untuk mengambil sebagian fee atau token setelah swap.",
    useCases: ["Protocol fee extraction", "Fee splitting between hook and pool", "Custom fee rebate", "MEV capture"],
    warning: "⚠️ HIGH RISK: Hook dapat mengambil token dari setiap swap. Pastikan formula fee transparan.",
  },
  afterAddLiquidityReturnsDelta: {
    name: "afterAddLiquidityReturnsDelta",
    label: "After Add Liquidity Δ",
    timing: "after",
    category: "delta",
    risk: "medium",
    description: "Memungkinkan hook untuk mengubah balance LP saat menambah likuiditas — dapat memberikan token tambahan atau mengambil fee saat deposit.",
    useCases: ["LP bonus token distribution", "Deposit fee", "Custom LP accounting"],
  },
  afterRemoveLiquidityReturnsDelta: {
    name: "afterRemoveLiquidityReturnsDelta",
    label: "After Remove Liquidity Δ",
    timing: "after",
    category: "delta",
    risk: "high",
    description: "Memungkinkan hook untuk mengubah balance LP saat menarik likuiditas — berpotensi mengambil sebagian token saat withdrawal.",
    useCases: ["Withdrawal fee", "Yield distribution on exit", "Penalty mechanism"],
    warning: "⚠️ HIGH RISK: Hook dapat mengurangi jumlah token yang diterima saat withdraw.",
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
