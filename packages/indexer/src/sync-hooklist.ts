/**
 * Sync hook names & descriptions from the official Uniswap hooklist registry.
 * Source: https://github.com/Uniswap/hooklist
 *
 * Usage:
 *   pnpm --filter @hookscope/indexer sync-hooklist          # sync + dry-run preview
 *   pnpm --filter @hookscope/indexer sync-hooklist --write  # actually update DB
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

import { PrismaClient, AuditStatus } from "@prisma/client";

const HOOKLIST_JSON = "https://raw.githubusercontent.com/Uniswap/hooklist/main/hooklist.json";
const CHAIN_DIRS: Record<string, number> = {
  ethereum: 1,
  base:     8453,
  arbitrum: 42161,
  optimism: 10,
  monad:    10143,
  bnb:      56,
  polygon:  137,
  avalanche: 43114,
};

const WRITE = process.argv.includes("--write");

// ── Types ──────────────────────────────────────────────────────────────────────

interface HooklistEntry {
  hook: {
    address: string;
    chain: string;
    chainId: number;
    name: string;
    description: string;
    deployer?: string;
    verifiedSource?: boolean;
    auditUrl?: string;
  };
  flags?: Record<string, boolean>;
  properties?: {
    dynamicFee?: boolean;
    upgradeable?: boolean;
    requiresCustomSwapData?: boolean;
    vanillaSwap?: boolean;
    swapAccess?: string;
  };
}

interface HookFile {
  hook: HooklistEntry["hook"];
  flags?: HooklistEntry["flags"];
  properties?: HooklistEntry["properties"];
}

// ── Fetch helpers ──────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    return r.ok ? (await r.json()) as T : null;
  } catch {
    return null;
  }
}

async function fetchChainHooks(chain: string): Promise<HooklistEntry[]> {
  const chainId = CHAIN_DIRS[chain];
  if (!chainId) return [];

  const listUrl = `https://api.github.com/repos/Uniswap/hooklist/contents/hooks/${chain}`;
  const files = await fetchJson<Array<{ name: string; download_url: string }>>(listUrl);
  if (!files) return [];

  const results: HooklistEntry[] = [];

  for (const file of files) {
    if (!file.name.endsWith(".json") || !file.download_url) continue;
    const data = await fetchJson<HookFile>(file.download_url);
    if (data?.hook?.name) {
      results.push({ ...data, hook: { ...data.hook, chainId: data.hook.chainId || chainId } });
    }
    await sleep(50); // gentle rate limiting
  }

  return results;
}

// ── Tag derivation ─────────────────────────────────────────────────────────────

function deriveTags(entry: HooklistEntry): string[] {
  const tags: string[] = [];
  const flags = entry.flags ?? {};
  const props = entry.properties ?? {};

  if (props.dynamicFee) tags.push("Dynamic Fee");
  if (props.upgradeable) tags.push("Upgradeable");
  if (props.vanillaSwap) tags.push("Vanilla Swap");
  if (props.requiresCustomSwapData) tags.push("Custom Swap Data");
  if (props.swapAccess === "whitelist") tags.push("Access Control");

  if (flags.beforeSwapReturnsDelta || flags.afterSwapReturnsDelta) tags.push("Custom AMM");
  if (flags.afterAddLiquidity || flags.afterRemoveLiquidity) tags.push("LP Rewards");
  if (flags.beforeDonate || flags.afterDonate) tags.push("Fee Distribution");

  return tags;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  console.log(`\n📋 HookScope — Uniswap Hooklist Sync`);
  console.log(`   Mode: ${WRITE ? "WRITE (updating DB)" : "DRY RUN (preview only — add --write to apply)"}`);
  console.log("\n1. Fetching hooklist.json…");

  // Primary: consolidated hooklist.json
  const primary = await fetchJson<HooklistEntry[]>(HOOKLIST_JSON);
  console.log(`   hooklist.json: ${primary?.length ?? 0} entries`);

  // Secondary: individual chain directories (for hooks not in main list)
  console.log("\n2. Fetching individual chain directories…");
  const chainHooks: HooklistEntry[] = [];
  for (const chain of Object.keys(CHAIN_DIRS)) {
    const entries = await fetchChainHooks(chain);
    console.log(`   ${chain}: ${entries.length} hooks`);
    chainHooks.push(...entries);
  }

  // Merge: deduplicate by address (individual files take precedence — more detailed)
  const allEntries = new Map<string, HooklistEntry>();

  for (const entry of (primary ?? [])) {
    const addr = entry.hook.address.toLowerCase();
    allEntries.set(addr, entry);
  }
  for (const entry of chainHooks) {
    const addr = entry.hook.address.toLowerCase();
    // Individual file wins if it has same or better data
    if (!allEntries.has(addr) || entry.hook.description) {
      allEntries.set(addr, entry);
    }
  }

  console.log(`\n3. Total unique hooks from registry: ${allEntries.size}`);

  // Match against our DB
  let matched = 0, updated = 0, notInDb = 0;

  const rows: Array<{
    address: string; oldName: string | null; newName: string;
    description: string; tags: string[]; auditUrl: string; verifiedSource: boolean;
  }> = [];

  for (const [addr, entry] of allEntries) {
    const hook = await prisma.hook.findFirst({
      where: { address: addr },
      select: { id: true, address: true, name: true, chainId: true },
    });

    if (!hook) { notInDb++; continue; }
    matched++;

    const tags = deriveTags(entry);
    rows.push({
      address: addr,
      oldName: hook.name,
      newName: entry.hook.name,
      description: entry.hook.description ?? "",
      tags,
      auditUrl: entry.hook.auditUrl ?? "",
      verifiedSource: entry.hook.verifiedSource ?? false,
    });
  }

  // Print preview table
  console.log(`\n   Matched in DB  : ${matched}`);
  console.log(`   Not in our DB  : ${notInDb}`);
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Address          │ Old Name                  │ New Name`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  for (const row of rows) {
    const addr  = row.address.slice(0, 14) + "…";
    const oldN  = (row.oldName ?? "—").slice(0, 25).padEnd(25);
    const newN  = row.newName.slice(0, 30);
    const changed = row.oldName !== row.newName;
    console.log(`  ${addr} │ ${oldN} │ ${changed ? "\x1b[33m" : ""}${newN}\x1b[0m`);
  }

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  if (!WRITE) {
    console.log(`\n⚠️  DRY RUN — no changes applied. Run with --write to update DB.\n`);
    await prisma.$disconnect();
    return;
  }

  // Apply updates
  console.log(`\n4. Applying updates…`);

  for (const row of rows) {
    await prisma.hook.updateMany({
      where: { address: row.address },
      data: {
        name:        row.newName,
        description: row.description || undefined,
        isVerified:  row.verifiedSource ? true : undefined,
        auditStatus: row.auditUrl
          ? AuditStatus.AUDITED
          : undefined,
        lastAnalyzedAt: new Date(),
      },
    });

    // If auditUrl, upsert an audit record
    if (row.auditUrl) {
      const hook = await prisma.hook.findFirst({ where: { address: row.address }, select: { id: true } });
      if (hook) {
        await prisma.auditRecord.upsert({
          where: { id: `hooklist-${hook.id}` },
          create: {
            id:        `hooklist-${hook.id}`,
            hookId:    hook.id,
            auditor:   "Uniswap Hooklist",
            reportUrl: row.auditUrl,
            auditDate: new Date(),
            summary:   "Listed in official Uniswap Hooklist registry",
          },
          update: { reportUrl: row.auditUrl },
        });
      }
    }

    updated++;
  }

  console.log(`\n✅ Updated ${updated} hooks in DB`);
  console.log(`   Not in DB (skipped): ${notInDb} hooks from registry`);

  await prisma.$disconnect();
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((e) => { console.error("\n❌", e.message); process.exit(1); });
