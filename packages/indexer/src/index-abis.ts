/**
 * ABI Indexer — fetch ABI from Etherscan for verified hooks and populate HookFunction table.
 * Runs fast: only calls getabi (1 request/hook), not getsourcecode.
 *
 * Usage:
 *   pnpm --filter @hookscope/indexer index-abis          # all verified without functions
 *   pnpm --filter @hookscope/indexer index-abis --all    # force re-index all verified
 *   pnpm --filter @hookscope/indexer index-abis --chain 1
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

import { PrismaClient } from "@prisma/client";
import pLimit from "p-limit";
import { EXPLORER_API_URLS } from "@hookscope/shared";

// ── Types ──────────────────────────────────────────────────────────────────────

interface AbiInput {
  name: string;
  type: string;
  internalType?: string;
  components?: AbiInput[];
}

interface AbiItem {
  type: string;
  name?: string;
  inputs?: AbiInput[];
  outputs?: AbiInput[];
  stateMutability?: string;
  anonymous?: boolean;
}

// ── CLI args ───────────────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const FORCE  = args.includes("--all");
const CHAIN  = (() => { const i = args.indexOf("--chain"); return i !== -1 ? Number(args[i+1]) : null; })();
const LIMIT  = (() => { const i = args.indexOf("--limit"); return i !== -1 ? Number(args[i+1]) : 5000; })();

const API_KEYS: Record<number, string | undefined> = {
  1:       process.env.ETHERSCAN_API_KEY,
  8453:    process.env.BASESCAN_API_KEY,
  42161:   process.env.ARBISCAN_API_KEY,
  10:      process.env.OPTIMISTIC_ETHERSCAN_API_KEY,
  11155111: process.env.SEPOLIA_ETHERSCAN_API_KEY,
  84532:   process.env.BASESCAN_SEPOLIA_API_KEY,
};

// Known Uniswap v4 hook callbacks
const HOOK_CALLBACKS = new Set([
  "beforeInitialize", "afterInitialize",
  "beforeAddLiquidity", "afterAddLiquidity",
  "beforeRemoveLiquidity", "afterRemoveLiquidity",
  "beforeSwap", "afterSwap",
  "beforeDonate", "afterDonate",
  "beforeSwapReturnsDelta", "afterSwapReturnsDelta",
  "afterAddLiquidityReturnsDelta", "afterRemoveLiquidityReturnsDelta",
]);

// ── ABI helpers ────────────────────────────────────────────────────────────────

function selector(name: string, inputs: AbiInput[]): string {
  const sig = `${name}(${flattenTypes(inputs).join(",")})`;
  // Simple FNV-style hash approximation — use proper keccak in production
  // We just store the signature string; 4-byte is best-effort
  return sig.slice(0, 10); // store first 10 chars as placeholder until we add keccak
}

function flattenTypes(inputs: AbiInput[]): string[] {
  return (inputs ?? []).map((i) => {
    if (i.type === "tuple" || i.type.startsWith("tuple[")) {
      const inner = flattenTypes(i.components ?? []).join(",");
      return i.type.replace("tuple", `(${inner})`);
    }
    return i.type;
  });
}

function sig(name: string, inputs: AbiInput[], outputs: AbiInput[]): string {
  const ins  = flattenTypes(inputs).join(",");
  const outs = flattenTypes(outputs).join(",");
  return `${name}(${ins})${outs ? ` returns (${outs})` : ""}`;
}

// ── Fetch ABI via getsourcecode ────────────────────────────────────────────────
// getabi action fails for many verified contracts; getsourcecode returns ABI in
// the same response alongside source code, and we know it works from verify-hooks.

interface SourceResult {
  ABI: string;
  ContractName: string;
  SourceCode: string;
}

async function fetchAbi(address: string, chainId: number, retries = 3): Promise<AbiItem[] | null> {
  const base = EXPLORER_API_URLS[chainId];
  if (!base) return null;

  const key = API_KEYS[chainId] ? `&apikey=${API_KEYS[chainId]}` : "";
  const sep = base.includes("?") ? "&" : "?";
  const url = `${base}${sep}module=contract&action=getsourcecode&address=${address}${key}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const j = await r.json() as { status: string; result: SourceResult[] | string };

      if (j.status === "0") {
        if (typeof j.result === "string" && j.result.toLowerCase().includes("rate")) {
          await sleep(2000 * attempt);
          continue;
        }
        return null;
      }

      const result = Array.isArray(j.result) ? j.result[0] : null;
      if (!result?.ABI || result.ABI === "Contract source code not verified") return null;

      try {
        return JSON.parse(result.ABI) as AbiItem[];
      } catch {
        return null;
      }
    } catch {
      if (attempt === retries) return null;
      await sleep(1000 * attempt);
    }
  }
  return null;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  // Query hooks that need ABI indexing
  const hooks = await prisma.hook.findMany({
    where: {
      isVerified: true,
      ...(FORCE ? {} : { functions: { none: {} } }),
      ...(CHAIN != null ? { chainId: CHAIN } : {}),
    },
    select: { id: true, address: true, chainId: true, name: true },
    orderBy: [{ chainId: "asc" }],
    take: LIMIT,
  });

  // Group by chain for concurrency control
  const byChain: Record<number, typeof hooks> = {};
  for (const h of hooks) {
    if (!byChain[h.chainId]) byChain[h.chainId] = [];
    byChain[h.chainId].push(h);
  }

  console.log(`\n⚡ ABI Indexer — HookScope`);
  console.log(`   Mode  : ${FORCE ? "force re-index all" : "missing only"}`);
  console.log(`   Total : ${hooks.length} hooks`);
  console.log(`   Chains: ${Object.entries(byChain).map(([c, h]) => `${c}(${h.length})`).join(", ")}`);
  console.log("");

  let processed = 0, indexed = 0, failed = 0;
  const total = hooks.length;

  const startAt = Date.now();

  await Promise.all(
    Object.entries(byChain).map(async ([chainIdStr, chainHooks]) => {
      const chainId = Number(chainIdStr);
      const hasKey  = !!API_KEYS[chainId];
      const limiter = pLimit(hasKey ? 3 : 1);
      const delay   = hasKey ? 200 : 800;

      const tasks = chainHooks.map((hook) =>
        limiter(async () => {
          try {
            const abi = await fetchAbi(hook.address, chainId);
            if (!abi) { failed++; return; }

            const fns = abi.filter((item) => item.type === "function" && item.name);

            if (fns.length > 0) {
              // Delete old functions first
              await prisma.hookFunction.deleteMany({ where: { hookId: hook.id } });

              await prisma.hookFunction.createMany({
                data: fns.map((fn) => ({
                  hookId:          hook.id,
                  name:            fn.name!,
                  signature:       sig(fn.name!, fn.inputs ?? [], fn.outputs ?? []),
                  selector:        selector(fn.name!, fn.inputs ?? []),
                  params:          (fn.inputs ?? []).map((i) => ({ name: i.name, type: i.type })),
                  returns:         (fn.outputs ?? []).map((o) => ({ name: o.name, type: o.type })),
                  visibility:      "public",
                  stateMutability: fn.stateMutability ?? "nonpayable",
                  isCallback:      HOOK_CALLBACKS.has(fn.name!),
                })),
                skipDuplicates: true,
              });

              indexed++;
            }
          } catch {
            failed++;
          } finally {
            processed++;
            const elapsed = (Date.now() - startAt) / 1000;
            const rate    = processed / elapsed;
            const eta     = (total - processed) / (rate || 1);
            process.stdout.write(
              `\r  ${processed}/${total}  ✓ ${indexed}  ✗ ${failed}  ${rate.toFixed(1)}/s  ETA ${fmtTime(eta)}`
            );
            await sleep(delay);
          }
        })
      );

      await Promise.all(tasks);
    })
  );

  const elapsed = (Date.now() - startAt) / 1000;
  console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Processed : ${processed}`);
  console.log(`  Indexed   : ${indexed} hooks with ABI`);
  console.log(`  Failed    : ${failed}`);
  console.log(`  Duration  : ${fmtTime(elapsed)}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  await prisma.$disconnect();
}

function fmtTime(s: number): string {
  if (s < 60)   return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s/60)}m ${Math.round(s%60)}s`;
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((e) => { console.error("\n\n❌", e.message); process.exit(1); });
