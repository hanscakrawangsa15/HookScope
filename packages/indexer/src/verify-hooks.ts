/**
 * Bulk source-code verification for all hooks in the DB.
 * Checks Etherscan/Basescan/etc. for contract verification and stores the results.
 *
 * Usage:
 *   pnpm --filter @hookscope/indexer verify-hooks           # all unverified
 *   pnpm --filter @hookscope/indexer verify-hooks --all     # force re-check all
 *   pnpm --filter @hookscope/indexer verify-hooks --chain 1 # Ethereum only
 *   pnpm --filter @hookscope/indexer verify-hooks --limit 500
 *
 * Concurrency:
 *   - Chain with API key → 3 concurrent workers, 180ms delay
 *   - Chain without key  → 1 worker, 800ms delay (free tier: ~1.2 req/sec)
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

import { PrismaClient } from "@prisma/client";
import pLimit from "p-limit";
import { EXPLORER_API_URLS } from "@hookscope/shared";

// ── CLI args ─────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const FORCE   = args.includes("--all");
const CHAIN   = (() => { const i = args.indexOf("--chain"); return i !== -1 ? Number(args[i+1]) : null; })();
const LIMIT   = (() => { const i = args.indexOf("--limit"); return i !== -1 ? Number(args[i+1]) : 10_000; })();
const DRY_RUN = args.includes("--dry");

// ── API keys ─────────────────────────────────────────────────────────────────

const API_KEYS: Record<number, string | undefined> = {
  1:       process.env.ETHERSCAN_API_KEY,
  8453:    process.env.BASESCAN_API_KEY,
  42161:   process.env.ARBISCAN_API_KEY,
  10:      process.env.OPTIMISTIC_ETHERSCAN_API_KEY,
  11155111: process.env.SEPOLIA_ETHERSCAN_API_KEY,
  84532:   process.env.BASESCAN_SEPOLIA_API_KEY,
};

// Per-chain: [concurrency, delay_ms]
function chainConfig(chainId: number): { concurrency: number; delay: number } {
  const hasKey = !!API_KEYS[chainId];
  return hasKey
    ? { concurrency: 3, delay: 180 }  // ~5 req/sec, 3 workers
    : { concurrency: 1, delay: 800 }; // ~1.2 req/sec, safe for keyless
}

// ── Etherscan helpers ─────────────────────────────────────────────────────────

interface SrcResult {
  SourceCode: string;
  ABI: string;
  ContractName: string;
  CompilerVersion: string;
}
interface CreResult {
  contractCreator: string;
  txHash: string;
}

async function callEtherscan<T>(url: string, retries = 3): Promise<T | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json() as { status: string; result: T };
      // Etherscan returns status "0" with result "Max rate limit reached"
      if (j.status === "0" && typeof j.result === "string" && j.result.includes("rate")) {
        await sleep(2000 * attempt);
        continue;
      }
      return j.result;
    } catch (e) {
      if (attempt === retries) return null;
      await sleep(1000 * attempt);
    }
  }
  return null;
}

async function verifyContract(address: string, chainId: number) {
  const base = EXPLORER_API_URLS[chainId];
  if (!base) return null;

  const key = API_KEYS[chainId] ? `&apikey=${API_KEYS[chainId]}` : "";
  // V2 URLs already have ?chainid=X — use & separator; V1 URLs need ?
  const sep = base.includes("?") ? "&" : "?";

  const srcUrl = `${base}${sep}module=contract&action=getsourcecode&address=${address}${key}`;
  const srcData = await callEtherscan<SrcResult[]>(srcUrl);

  let contractName: string | null = null;
  let isVerified = false;
  let sourceFiles: Array<{ name: string; content: string; language: string }> = [];
  let abi: unknown[] = [];

  if (srcData && srcData.length > 0) {
    const r = srcData[0];
    contractName = r.ContractName || null;
    isVerified = !!r.SourceCode && r.SourceCode !== "" && r.SourceCode !== "Contract source code not verified";

    if (isVerified) {
      sourceFiles = parseSource(r.SourceCode, r.ContractName);
      try { abi = JSON.parse(r.ABI); } catch { /* non-JSON ABI */ }
    }
  }

  // Fetch deployer if not already stored
  const creUrl = `${base}${sep}module=contract&action=getcontractcreation&contractaddresses=${address}${key}`;
  const creData = await callEtherscan<CreResult[]>(creUrl);
  const deployer    = creData?.[0]?.contractCreator?.toLowerCase() ?? null;
  const deployTxHash = creData?.[0]?.txHash ?? null;

  return { contractName, isVerified, sourceFiles, abi, deployer, deployTxHash };
}

function parseSource(raw: string, name: string): Array<{ name: string; content: string; language: string }> {
  const t = raw.trim();
  if (t.startsWith("{{") && t.endsWith("}}")) {
    try {
      const parsed = JSON.parse(t.slice(1, -1)) as { sources: Record<string, { content: string }> };
      return Object.entries(parsed.sources).map(([n, { content }]) => ({ name: n, content, language: "solidity" }));
    } catch { /* fall through */ }
  }
  if (t.startsWith("{") && t.includes('"sources"')) {
    try {
      const parsed = JSON.parse(t) as { sources: Record<string, { content: string }> };
      if (parsed.sources) return Object.entries(parsed.sources).map(([n, { content }]) => ({ name: n, content, language: "solidity" }));
    } catch { /* fall through */ }
  }
  return [{ name: `${name}.sol`, content: raw, language: "solidity" }];
}

// ── Progress display ─────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (seconds < 60)  return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds/60)}m ${Math.round(seconds%60)}s`;
  return `${Math.floor(seconds/3600)}h ${Math.floor((seconds%3600)/60)}m`;
}

class Progress {
  private start = Date.now();
  private done  = 0;
  private total: number;
  private verified = 0;
  private failed   = 0;

  constructor(total: number) { this.total = total; }

  tick(address: string, isVerified: boolean, error = false) {
    this.done++;
    if (isVerified) this.verified++;
    if (error) this.failed++;

    const elapsed   = (Date.now() - this.start) / 1000;
    const rate      = this.done / elapsed;
    const remaining = (this.total - this.done) / (rate || 1);
    const pct       = ((this.done / this.total) * 100).toFixed(1);
    const bar       = "█".repeat(Math.floor(this.done / this.total * 30)).padEnd(30, "░");

    process.stdout.write(
      `\r  [${bar}] ${pct}%  ${this.done}/${this.total}  ` +
      `✓ ${this.verified}  ✗ err ${this.failed}  ` +
      `${rate.toFixed(1)}/s  ETA ${formatTime(remaining)}  ` +
      `${address.slice(0, 10)}...`
    );
  }

  summary() {
    const elapsed = (Date.now() - this.start) / 1000;
    console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  Processed : ${this.done}`);
    console.log(`  Verified  : ${this.verified} (${((this.verified/this.done)*100).toFixed(1)}%)`);
    console.log(`  Failed    : ${this.failed}`);
    console.log(`  Duration  : ${formatTime(elapsed)}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  const hooks = await prisma.hook.findMany({
    where: {
      ...(FORCE ? {} : { isVerified: false }),
      ...(CHAIN != null ? { chainId: CHAIN } : {}),
    },
    select: { id: true, address: true, chainId: true, name: true, deployer: true },
    orderBy: [{ chainId: "asc" }, { deployedAt: "asc" }],
    take: LIMIT,
  });

  const byChain: Record<number, typeof hooks> = {};
  for (const h of hooks) {
    if (!byChain[h.chainId]) byChain[h.chainId] = [];
    byChain[h.chainId].push(h);
  }

  console.log(`\n🔍 HookScope — Bulk Source Verification`);
  console.log(`   Mode   : ${FORCE ? "re-check all" : "unverified only"}`);
  console.log(`   Total  : ${hooks.length} hooks`);
  console.log(`   Chains : ${Object.entries(byChain).map(([c, h]) => `${c}(${h.length})`).join(", ")}`);
  Object.entries(byChain).forEach(([chainId, hs]) => {
    const cfg  = chainConfig(Number(chainId));
    const secs = (hs.length * (cfg.delay / cfg.concurrency)) / 1000;
    const keyStatus = API_KEYS[Number(chainId)] ? "🔑 keyed" : "🔓 public";
    console.log(`   Chain ${chainId} : ${hs.length} hooks, ${cfg.concurrency} workers, ~${formatTime(secs)} ${keyStatus}`);
  });
  if (DRY_RUN) { console.log("\n[DRY RUN] exiting"); await prisma.$disconnect(); return; }
  console.log("");

  const progress = new Progress(hooks.length);

  // Process chains concurrently with each chain having its own limiter
  await Promise.all(
    Object.entries(byChain).map(async ([chainIdStr, chainHooks]) => {
      const chainId = Number(chainIdStr);
      const cfg     = chainConfig(chainId);
      const limiter = pLimit(cfg.concurrency);

      const tasks = chainHooks.map((hook) =>
        limiter(async () => {
          let verified = false;
          try {
            const info = await verifyContract(hook.address, chainId);

            if (info !== null) {
              const updateData: Record<string, unknown> = {
                isVerified: info.isVerified,
                lastAnalyzedAt: new Date(),
              };
              if (info.contractName && !hook.name)    updateData.name    = info.contractName;
              if (info.deployer    && !hook.deployer) updateData.deployer = info.deployer;
              if (info.deployTxHash)                  updateData.deployTxHash = info.deployTxHash;

              await prisma.hook.update({ where: { id: hook.id }, data: updateData });

              if (info.sourceFiles.length > 0) {
                await prisma.sourceFile.deleteMany({ where: { hookId: hook.id } });
                await prisma.sourceFile.createMany({
                  data: info.sourceFiles.map((sf) => ({
                    hookId: hook.id,
                    fileName: sf.name,
                    content:  sf.content,
                    language: sf.language,
                  })),
                });
              }

              verified = info.isVerified;
              progress.tick(hook.address, verified, false);
            } else {
              progress.tick(hook.address, false, true);
            }
          } catch (err) {
            progress.tick(hook.address, false, true);
          }

          // Per-worker delay to respect rate limit
          await sleep(cfg.delay);
        })
      );

      await Promise.all(tasks);
    })
  );

  progress.summary();
  await prisma.$disconnect();
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((e) => { console.error("\n\n❌", e.message); process.exit(1); });
