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
  beforeInitialize:              "Dapat mengkustomisasi parameter pool saat inisialisasi (fee awal, tick spacing, dll.)",
  afterInitialize:               "Memungkinkan oracle atau state tambahan diinisialisasi tepat setelah pool dibuat",
  beforeAddLiquidity:            "Dapat memvalidasi dan membatasi posisi LP (misal: whitelist atau range khusus)",
  afterAddLiquidity:             "Mengaktifkan strategi yield otomatis atau hedging saat LP menambahkan likuiditas",
  beforeRemoveLiquidity:         "Melindungi LP dari eksploitasi — dapat memblokir penarikan mendadak oleh aktor jahat",
  afterRemoveLiquidity:          "Mendistribusikan reward otomatis saat LP keluar dari posisi",
  beforeSwap:                    "Mengizinkan dynamic fee, MEV protection, dan validasi harga sebelum swap terjadi",
  afterSwap:                     "Memungkinkan on-chain analytics, rebalancing otomatis, dan fee redistribution",
  beforeDonate:                  "Dapat mengontrol siapa yang boleh mengirim donation ke pool",
  afterDonate:                   "Mendistribusikan donasi secara otomatis ke LP atau protokol",
  beforeSwapReturnsDelta:        "Implementasi custom AMM curve — kontrol penuh atas harga dan jumlah token swap",
  afterSwapReturnsDelta:         "Dapat mengalihkan sebagian output swap untuk keperluan protokol",
  afterAddLiquidityReturnsDelta: "Custom LP token minting — memungkinkan receipt token unik per pool",
  afterRemoveLiquidityReturnsDelta: "Custom withdrawal logic — LP menerima token dalam komposisi berbeda",
};

const CB_CONS: Record<string, string> = {
  beforeInitialize:              "Dapat mencegah pembuatan pool — sentralisasi kontrol pool creation",
  afterInitialize:               "Menambah gas cost saat pool pertama kali dibuat",
  beforeAddLiquidity:            "Dapat memblokir deposit LP secara sepihak — risiko sentralisasi",
  afterAddLiquidity:             "Gas overhead pada setiap penambahan likuiditas",
  beforeRemoveLiquidity:         "Dapat mengunci dana LP indefinitely — risiko kritikal jika owner jahat",
  afterRemoveLiquidity:          "Gas overhead tambahan setiap penarikan likuiditas",
  beforeSwap:                    "Dapat memblokir atau merevert swap — kepercayaan penuh pada hook owner diperlukan",
  afterSwap:                     "Gas overhead pada setiap swap — potensi MEV extraction",
  beforeDonate:                  "Dapat memblokir donation ke pool",
  afterDonate:                   "Menambah kompleksitas aliran fee",
  beforeSwapReturnsDelta:        "Dapat mengekstrak nilai dari swapper — SANGAT TINGGI tingkat kepercayaan yang dibutuhkan",
  afterSwapReturnsDelta:         "Dapat mengubah jumlah akhir swap — potensi front-running oleh hook",
  afterAddLiquidityReturnsDelta: "Dapat mengubah jumlah LP token yang diterima — risiko kritikal",
  afterRemoveLiquidityReturnsDelta: "Dapat mengubah jumlah token yang ditarik — risiko kritikal",
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

const ARCHETYPES: Array<{ test: (a: string[]) => boolean; data: Archetype }> = [
  {
    test: (a) => a.length === 0,
    data: {
      id: "noop", name: "No-Op Hook", icon: "⬜", color: "#6b7280",
      summary: (m) =>
        `Hook ini tidak mengimplementasikan callback apapun — berfungsi sebagai placeholder atau wrapper kosong. ` +
        `Pool yang menggunakannya berperilaku identik dengan pool standar Uniswap v4 tanpa modifikasi apapun. ` +
        (m.poolCount > 0 ? `Meski demikian, ${m.poolCount} pool tercatat menggunakan address ini sebagai hook.` : ""),
    },
  },
  {
    test: (a) => a.filter((c) => c.includes("ReturnsDelta")).length >= 3,
    data: {
      id: "custom_amm", name: "Custom AMM Protocol", icon: "⚡", color: "#f97316",
      summary: (m, a) =>
        `Hook ini mengimplementasikan custom AMM curve melalui Delta Returns callbacks — mekanisme Uniswap v4 yang memungkinkan kontrol penuh atas aliran token. ` +
        `Dengan ${a.length}/14 callback aktif, ini adalah hook yang sangat powerful dan kompleks. ` +
        `${m.poolCount > 0 ? `Saat ini melayani ${m.poolCount} pool` : "Belum ada pool aktif"}` +
        `${m.tvlUsd && m.tvlUsd > 1000 ? ` dengan total TVL sekitar $${(m.tvlUsd / 1e6).toFixed(2)}M.` : "."}`,
    },
  },
  {
    test: (a) => anyCb(a, "beforeSwap", "afterSwap") && anyCb(a, "beforeAddLiquidity", "afterAddLiquidity", "beforeRemoveLiquidity", "afterRemoveLiquidity"),
    data: {
      id: "defi_protocol", name: "Full DeFi Protocol Hook", icon: "🏦", color: "#8b5cf6",
      summary: (m, a) =>
        `Hook ini adalah protokol DeFi lengkap yang mengontrol baik operasi swap maupun manajemen likuiditas. ` +
        `Dengan ${a.length}/14 callback aktif, hook ini berperan sebagai lapisan protokol di atas Uniswap v4 — ` +
        `kemungkinan besar sebuah lending protocol, yield optimizer, atau concentrated liquidity manager. ` +
        `${m.poolCount > 0 ? `Digunakan oleh ${m.poolCount} pool aktif.` : ""}`,
    },
  },
  {
    test: (a) => anyCb(a, "beforeSwap", "afterSwap") && !anyCb(a, "beforeAddLiquidity", "afterAddLiquidity", "beforeRemoveLiquidity", "afterRemoveLiquidity"),
    data: {
      id: "swap_hook", name: "Swap Control Hook", icon: "🔄", color: "#3b82f6",
      summary: (m, a) =>
        `Hook ini berfokus pada kontrol dan optimasi swap tanpa menyentuh manajemen likuiditas. ` +
        `Umumnya digunakan untuk dynamic fee (biaya berubah sesuai volatilitas), MEV protection, ` +
        `TWAP oracle, atau limit order. ` +
        `${m.poolCount > 0 ? `Aktif di ${m.poolCount} pool` : "Belum ada pool aktif"}` +
        `${m.tvlUsd && m.tvlUsd > 0 ? ` — TVL $${formatUsdShort(m.tvlUsd)}.` : "."}`,
    },
  },
  {
    test: (a) => anyCb(a, "beforeAddLiquidity", "afterAddLiquidity", "beforeRemoveLiquidity", "afterRemoveLiquidity") && !anyCb(a, "beforeSwap", "afterSwap"),
    data: {
      id: "lp_manager", name: "LP Manager Hook", icon: "💧", color: "#06b6d4",
      summary: (m, a) =>
        `Hook ini mengontrol manajemen posisi liquidity provider tanpa menyentuh swap itu sendiri. ` +
        `Biasanya digunakan untuk concentrated liquidity automation, LP position guards, ` +
        `atau distribusi reward ke LP. ` +
        `${m.poolCount > 0 ? `Digunakan oleh ${m.poolCount} pool dengan ${m.isVerified ? "source code terverifikasi" : "source code belum diverifikasi"}.` : ""}`,
    },
  },
  {
    test: (a) => anyCb(a, "beforeInitialize", "afterInitialize") && a.length <= 2,
    data: {
      id: "initializer", name: "Pool Initializer Hook", icon: "🔧", color: "#64748b",
      summary: (m) =>
        `Hook ini hanya aktif saat pool pertama kali dibuat — mengkustomisasi parameter inisialisasi pool. ` +
        `Setelah pool dibuat, hook tidak lagi berintervensi dalam operasi normal (swap/liquidity). ` +
        `${m.poolCount > 0 ? `${m.poolCount} pool dibuat menggunakan hook ini.` : ""}`,
    },
  },
  {
    test: (a) => anyCb(a, "beforeDonate", "afterDonate") && a.length <= 3,
    data: {
      id: "fee_distributor", name: "Fee Distributor Hook", icon: "💰", color: "#eab308",
      summary: (m) =>
        `Hook ini mengontrol aliran donasi dan distribusi fee di dalam pool. ` +
        `Biasanya bagian dari protokol yang mendistribusikan pendapatan pool ke staker atau treasury. ` +
        `${m.poolCount > 0 ? `${m.poolCount} pool terdaftar.` : ""}`,
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
  const found = ARCHETYPES.find((a) => a.test(active));
  const arch = found?.data ?? {
    id: "misc", name: "Multi-Purpose Hook", icon: "🪝", color: "#94a3b8",
    summary: (m: HookMeta, a: string[]) =>
      `Hook ini mengimplementasikan kombinasi unik dari ${a.length} callback yang tidak cocok dengan pola standar. ` +
      `Kemungkinan merupakan hook eksperimental atau protokol custom. ` +
      `${m.poolCount > 0 ? `${m.poolCount} pool aktif menggunakan hook ini.` : ""}`,
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
  if (meta.isVerified) pros.push("Source code terverifikasi di Etherscan — transparan dan dapat diaudit publik");
  if (meta.auditStatus === "AUDITED") pros.push("Telah melalui security audit oleh pihak ketiga");
  if (meta.proxyType === "NONE") pros.push("Non-upgradeable — logik tidak dapat diubah oleh siapapun setelah deploy");
  if (meta.poolCount >= 10) pros.push(`Teruji oleh ${meta.poolCount} pool aktif — memiliki track record nyata`);
  if (meta.hookScore != null && meta.hookScore >= 80) pros.push(`HookScore tinggi (${meta.hookScore}/100) — melewati semua pemeriksaan keamanan otomatis`);

  // Build cons list
  const cons: string[] = [];
  for (const cb of activePriority.slice(0, 4)) {
    if (CB_CONS[cb]) cons.push(CB_CONS[cb]);
  }

  // Structural cons
  if (!meta.isVerified) cons.push("Source code belum diverifikasi — tidak dapat diaudit secara publik");
  if (meta.proxyType !== "NONE") cons.push(`Proxy ${meta.proxyType} — logik dapat diupgrade oleh owner kapan saja tanpa notifikasi`);
  if (active.length > 8) cons.push(`${active.length}/14 callback aktif — attack surface yang besar, gas cost lebih tinggi`);
  if (meta.auditStatus === "FLAGGED") cons.push("Hook ini ditandai sebagai mencurigakan dalam sistem audit");
  if (meta.hookScore != null && meta.hookScore < 50) cons.push(`HookScore rendah (${meta.hookScore}/100) — terdeteksi beberapa sinyal keamanan negatif`);

  // Risk summary
  const RISK_TEXT: Record<string, string> = {
    LOW: "Profil risiko RENDAH. Hook ini aman untuk diinteraksikan berdasarkan analisis callback dan metadata.",
    MEDIUM: "Profil risiko SEDANG. Beberapa callback memiliki potensi dampak pada aliran dana — lakukan review source code jika tersedia.",
    HIGH: "Profil risiko TINGGI. Callback aktif dapat mempengaruhi jumlah token yang diterima. Verifikasi independen sangat disarankan.",
    CRITICAL: "⚠ Profil risiko KRITIKAL. Hook ini memiliki kemampuan untuk mengontrol aliran token secara penuh. Jangan berinteraksi tanpa audit menyeluruh.",
    UNKNOWN: "Risiko belum dianalisis — jalankan batch-analyze untuk mendapatkan penilaian.",
  };

  const usageNotes: string[] = [];
  if (meta.proxyType !== "NONE") usageNotes.push("monitor upgrade events di explorer");
  if (!meta.isVerified) usageNotes.push("minta deployer untuk verify source code");
  if (active.some((c) => c.includes("ReturnsDelta"))) usageNotes.push("audit custom accounting logic sebelum deposit besar");
  if (meta.auditStatus !== "AUDITED") usageNotes.push("pertimbangkan menunggu audit selesai");

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
      : "Hook ini dapat digunakan dengan tingkat kepercayaan sesuai risk level di atas.",
  };
}
