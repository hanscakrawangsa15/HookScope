/**
 * Deep Hook Bytecode Analyzer
 *
 * Extracts on-chain intelligence from contract bytecode to generate
 * unique, fact-based descriptions for every Uniswap v4 hook.
 *
 * Analysis layers:
 *   1. Function selector extraction  — what functions the hook exposes
 *   2. Opcode pattern detection      — is it stateful? does it call oracles?
 *   3. Known signature matching      — Chainlink, RBAC, Pausable, ERC20, etc.
 *   4. Description synthesis         — unique paragraph per hook
 *
 * Run: pnpm --filter @hookscope/indexer bytecode-analyze
 * Options:
 *   --chain 1       only process this chainId
 *   --limit 500     max hooks to process
 *   --reanalyze     re-fetch bytecode even if already analyzed
 *   --dry-run       print sample output without writing to DB
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

import { keccak256, toBytes, type PublicClient } from "viem";
import { PrismaClient } from "@prisma/client";
import { buildChainConfigs } from "./chain-config.js";
import { buildHookDescription } from "./describe-hooks.js";

// ─── Known DeFi function signatures ──────────────────────────────────────────

const KNOWN_SIGS: Array<{
  sig: string;
  label: string;
  category: string;
  finding: string;       // human-readable fact to add to description
  risk?: string;         // optional risk fact
}> = [
  // ── Ownership ──────────────────────────────────────────────────────────────
  { sig: "owner()",
    label: "Ownable.owner",
    category: "ownership",
    finding: "dikontrol oleh single owner address (Ownable pattern)" },
  { sig: "transferOwnership(address)",
    label: "Ownable.transferOwnership",
    category: "ownership",
    finding: "kepemilikan hook dapat dipindahkan ke address lain" },
  { sig: "renounceOwnership()",
    label: "Ownable.renounceOwnership",
    category: "ownership",
    finding: "mendukung renounce ownership (admin dapat menyerahkan kontrol permanen)" },

  // ── Role-Based Access Control ──────────────────────────────────────────────
  { sig: "hasRole(bytes32,address)",
    label: "AccessControl.hasRole",
    category: "rbac",
    finding: "menggunakan role-based access control (RBAC) — berbeda role untuk berbeda fungsi admin" },
  { sig: "grantRole(bytes32,address)",
    label: "AccessControl.grantRole",
    category: "rbac",
    finding: "admin dapat memberikan role ke address baru" },
  { sig: "revokeRole(bytes32,address)",
    label: "AccessControl.revokeRole",
    category: "rbac",
    finding: "admin dapat mencabut role dari address" },

  // ── Pausability ───────────────────────────────────────────────────────────
  { sig: "pause()",
    label: "Pausable.pause",
    category: "pausable",
    finding: "dapat di-pause oleh admin — semua operasi pool bisa dihentikan",
    risk: "admin berpotensi memblokir seluruh aktivitas pool secara sepihak" },
  { sig: "unpause()",
    label: "Pausable.unpause",
    category: "pausable",
    finding: "mendukung mekanisme unpause — aktivitas pool dapat dilanjutkan setelah pause" },
  { sig: "paused()",
    label: "Pausable.paused",
    category: "pausable",
    finding: "status pause dapat dicek secara on-chain" },

  // ── Chainlink Oracle ──────────────────────────────────────────────────────
  { sig: "latestAnswer()",
    label: "Chainlink latestAnswer",
    category: "chainlink-oracle",
    finding: "membaca harga terkini dari Chainlink Price Feed — fee atau validasi berbasis harga real-world" },
  { sig: "latestRoundData()",
    label: "Chainlink latestRoundData",
    category: "chainlink-oracle",
    finding: "membaca data harga lengkap Chainlink (harga, timestamp, roundId) — validasi freshness data oracle" },

  // ── Uniswap v3 TWAP Oracle ────────────────────────────────────────────────
  { sig: "observe(uint32[])",
    label: "UniswapV3 observe (TWAP)",
    category: "twap-oracle",
    finding: "membaca TWAP (Time-Weighted Average Price) dari Uniswap v3 pool — fee dinamis berbasis harga rata-rata" },
  { sig: "slot0()",
    label: "UniswapV3 slot0",
    category: "price-read",
    finding: "membaca harga spot langsung dari Uniswap v3 pool (sqrtPriceX96)" },

  // ── ERC20 Token Interaction ───────────────────────────────────────────────
  { sig: "transfer(address,uint256)",
    label: "ERC20 transfer",
    category: "token-transfer",
    finding: "dapat mentransfer token ERC20 — hook berinteraksi langsung dengan saldo token",
    risk: "hook memiliki kemampuan memindahkan token ERC20" },
  { sig: "transferFrom(address,address,uint256)",
    label: "ERC20 transferFrom",
    category: "token-transfer",
    finding: "dapat menarik token ERC20 dari address lain (memerlukan approval)",
    risk: "hook dapat mengambil token dari address yang telah memberikan approval" },
  { sig: "balanceOf(address)",
    label: "ERC20 balanceOf",
    category: "token-read",
    finding: "membaca saldo token untuk logika berbasis kepemilikan (minimum balance check, fee tier)" },

  // ── Whitelist / Allowlist ─────────────────────────────────────────────────
  { sig: "setWhitelist(address,bool)",
    label: "setWhitelist",
    category: "whitelist",
    finding: "admin dapat mengubah status whitelist address secara individual" },
  { sig: "addToWhitelist(address)",
    label: "addToWhitelist",
    category: "whitelist",
    finding: "mendukung penambahan address ke whitelist — untuk pool privat atau gated access" },
  { sig: "removeFromWhitelist(address)",
    label: "removeFromWhitelist",
    category: "whitelist",
    finding: "mendukung penghapusan address dari whitelist" },
  { sig: "isWhitelisted(address)",
    label: "isWhitelisted",
    category: "whitelist",
    finding: "menyediakan query status whitelist yang dapat dibaca secara publik" },
  { sig: "whitelist(address)",
    label: "whitelist mapping",
    category: "whitelist",
    finding: "menyimpan mapping whitelist address yang dapat diquery" },

  // ── Fee Management ────────────────────────────────────────────────────────
  { sig: "setFee(uint24)",
    label: "setFee",
    category: "fee-admin",
    finding: "admin dapat mengubah fee rate secara manual",
    risk: "fee dapat dinaikkan oleh admin kapan saja" },
  { sig: "setFee(uint256)",
    label: "setFee (uint256)",
    category: "fee-admin",
    finding: "admin dapat mengubah fee rate secara manual",
    risk: "fee dapat diubah secara sepihak" },
  { sig: "collectFees()",
    label: "collectFees",
    category: "fee-collection",
    finding: "fee yang terkumpul dapat ditarik oleh pihak berwenang" },
  { sig: "collectFees(address)",
    label: "collectFees(address)",
    category: "fee-collection",
    finding: "fee dapat dikumpulkan dan dikirim ke address yang ditentukan" },
  { sig: "withdrawFees(address)",
    label: "withdrawFees",
    category: "fee-collection",
    finding: "protocol fee dapat ditarik ke treasury address" },
  { sig: "protocolFee()",
    label: "protocolFee",
    category: "fee-read",
    finding: "memiliki protocol fee yang terpisah dari LP fee" },

  // ── Time-lock ─────────────────────────────────────────────────────────────
  { sig: "queueTransaction(address,uint256,string,bytes,uint256)",
    label: "Timelock queueTransaction",
    category: "timelock",
    finding: "perubahan parameter dilindungi timelock — ada jeda waktu sebelum perubahan efektif" },
  { sig: "executeTransaction(address,uint256,string,bytes,uint256)",
    label: "Timelock executeTransaction",
    category: "timelock",
    finding: "eksekusi perubahan setelah timelock period — memberikan waktu bagi pengguna untuk bereaksi" },

  // ── Upgradeable Proxy ─────────────────────────────────────────────────────
  { sig: "upgradeTo(address)",
    label: "UUPS upgradeTo",
    category: "upgradeable",
    finding: "logika kontrak dapat di-upgrade (UUPS pattern) — implementasi bisa berubah",
    risk: "owner dapat mengubah seluruh logika hook dengan upgrade" },
  { sig: "upgradeToAndCall(address,bytes)",
    label: "UUPS upgradeToAndCall",
    category: "upgradeable",
    finding: "mendukung upgrade dengan migrasi data sekaligus",
    risk: "upgrade dapat menyertakan eksekusi fungsi arbitrary" },
  { sig: "initialize()",
    label: "initializer",
    category: "proxy-init",
    finding: "menggunakan pola proxy dengan initializer (bukan constructor)" },

  // ── Limit Order Pattern ───────────────────────────────────────────────────
  { sig: "placeOrder(int24,uint256,bool)",
    label: "placeOrder",
    category: "limit-order",
    finding: "mendukung penempatan limit order on-chain berbasis tick price" },
  { sig: "cancelOrder(int24,bool)",
    label: "cancelOrder",
    category: "limit-order",
    finding: "pengguna dapat membatalkan limit order yang sudah ditempatkan" },
  { sig: "claimOrder(int24,bool)",
    label: "claimOrder",
    category: "limit-order",
    finding: "pengguna dapat mengambil hasil limit order yang sudah tereksekusi" },

  // ── Staking / Reward ──────────────────────────────────────────────────────
  { sig: "stake(uint256)",
    label: "stake",
    category: "staking",
    finding: "mendukung staking token dalam konteks pool" },
  { sig: "unstake(uint256)",
    label: "unstake",
    category: "staking",
    finding: "mendukung penarikan stake" },
  { sig: "claimRewards()",
    label: "claimRewards",
    category: "reward",
    finding: "pengguna dapat mengklaim reward yang terakumulasi" },
  { sig: "earned(address)",
    label: "earned",
    category: "reward",
    finding: "dapat menghitung reward yang tersedia per address" },
  { sig: "rewardRate()",
    label: "rewardRate",
    category: "reward",
    finding: "memiliki rate distribusi reward yang dapat diquery" },

  // ── Multi-call ────────────────────────────────────────────────────────────
  { sig: "multicall(bytes[])",
    label: "multicall",
    category: "multicall",
    finding: "mendukung batching beberapa operasi dalam satu transaksi (multicall pattern)" },

  // ── EIP-2612 Permit ───────────────────────────────────────────────────────
  { sig: "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",
    label: "EIP-2612 permit",
    category: "permit",
    finding: "mendukung gasless approval via signature (EIP-2612) — tidak perlu transaksi approve terpisah" },

  // ── ERC-165 Interface ─────────────────────────────────────────────────────
  { sig: "supportsInterface(bytes4)",
    label: "ERC-165",
    category: "interface",
    finding: "mengimplementasikan ERC-165 interface detection — kompatibel dengan tool discovery standar" },

  // ── getHookPermissions ────────────────────────────────────────────────────
  { sig: "getHookPermissions()",
    label: "getHookPermissions",
    category: "hook-meta",
    finding: "mengekspos fungsi getHookPermissions() — callback yang diklaim dapat diverifikasi on-chain" },

  // ── Custom Curve / Pricing ────────────────────────────────────────────────
  { sig: "getSqrtRatioAtTick(int24)",
    label: "getSqrtRatioAtTick",
    category: "custom-pricing",
    finding: "menghitung harga berbasis tick secara internal — menggunakan custom pricing logic" },
  { sig: "getAmountOut(uint256,uint256,uint256)",
    label: "getAmountOut",
    category: "amm-logic",
    finding: "mengimplementasikan formula output AMM sendiri — custom bonding curve" },

  // ── Emergency / Kill Switch ───────────────────────────────────────────────
  { sig: "emergencyWithdraw()",
    label: "emergencyWithdraw",
    category: "emergency",
    finding: "memiliki fungsi emergency withdraw — admin dapat mengosongkan pool dalam kondisi darurat",
    risk: "admin dapat menarik seluruh dana dari pool secara emergensi" },
  { sig: "kill()",
    label: "kill/selfDestruct",
    category: "emergency",
    finding: "memiliki fungsi kill — kontrak dapat dihancurkan oleh admin",
    risk: "kontrak dapat di-selfDestruct oleh owner, menghancurkan semua state pool" },
];

// Pre-compute selectors once at startup
function buildSelectorMap(): Map<string, typeof KNOWN_SIGS[0]> {
  const map = new Map<string, typeof KNOWN_SIGS[0]>();
  for (const entry of KNOWN_SIGS) {
    const selector = keccak256(toBytes(entry.sig)).slice(0, 10);
    map.set(selector, entry);
  }
  return map;
}

const SELECTOR_MAP = buildSelectorMap();

// ─── Bytecode opcode constants ────────────────────────────────────────────────

const OP = {
  PUSH4: 0x63,
  SSTORE: 0x55,
  SLOAD: 0x54,
  CALL: 0xf1,
  STATICCALL: 0xfa,
  DELEGATECALL: 0xf4,
  CALLCODE: 0xf2,
  LOG0: 0xa0,
  LOG1: 0xa1,
  LOG2: 0xa2,
  LOG3: 0xa3,
  LOG4: 0xa4,
  CREATE: 0xf0,
  CREATE2: 0xf5,
  SELFDESTRUCT: 0xff,
  REVERT: 0xfd,
} as const;

// ─── Bytecode analysis result ─────────────────────────────────────────────────

export interface BytecodeProfile {
  exists: boolean;
  isStateful: boolean;         // has SSTORE — maintains on-chain state
  hasExternalCalls: boolean;   // has CALL — interacts with other contracts
  hasStaticCalls: boolean;     // has STATICCALL — reads external state (oracles)
  hasEvents: boolean;          // has LOG — emits events
  hasDelegatecall: boolean;    // has DELEGATECALL — proxy/code-injection risk
  hasCreate: boolean;          // has CREATE/CREATE2 — deploys sub-contracts
  hasSelfDestruct: boolean;    // has SELFDESTRUCT
  sstoreCount: number;         // number of state writes
  callCount: number;           // number of external calls
  selectors: string[];         // all PUSH4 4-byte values found
  knownMatches: Array<{        // matched against KNOWN_SIGS
    selector: string;
    label: string;
    category: string;
    finding: string;
    risk?: string;
  }>;
  categories: Set<string>;     // set of detected categories
}

export function analyzeOpcodes(bytecode: `0x${string}`): BytecodeProfile {
  const hex = bytecode.slice(2).toLowerCase();
  const bytes = Buffer.from(hex, "hex");

  let isStateful       = false;
  let hasExternalCalls = false;
  let hasStaticCalls   = false;
  let hasEvents        = false;
  let hasDelegatecall  = false;
  let hasCreate        = false;
  let hasSelfDestruct  = false;
  let sstoreCount      = 0;
  let callCount        = 0;

  const selectorSet = new Set<string>();
  const knownMatches: BytecodeProfile["knownMatches"] = [];
  const categories = new Set<string>();

  // Walk bytecode — skip push data after PUSH opcodes
  let i = 0;
  while (i < bytes.length) {
    const op = bytes[i];

    // PUSH4: next 4 bytes are a potential function selector
    if (op === OP.PUSH4 && i + 4 < bytes.length) {
      const sel = "0x" + hex.slice((i + 1) * 2, (i + 5) * 2);
      selectorSet.add(sel);

      const known = SELECTOR_MAP.get(sel);
      if (known && !categories.has(known.category)) {
        categories.add(known.category);
        knownMatches.push({
          selector: sel,
          label: known.label,
          category: known.category,
          finding: known.finding,
          risk: known.risk,
        });
      }
      i += 5; // PUSH4 opcode + 4 bytes data
      continue;
    }

    // Skip other PUSH opcodes (PUSH1–PUSH32)
    if (op >= 0x60 && op <= 0x7f) {
      i += (op - 0x60 + 2); // opcode + n bytes
      continue;
    }

    switch (op) {
      case OP.SSTORE:     isStateful = true; sstoreCount++; break;
      case OP.SLOAD:      isStateful = true; break;
      case OP.CALL:       hasExternalCalls = true; callCount++; break;
      case OP.CALLCODE:   hasExternalCalls = true; break;
      case OP.STATICCALL: hasStaticCalls = true; break;
      case OP.DELEGATECALL: hasDelegatecall = true; break;
      case OP.CREATE:
      case OP.CREATE2:    hasCreate = true; break;
      case OP.SELFDESTRUCT: hasSelfDestruct = true; break;
      case OP.LOG0:
      case OP.LOG1:
      case OP.LOG2:
      case OP.LOG3:
      case OP.LOG4:       hasEvents = true; break;
    }

    i++;
  }

  return {
    exists: true,
    isStateful,
    hasExternalCalls,
    hasStaticCalls,
    hasEvents,
    hasDelegatecall,
    hasCreate,
    hasSelfDestruct,
    sstoreCount,
    callCount,
    selectors: [...selectorSet],
    knownMatches,
    categories,
  };
}

// ─── Description synthesis ────────────────────────────────────────────────────

export function synthesizeDescription(
  base: Parameters<typeof buildHookDescription>[0],
  profile: BytecodeProfile,
): string {
  if (!profile.exists) {
    return "Tidak ada bytecode pada address ini — kontrak mungkin sudah di-self-destruct atau belum terverifikasi sebagai kontrak Solidity.";
  }

  // ── Base description from callback analysis ──────────────────────────────
  const baseDesc = buildHookDescription({
    ...base,
    poolCount: base.poolCount,
    tvlUsd: base.tvlUsd,
    swapCount: base.swapCount,
  });

  // ── Bytecode intelligence section ────────────────────────────────────────
  const facts: string[] = [];
  const risks: string[] = [];

  // Architecture facts
  if (profile.isStateful) {
    const complexity = profile.sstoreCount >= 10
      ? "kompleks dengan banyak state variable"
      : profile.sstoreCount >= 3
      ? "menyimpan beberapa state variable"
      : "ringan dengan state minimal";
    facts.push(`Kontrak ${complexity} (${profile.sstoreCount} storage write terdeteksi)`);
  } else {
    facts.push("Kontrak stateless — tidak menyimpan state on-chain, hanya logika validasi/observasi");
  }

  if (profile.hasEvents) {
    facts.push("Memancarkan event — aktivitas hook dapat dimonitor oleh indexer dan analytics tools");
  }

  if (profile.hasStaticCalls && !profile.hasExternalCalls) {
    facts.push("Membaca data eksternal via staticcall (read-only) — kemungkinan oracle atau price feed integration");
  }

  if (profile.hasExternalCalls && profile.callCount >= 3) {
    facts.push(`Melakukan ${profile.callCount} external call — berinteraksi dengan beberapa protokol luar`);
  }

  if (profile.hasCreate) {
    facts.push("Dapat men-deploy kontrak baru (CREATE/CREATE2) — kemungkinan factory pattern atau sub-position contracts");
  }

  // Known DeFi pattern matches
  const oracleMatches = profile.knownMatches.filter(m =>
    ["chainlink-oracle", "twap-oracle", "price-read"].includes(m.category)
  );
  const accessMatches = profile.knownMatches.filter(m =>
    ["ownership", "rbac", "whitelist"].includes(m.category)
  );
  const pauseMatches  = profile.knownMatches.filter(m => m.category === "pausable");
  const feeMatches    = profile.knownMatches.filter(m =>
    ["fee-admin", "fee-collection", "fee-read"].includes(m.category)
  );
  const upgradeMatches = profile.knownMatches.filter(m =>
    ["upgradeable", "proxy-init"].includes(m.category)
  );
  const specialMatches = profile.knownMatches.filter(m =>
    ["limit-order", "staking", "reward", "timelock", "emergency", "permit"].includes(m.category)
  );

  if (oracleMatches.length > 0) {
    const labels = oracleMatches.map(m => m.label).join(" + ");
    facts.push(`Terintegrasi dengan oracle harga: ${labels}`);
  }

  if (accessMatches.length > 0) {
    const rbac    = accessMatches.some(m => m.category === "rbac");
    const wl      = accessMatches.some(m => m.category === "whitelist");
    const ownable = accessMatches.some(m => m.category === "ownership");
    if (rbac)    facts.push("Menggunakan role-based access control (RBAC) — admin, pauser, configurator role terpisah");
    else if (wl) facts.push("Memiliki sistem whitelist on-chain — hanya address terdaftar yang dapat berinteraksi");
    else if (ownable) facts.push("Dikontrol oleh single owner address (Ownable pattern)");
  }

  if (pauseMatches.length > 0) {
    facts.push("Dapat di-pause/unpause oleh admin — mekanisme circuit breaker untuk kondisi darurat");
    risks.push("Admin dapat menghentikan seluruh aktivitas pool secara sepihak dengan fitur pause");
  }

  if (feeMatches.length > 0) {
    const hasAdmin = feeMatches.some(m => m.category === "fee-admin");
    const hasCollect = feeMatches.some(m => m.category === "fee-collection");
    if (hasAdmin)   risks.push("Fee rate dapat diubah secara admin — monitor perubahan fee secara berkala");
    if (hasCollect) facts.push("Fee yang terkumpul dapat ditarik oleh protocol treasury");
  }

  if (upgradeMatches.length > 0) {
    const isProxy = upgradeMatches.some(m => m.category === "upgradeable");
    if (isProxy) {
      facts.push("Menggunakan UUPS upgradeable proxy — seluruh logika dapat diganti oleh owner");
      risks.push("Logika hook dapat diganti sepenuhnya via upgrade — audit ulang diperlukan setelah setiap upgrade");
    }
  }

  for (const match of specialMatches) {
    if (match.category === "limit-order") facts.push("Mengimplementasikan limit order on-chain — swap dieksekusi saat harga mencapai target");
    if (match.category === "staking")     facts.push("Mendukung mekanisme staking dalam ekosistem pool");
    if (match.category === "reward")      facts.push("Mendistribusikan reward kepada partisipan pool secara otomatis");
    if (match.category === "timelock")    facts.push("Perubahan parameter dilindungi timelock — ada jeda sebelum perubahan efektif");
    if (match.category === "emergency") {
      facts.push("Memiliki fungsi emergency withdraw untuk kondisi kritis");
      risks.push(match.risk ?? "Fungsi emergency dapat digunakan untuk menarik dana pool");
    }
    if (match.category === "permit")     facts.push("Mendukung gasless token approval via EIP-2612 permit signature");
  }

  // ── Assemble final description ────────────────────────────────────────────
  const sections: string[] = [baseDesc];

  if (facts.length > 0 || risks.length > 0) {
    sections.push(`Analisis bytecode mengungkapkan:`);

    if (facts.length > 0) {
      sections.push(`Fakta teknis: ${facts.slice(0, 4).map((f, i) => `(${i + 1}) ${f}`).join(". ")}.`);
    }

    if (risks.length > 0) {
      sections.push(`Temuan risiko dari bytecode: ${risks.slice(0, 3).map((r, i) => `(${i + 1}) ${r}`).join(". ")}.`);
    }
  }

  return sections.join(" ");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  const args = process.argv.slice(2);
  const getArg = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };

  const chainFilter  = getArg("--chain") ? parseInt(getArg("--chain")!, 10) : undefined;
  const limit        = getArg("--limit") ? parseInt(getArg("--limit")!, 10) : undefined;
  const reanalyze    = args.includes("--reanalyze");
  const dryRun       = args.includes("--dry-run");

  const chainConfigs = buildChainConfigs();
  const clientMap    = new Map<number, PublicClient>(
    chainConfigs.map((c) => [c.chain.id, c.client])
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (chainFilter)   where.chainId = chainFilter;
  // Only process hooks that haven't been bytecode-analyzed yet (no "bytecode-analyzed" flag)
  // We use a SecurityFlag with category "BYTECODE_ANALYZED" as a marker
  if (!reanalyze) {
    where.securityFlags = { none: { category: "BYTECODE_ANALYZED" } };
  }

  const total = await prisma.hook.count({ where });
  const toProcess = limit ?? total;

  console.log(`\nHookScope Deep Bytecode Analyzer`);
  console.log(`═════════════════════════════════`);
  console.log(`To analyze : ${toProcess}`);
  console.log(`Chains     : ${chainFilter ?? "all"}`);
  console.log(`Mode       : ${dryRun ? "dry-run" : reanalyze ? "reanalyze all" : "new only"}`);
  console.log(`\nKnown signatures: ${KNOWN_SIGS.length} (${SELECTOR_MAP.size} selectors computed)\n`);

  let processed  = 0;
  let enriched   = 0;
  let noCode     = 0;
  let noRpc      = 0;

  const categoryCounts: Record<string, number> = {};

  const BATCH = 50;

  for (let skip = 0; skip < toProcess; skip += BATCH) {
    const hooks = await prisma.hook.findMany({
      where,
      skip,
      take: Math.min(BATCH, toProcess - skip),
      select: {
        id: true,
        address: true,
        chainId: true,
        hookScore: true,
        isVerified: true,
        proxyType: true,
        riskLevel: true,
        beforeInitialize: true,  afterInitialize: true,
        beforeAddLiquidity: true, afterAddLiquidity: true,
        beforeRemoveLiquidity: true, afterRemoveLiquidity: true,
        beforeSwap: true, afterSwap: true,
        beforeDonate: true, afterDonate: true,
        beforeSwapReturnsDelta: true, afterSwapReturnsDelta: true,
        afterAddLiquidityReturnsDelta: true,
        afterRemoveLiquidityReturnsDelta: true,
        analytics: {
          select: { poolCount: true, tvlUsd: true, swapCount: true },
        },
      },
    });

    for (const hook of hooks) {
      process.stdout.write(`\r  [${processed + 1}/${toProcess}] ${hook.address.slice(0, 16)}...`);

      const client = clientMap.get(hook.chainId);
      if (!client) { noRpc++; processed++; continue; }

      // Fetch bytecode
      let bytecode: `0x${string}` | undefined;
      try {
        bytecode = await client.getBytecode({ address: hook.address as `0x${string}` });
      } catch {
        noRpc++;
        processed++;
        continue;
      }

      if (!bytecode || bytecode === "0x") {
        noCode++;
        processed++;
        // Still mark as analyzed
        if (!dryRun) {
          await prisma.securityFlag.create({
            data: {
              hookId: hook.id,
              category: "BYTECODE_ANALYZED",
              severity: "LOW",
              description: "Bytecode analysis completed — no bytecode found at address",
              source: "bytecode-analyzer",
            },
          }).catch(() => {});
        }
        continue;
      }

      // Analyze opcodes
      const profile = analyzeOpcodes(bytecode);

      // Track category stats
      for (const cat of profile.categories) {
        categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
      }

      // Synthesize enhanced description
      const baseData = {
        address: hook.address,
        hookScore: hook.hookScore,
        isVerified: hook.isVerified,
        proxyType: hook.proxyType,
        riskLevel: hook.riskLevel,
        beforeInitialize: hook.beforeInitialize,
        afterInitialize: hook.afterInitialize,
        beforeAddLiquidity: hook.beforeAddLiquidity,
        afterAddLiquidity: hook.afterAddLiquidity,
        beforeRemoveLiquidity: hook.beforeRemoveLiquidity,
        afterRemoveLiquidity: hook.afterRemoveLiquidity,
        beforeSwap: hook.beforeSwap,
        afterSwap: hook.afterSwap,
        beforeDonate: hook.beforeDonate,
        afterDonate: hook.afterDonate,
        beforeSwapReturnsDelta: hook.beforeSwapReturnsDelta,
        afterSwapReturnsDelta: hook.afterSwapReturnsDelta,
        afterAddLiquidityReturnsDelta: hook.afterAddLiquidityReturnsDelta,
        afterRemoveLiquidityReturnsDelta: hook.afterRemoveLiquidityReturnsDelta,
        poolCount: hook.analytics?.poolCount ?? 0,
        tvlUsd: hook.analytics?.tvlUsd ?? 0,
        swapCount: Number(hook.analytics?.swapCount ?? 0),
      };

      const description = synthesizeDescription(baseData, profile);

      if (dryRun) {
        if (processed < 3) {
          console.log(`\n  Sample [${hook.address.slice(0, 14)}]:`);
          console.log(`  Patterns: ${[...profile.categories].join(", ") || "none"}`);
          console.log(`  Desc: ${description.slice(0, 300)}...`);
        }
      } else {
        // Update description + add analysis marker flag
        await prisma.$transaction([
          prisma.hook.update({
            where: { id: hook.id },
            data: { description },
          }),
          prisma.securityFlag.create({
            data: {
              hookId: hook.id,
              category: "BYTECODE_ANALYZED",
              severity: "LOW",
              description: `Bytecode analyzed: ${profile.selectors.length} selectors, ${profile.sstoreCount} SSTORE. Patterns: ${[...profile.categories].join(", ") || "none"}`,
              source: "bytecode-analyzer",
            },
          }),
          // Store individual risk findings as real SecurityFlags
          ...profile.knownMatches
            .filter(m => m.risk)
            .filter(m => !["upgradeable", "proxy-init"].includes(m.category)) // avoid duplicates from existing proxy detection
            .map(m => prisma.securityFlag.create({
              data: {
                hookId: hook.id,
                category: `BYTECODE_${m.category.toUpperCase().replace(/-/g, "_")}`,
                severity: ["emergency", "pausable", "upgradeable"].includes(m.category) ? "HIGH" : "MEDIUM",
                description: m.risk!,
                source: "bytecode-analyzer",
                reportedBy: `Selector: ${m.selector} (${m.label})`,
              },
            })),
        ]);

        enriched++;
      }

      processed++;

      // Rate limit: ~5 req/sec per RPC to avoid throttling
      await sleep(200);
    }
  }

  console.log(`\n\n═══ Results ═══`);
  console.log(`  Processed   : ${processed}`);
  console.log(`  Enriched    : ${enriched}`);
  console.log(`  No bytecode : ${noCode}`);
  console.log(`  No RPC      : ${noRpc}`);

  if (Object.keys(categoryCounts).length > 0) {
    console.log(`\n  Detected patterns:`);
    for (const [cat, n] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
      const bar = "█".repeat(Math.min(Math.round(n / 5), 30));
      console.log(`    ${cat.padEnd(22)} ${bar} ${n}`);
    }
  }

  console.log(`\n✅ Bytecode analysis complete!`);
  await prisma.$disconnect();
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});