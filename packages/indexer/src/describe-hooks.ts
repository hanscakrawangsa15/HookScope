/**
 * Hook Description Generator
 *
 * Generates a unique, objective description for every hook based on:
 *   - The exact set of active callbacks (not just category)
 *   - HookScore & risk profile
 *   - Verified source / proxy status
 *   - Real on-chain activity (pools, TVL, swaps)
 *
 * Every hook gets a different description because the combination of these
 * factors is unique per address.
 *
 * Run: pnpm --filter @hookscope/indexer describe-hooks
 * Options:
 *   --overwrite    overwrite hooks that already have a description
 *   --limit 500    max hooks to process
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

import { PrismaClient } from "@prisma/client";

// ─── Callback metadata ────────────────────────────────────────────────────────

const CB_LABEL: Record<string, string> = {
  beforeInitialize:                 "beforeInitialize",
  afterInitialize:                  "afterInitialize",
  beforeAddLiquidity:               "beforeAddLiquidity",
  afterAddLiquidity:                "afterAddLiquidity",
  beforeRemoveLiquidity:            "beforeRemoveLiquidity",
  afterRemoveLiquidity:             "afterRemoveLiquidity",
  beforeSwap:                       "beforeSwap",
  afterSwap:                        "afterSwap",
  beforeDonate:                     "beforeDonate",
  afterDonate:                      "afterDonate",
  beforeSwapReturnsDelta:           "beforeSwapReturnsDelta",
  afterSwapReturnsDelta:            "afterSwapReturnsDelta",
  afterAddLiquidityReturnsDelta:    "afterAddLiquidityReturnsDelta",
  afterRemoveLiquidityReturnsDelta: "afterRemoveLiquidityReturnsDelta",
};

// Human-readable description for each callback's capability
const CB_CAPABILITY: Record<string, string> = {
  beforeInitialize:                 "memvalidasi atau menolak pembuatan pool sebelum aktif",
  afterInitialize:                  "menginisialisasi state internal hook pasca pool dibuat",
  beforeAddLiquidity:               "mengontrol siapa yang boleh menambahkan likuiditas",
  afterAddLiquidity:                "memproses atau mencatat penambahan posisi LP",
  beforeRemoveLiquidity:            "mengontrol dan membatasi penarikan likuiditas",
  afterRemoveLiquidity:             "memproses atau mencatat penarikan posisi LP",
  beforeSwap:                       "mengintervensi swap sebelum eksekusi (fee, validasi, blokir)",
  afterSwap:                        "memproses hasil swap pasca eksekusi (oracle, analytics)",
  beforeDonate:                     "memvalidasi donasi ke pool",
  afterDonate:                      "memproses donasi yang masuk ke pool",
  beforeSwapReturnsDelta:           "memodifikasi jumlah token input/output sebelum swap (custom accounting)",
  afterSwapReturnsDelta:            "memodifikasi distribusi token setelah swap (custom accounting)",
  afterAddLiquidityReturnsDelta:    "memodifikasi perhitungan token saat LP masuk (custom accounting)",
  afterRemoveLiquidityReturnsDelta: "memodifikasi perhitungan token saat LP keluar (custom accounting)",
};

// ─── Description builder ──────────────────────────────────────────────────────

interface HookData {
  address: string;
  hookScore: number | null;
  isVerified: boolean;
  proxyType: string;
  riskLevel: string;
  beforeInitialize: boolean;
  afterInitialize: boolean;
  beforeAddLiquidity: boolean;
  afterAddLiquidity: boolean;
  beforeRemoveLiquidity: boolean;
  afterRemoveLiquidity: boolean;
  beforeSwap: boolean;
  afterSwap: boolean;
  beforeDonate: boolean;
  afterDonate: boolean;
  beforeSwapReturnsDelta: boolean;
  afterSwapReturnsDelta: boolean;
  afterAddLiquidityReturnsDelta: boolean;
  afterRemoveLiquidityReturnsDelta: boolean;
  poolCount: number;
  tvlUsd: number;
  swapCount: number;
}

export function buildHookDescription(h: HookData): string {
  // ── Active callbacks list ──────────────────────────────────────────────────
  const allCbs = Object.keys(CB_LABEL) as Array<keyof typeof CB_LABEL>;
  const active = allCbs.filter((k) => h[k as keyof HookData] === true);
  const activeCount = active.length;

  if (activeCount === 0) {
    return "Hook ini tidak mengimplementasikan callback apapun (no-op). Tidak ada intervensi terhadap operasi pool — aman tetapi tidak memiliki fungsi aktif.";
  }

  // Cluster into domains for the primary function sentence
  const swapOps   = active.filter((k) => k.includes("wap") || (k.includes("Delta") && !k.includes("iquidity")));
  const lpOps     = active.filter((k) => k.includes("iquidity") || k.includes("iquidityReturns"));
  const initOps   = active.filter((k) => k.includes("nitialize"));
  const donateOps = active.filter((k) => k.includes("onate"));

  const hasDelta   = h.beforeSwapReturnsDelta || h.afterSwapReturnsDelta;
  const hasLPDelta = h.afterAddLiquidityReturnsDelta || h.afterRemoveLiquidityReturnsDelta;
  const hasInit    = h.beforeInitialize || h.afterInitialize;
  const hasDonate  = h.beforeDonate || h.afterDonate;

  // ── Primary function ──────────────────────────────────────────────────────
  const domains: string[] = [];
  if (swapOps.length > 0 && hasDelta)   domains.push("pengelolaan swap dengan custom accounting");
  else if (swapOps.length > 0)          domains.push("pengelolaan dan monitoring swap");
  if (lpOps.length > 0 && hasLPDelta)   domains.push("manajemen posisi LP dengan akuntansi kustom");
  else if (lpOps.length > 0)            domains.push("kontrol posisi likuiditas");
  if (initOps.length > 0)               domains.push("inisialisasi dan konfigurasi pool");
  if (donateOps.length > 0)             domains.push("pemrosesan donasi");

  const primaryFunction = domains.length > 0
    ? domains.join(", ")
    : "berbagai operasi pool";

  // ── Opening sentence ──────────────────────────────────────────────────────
  let opening = `Hook ini mengimplementasikan ${activeCount} dari 14 callback Uniswap v4 untuk ${primaryFunction}. `;

  // Detail the specific callbacks
  opening += `Callback aktif: ${active.map((k) => CB_LABEL[k]).join(", ")}. `;

  // ── Capabilities (advantages) ─────────────────────────────────────────────
  const advantages: string[] = [];

  if (h.beforeSwap && h.beforeSwapReturnsDelta) {
    advantages.push("Dapat mengubah fee swap secara dinamis — memungkinkan tarif berbasis volatilitas, oracle harga, atau kondisi pasar real-time");
  } else if (h.beforeSwap && !h.beforeSwapReturnsDelta) {
    advantages.push("Dapat memvalidasi atau memblokir swap berdasarkan aturan custom (whitelist address, circuit breaker, price impact limit)");
  }

  if (h.afterSwap && h.afterSwapReturnsDelta) {
    advantages.push("Mampu mengumpulkan, mendistribusikan, atau merutekan fee pasca-swap langsung di execution layer tanpa transaksi tambahan");
  } else if (h.afterSwap && !h.afterSwapReturnsDelta) {
    advantages.push("Dapat mencatat data harga on-chain sebagai TWAP oracle atau memicu aksi pasca-swap (rebalancing, alerts)");
  }

  if (h.beforeAddLiquidity && !h.beforeSwap) {
    advantages.push("Mendukung akses LP terkontrol — memungkinkan pool privat, epoch-based liquidity, atau persyaratan minimum deposit");
  }

  if (h.beforeRemoveLiquidity) {
    advantages.push("Dapat menerapkan lock period atau kondisi penarikan — melindungi pool dari manipulasi dan rugpull likuiditas mendadak");
  }

  if (h.afterAddLiquidityReturnsDelta || h.afterRemoveLiquidityReturnsDelta) {
    advantages.push("Custom accounting pada posisi LP memungkinkan reward scheme kompleks seperti rebasing, fee-sharing, atau yield distribution otomatis");
  }

  if (hasInit && activeCount <= 3) {
    advantages.push("Ringan dan efisien — hanya meng-intercept fase inisialisasi, overhead gas minimal pada operasi pool reguler");
  } else if (activeCount <= 4) {
    advantages.push("Cakupan callback terbatas mengurangi attack surface dan overhead gas per-transaksi");
  }

  if (h.beforeSwap && h.afterSwap && h.beforeSwapReturnsDelta && h.afterSwapReturnsDelta) {
    advantages.push("Kontrol penuh atas siklus swap dari input hingga output — memungkinkan implementasi AMM curve kustom sepenuhnya");
  }

  if (hasDonate) {
    advantages.push("Mendukung mekanisme donasi ke pool — berguna untuk protocol-owned liquidity atau subsidi fee kepada LP");
  }

  // Trim to 3 most relevant
  const topAdvantages = advantages.slice(0, 3);

  // ── Risks ─────────────────────────────────────────────────────────────────
  const risks: string[] = [];

  if (h.beforeSwapReturnsDelta || h.afterSwapReturnsDelta) {
    risks.push("Custom accounting pada swap berarti hook dapat mengubah jumlah token yang diterima trader — periksa apakah formula fee transparan dan terdokumentasi");
  }

  if (h.afterAddLiquidityReturnsDelta || h.afterRemoveLiquidityReturnsDelta) {
    risks.push("Modifikasi delta pada posisi LP memungkinkan hook mengambil sebagian token saat LP masuk atau keluar — perlu verifikasi bahwa tidak ada fee tersembunyi");
  }

  if (h.beforeAddLiquidity || h.beforeRemoveLiquidity) {
    risks.push("Hook dapat memblokir LP dari menambah atau menarik likuiditas kapan saja — ada risiko dana LP terkunci jika kondisi validasi tidak terpenuhi");
  }

  if (!h.isVerified) {
    risks.push("Source code tidak diverifikasi di block explorer — tidak dapat diaudit secara independen; analisis hanya berdasarkan bytecode");
  }

  if (h.proxyType !== "NONE") {
    risks.push(`Menggunakan pola proxy upgradeable (${h.proxyType}) — owner dapat mengubah logika kontrak kapan saja, termasuk menambahkan perilaku berbahaya`);
  }

  if (h.hookScore !== null && h.hookScore < 35) {
    risks.push(`HookScore ${h.hookScore}/100 menunjukkan kombinasi faktor risiko signifikan — disarankan audit mendalam sebelum menyetorkan dana ke pool yang menggunakan hook ini`);
  } else if (h.hookScore !== null && h.hookScore < 50) {
    risks.push(`HookScore ${h.hookScore}/100 menunjukkan profil risiko yang perlu dievaluasi — tinjau sumber code (jika tersedia) sebelum berinteraksi`);
  }

  if (activeCount >= 10) {
    risks.push("Jumlah callback yang banyak (>= 10) memperluas attack surface — lebih banyak titik masuk potensial untuk eksploitasi");
  }

  // Trim to 3 most relevant
  const topRisks = risks.slice(0, 3);

  // ── Activity context (contributes to uniqueness) ─────────────────────────
  let activityNote = "";
  const tvlStr = h.tvlUsd >= 1_000_000
    ? `$${(h.tvlUsd / 1_000_000).toFixed(2)}M`
    : h.tvlUsd >= 1_000
    ? `$${Math.round(h.tvlUsd / 1000)}K`
    : h.tvlUsd > 0
    ? `$${h.tvlUsd.toFixed(0)}`
    : null;

  if (h.poolCount >= 100) {
    activityNote = ` Hook ini digunakan oleh ${h.poolCount} pool aktif${tvlStr ? ` dengan total TVL ${tvlStr}` : ""} — adopsi luas menunjukkan kepercayaan komunitas DeFi terhadap implementasinya.`;
  } else if (h.poolCount >= 10) {
    activityNote = ` Digunakan oleh ${h.poolCount} pool${h.swapCount > 0 ? ` dengan ${h.swapCount} swap tercatat` : ""}${tvlStr ? `, TVL ${tvlStr}` : ""}.`;
  } else if (h.poolCount >= 1) {
    activityNote = ` Aktif pada ${h.poolCount} pool${h.swapCount > 0 ? ` (${h.swapCount} swap)` : ""}${tvlStr ? ` — TVL ${tvlStr}` : ""}. HookScore ${h.hookScore ?? "?"}/100 menunjukkan risiko ${h.riskLevel === "MEDIUM" ? "menengah" : h.riskLevel === "HIGH" ? "tinggi" : h.riskLevel === "CRITICAL" ? "kritis" : "tidak diketahui"}.`;
  } else {
    // No pools yet — mention verification and score as differentiators
    activityNote = ` Belum digunakan di pool manapun. HookScore ${h.hookScore ?? "?"}/100 — ${!h.isVerified ? "source code belum terverifikasi" : "source code terverifikasi"}${h.proxyType !== "NONE" ? `, menggunakan proxy ${h.proxyType}` : ""}.`;
  }

  // ── Assemble description ──────────────────────────────────────────────────
  const parts: string[] = [opening.trim()];

  if (activityNote) parts.push(activityNote.trim());

  if (topAdvantages.length > 0) {
    parts.push(`Keuntungan: ${topAdvantages.map((a, i) => `(${i + 1}) ${a}`).join(". ")}.`);
  }

  if (topRisks.length > 0) {
    parts.push(`Risiko: ${topRisks.map((r, i) => `(${i + 1}) ${r}`).join(". ")}.`);
  }

  return parts.join(" ");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  const overwrite = process.argv.includes("--overwrite");
  const limitArg  = process.argv.indexOf("--limit");
  const limit     = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : undefined;

  const total = await prisma.hook.count({
    where: overwrite ? {} : { description: null },
  });

  console.log(`\nHookScope Description Generator`);
  console.log(`════════════════════════════════`);
  console.log(`To process : ${limit ?? total}`);
  console.log(`Mode       : ${overwrite ? "overwrite all" : "fill empty only"}`);
  console.log(``);

  const BATCH = 200;
  let processed = 0;
  let written = 0;

  for (let skip = 0; skip < (limit ?? total); skip += BATCH) {
    const hooks = await prisma.hook.findMany({
      where: overwrite ? {} : { description: null },
      skip,
      take: Math.min(BATCH, (limit ?? total) - skip),
      select: {
        id: true,
        address: true,
        hookScore: true,
        isVerified: true,
        proxyType: true,
        riskLevel: true,
        beforeInitialize: true,
        afterInitialize: true,
        beforeAddLiquidity: true,
        afterAddLiquidity: true,
        beforeRemoveLiquidity: true,
        afterRemoveLiquidity: true,
        beforeSwap: true,
        afterSwap: true,
        beforeDonate: true,
        afterDonate: true,
        beforeSwapReturnsDelta: true,
        afterSwapReturnsDelta: true,
        afterAddLiquidityReturnsDelta: true,
        afterRemoveLiquidityReturnsDelta: true,
        analytics: {
          select: { poolCount: true, tvlUsd: true, swapCount: true },
        },
      },
    });

    const updates = hooks.map((hook) => {
      const description = buildHookDescription({
        ...hook,
        poolCount: hook.analytics?.poolCount ?? 0,
        tvlUsd:    hook.analytics?.tvlUsd ?? 0,
        swapCount: Number(hook.analytics?.swapCount ?? 0),
      });

      return prisma.hook.update({
        where: { id: hook.id },
        data: { description },
      });
    });

    await prisma.$transaction(updates);

    processed += hooks.length;
    written   += hooks.length;

    const pct = Math.round((processed / (limit ?? total)) * 100);
    process.stdout.write(`\r  Progress: ${processed}/${limit ?? total} (${pct}%)`);
  }

  console.log(`\n\n✅ Generated descriptions for ${written} hooks`);

  // Show 3 sample descriptions
  console.log("\nSample descriptions:");
  const samples = await prisma.hook.findMany({
    take: 3,
    orderBy: { analytics: { tvlUsd: "desc" } },
    select: { address: true, name: true, description: true },
  });
  for (const s of samples) {
    console.log(`\n  [${s.name}] ${s.address.slice(0, 14)}...`);
    console.log(`  ${(s.description ?? "").slice(0, 200)}...`);
  }

  await prisma.$disconnect();
}

// Only run main() when this file is the entry point, not when imported as a module
const isMain = process.argv[1]?.endsWith("describe-hooks.ts") ||
               process.argv[1]?.endsWith("describe-hooks.js");
if (isMain) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}