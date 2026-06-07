/**
 * Populate HookFunction table from hook callback flags — no Etherscan calls needed.
 *
 * Uses the standardized Uniswap v4 hook callback ABI to create function records
 * for every hook that has the corresponding flag set.
 * Also parses additional public functions from stored source files.
 *
 * Usage:
 *   pnpm --filter @hookscope/indexer populate-callbacks          # all hooks missing functions
 *   pnpm --filter @hookscope/indexer populate-callbacks --all    # force re-index
 *   pnpm --filter @hookscope/indexer populate-callbacks --limit 100
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

import { PrismaClient } from "@prisma/client";

// ── Standard Uniswap v4 callback signatures ────────────────────────────────────
// From https://github.com/Uniswap/v4-core/blob/main/src/interfaces/IHooks.sol

const CALLBACK_DEFS: Record<string, { params: Param[]; returns: Param[]; description: string }> = {
  beforeInitialize: {
    params: [
      { name: "sender", type: "address" },
      { name: "key", type: "tuple", internalType: "PoolKey" },
      { name: "sqrtPriceX96", type: "uint160" },
    ],
    returns: [{ name: "", type: "bytes4" }],
    description: "Called before a pool is initialized. Return selector to continue.",
  },
  afterInitialize: {
    params: [
      { name: "sender", type: "address" },
      { name: "key", type: "tuple", internalType: "PoolKey" },
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
    ],
    returns: [{ name: "", type: "bytes4" }],
    description: "Called after a pool is initialized. Return selector to continue.",
  },
  beforeAddLiquidity: {
    params: [
      { name: "sender", type: "address" },
      { name: "key", type: "tuple", internalType: "PoolKey" },
      { name: "params", type: "tuple", internalType: "IPoolManager.ModifyLiquidityParams" },
      { name: "hookData", type: "bytes" },
    ],
    returns: [{ name: "", type: "bytes4" }],
    description: "Called before liquidity is added to a pool.",
  },
  afterAddLiquidity: {
    params: [
      { name: "sender", type: "address" },
      { name: "key", type: "tuple", internalType: "PoolKey" },
      { name: "params", type: "tuple", internalType: "IPoolManager.ModifyLiquidityParams" },
      { name: "delta", type: "int256", internalType: "BalanceDelta" },
      { name: "feesAccrued", type: "int256", internalType: "BalanceDelta" },
      { name: "hookData", type: "bytes" },
    ],
    returns: [
      { name: "", type: "bytes4" },
      { name: "", type: "int256", internalType: "BalanceDelta" },
    ],
    description: "Called after liquidity is added. Can return a delta to adjust balances.",
  },
  beforeRemoveLiquidity: {
    params: [
      { name: "sender", type: "address" },
      { name: "key", type: "tuple", internalType: "PoolKey" },
      { name: "params", type: "tuple", internalType: "IPoolManager.ModifyLiquidityParams" },
      { name: "hookData", type: "bytes" },
    ],
    returns: [{ name: "", type: "bytes4" }],
    description: "Called before liquidity is removed from a pool.",
  },
  afterRemoveLiquidity: {
    params: [
      { name: "sender", type: "address" },
      { name: "key", type: "tuple", internalType: "PoolKey" },
      { name: "params", type: "tuple", internalType: "IPoolManager.ModifyLiquidityParams" },
      { name: "delta", type: "int256", internalType: "BalanceDelta" },
      { name: "feesAccrued", type: "int256", internalType: "BalanceDelta" },
      { name: "hookData", type: "bytes" },
    ],
    returns: [
      { name: "", type: "bytes4" },
      { name: "", type: "int256", internalType: "BalanceDelta" },
    ],
    description: "Called after liquidity is removed. Can return a delta to adjust balances.",
  },
  beforeSwap: {
    params: [
      { name: "sender", type: "address" },
      { name: "key", type: "tuple", internalType: "PoolKey" },
      { name: "params", type: "tuple", internalType: "IPoolManager.SwapParams" },
      { name: "hookData", type: "bytes" },
    ],
    returns: [
      { name: "", type: "bytes4" },
      { name: "", type: "int256", internalType: "BeforeSwapDelta" },
      { name: "lpFeeOverride", type: "uint24" },
    ],
    description: "Called before a swap. Can override LP fee or return a delta.",
  },
  afterSwap: {
    params: [
      { name: "sender", type: "address" },
      { name: "key", type: "tuple", internalType: "PoolKey" },
      { name: "params", type: "tuple", internalType: "IPoolManager.SwapParams" },
      { name: "delta", type: "int256", internalType: "BalanceDelta" },
      { name: "hookData", type: "bytes" },
    ],
    returns: [
      { name: "", type: "bytes4" },
      { name: "hookDeltaSpecified", type: "int128" },
    ],
    description: "Called after a swap. Can apply a fee or return a hook delta.",
  },
  beforeDonate: {
    params: [
      { name: "sender", type: "address" },
      { name: "key", type: "tuple", internalType: "PoolKey" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
      { name: "hookData", type: "bytes" },
    ],
    returns: [{ name: "", type: "bytes4" }],
    description: "Called before tokens are donated to a pool.",
  },
  afterDonate: {
    params: [
      { name: "sender", type: "address" },
      { name: "key", type: "tuple", internalType: "PoolKey" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
      { name: "hookData", type: "bytes" },
    ],
    returns: [{ name: "", type: "bytes4" }],
    description: "Called after tokens are donated to a pool.",
  },
};

// Callback flags mapped to column names in hooks table
const CALLBACK_FLAGS = [
  "beforeInitialize", "afterInitialize",
  "beforeAddLiquidity", "afterAddLiquidity",
  "beforeRemoveLiquidity", "afterRemoveLiquidity",
  "beforeSwap", "afterSwap",
  "beforeDonate", "afterDonate",
] as const;

interface Param {
  name: string;
  type: string;
  internalType?: string;
}

// ── CLI ────────────────────────────────────────────────────────────────────────

const args  = process.argv.slice(2);
const FORCE = args.includes("--all");
const LIMIT = (() => { const i = args.indexOf("--limit"); return i !== -1 ? Number(args[i+1]) : 50000; })();

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildSig(name: string, params: Param[], returns: Param[]): string {
  const ins  = params.map((p) => p.internalType ?? p.type).join(", ");
  const outs = returns.map((p) => p.internalType ?? p.type).join(", ");
  return `${name}(${ins})${outs ? ` returns (${outs})` : ""}`;
}

function buildSelector(name: string, params: Param[]): string {
  // Use canonical ABI types for selector
  const types = params.map((p) => {
    if (p.type === "tuple") return "tuple";
    return p.type;
  });
  return `${name}(${types.join(",")})`.slice(0, 10);
}

// ── Parse additional functions from Solidity source ────────────────────────────

interface ParsedFn {
  name: string;
  params: Param[];
  returns: Param[];
  visibility: string;
  mutability: string;
}

function stripComments(src: string): string {
  // Remove line comments
  src = src.replace(/\/\/[^\n]*/g, "");
  // Remove block comments (non-greedy)
  src = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return src;
}

function parseParamList(raw: string): Param[] {
  if (!raw.trim()) return [];
  return raw.split(",").map((part) => {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    // tokens: [type, name] or [type, memory/calldata/storage, name] etc
    const type = tokens[0] ?? "bytes";
    const name = tokens[tokens.length - 1] ?? "";
    // Skip if name looks like a modifier (memory, calldata, storage)
    const cleaned = /^(memory|calldata|storage|indexed)$/.test(name) ? "" : name;
    return { name: cleaned, type };
  });
}

function parseSolidityFunctions(src: string, contractName: string): ParsedFn[] {
  src = stripComments(src);
  const fns: ParsedFn[] = [];

  // Match: function name(params) modifiers [returns (types)] [{ or ;]
  // Use a simple line-by-line scan to handle multi-line signatures
  const fnRe = /\bfunction\s+(\w+)\s*\(/g;
  let m: RegExpExecArray | null;

  while ((m = fnRe.exec(src)) !== null) {
    const name = m[1];
    const start = m.index + m[0].length - 1; // position of opening (

    // Extract balanced params
    let depth = 0, i = start, paramEnd = start;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") { depth--; if (depth === 0) { paramEnd = i; break; } }
    }
    const paramStr = src.slice(start + 1, paramEnd);

    // Rest of the declaration until { or ;
    const rest = src.slice(paramEnd + 1, paramEnd + 300).replace(/\s+/g, " ");

    const visMatch = rest.match(/\b(public|external|internal|private)\b/);
    const mutMatch = rest.match(/\b(view|pure|payable)\b/);
    const retMatch = rest.match(/returns\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)/);

    const visibility = visMatch?.[1] ?? "public";
    const mutability = mutMatch?.[1] ?? "nonpayable";

    // Only index public/external functions
    if (visibility !== "public" && visibility !== "external") continue;
    // Skip constructors etc
    if (!name || name === contractName) continue;

    const params = parseParamList(paramStr);
    const returns = retMatch ? parseParamList(retMatch[1]) : [];

    fns.push({ name, params, returns, visibility, mutability });
  }

  return fns;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  const hooks = await prisma.hook.findMany({
    where: FORCE
      ? {}
      : { functions: { none: {} } },
    select: {
      id: true, address: true, name: true,
      beforeInitialize: true, afterInitialize: true,
      beforeAddLiquidity: true, afterAddLiquidity: true,
      beforeRemoveLiquidity: true, afterRemoveLiquidity: true,
      beforeSwap: true, afterSwap: true,
      beforeDonate: true, afterDonate: true,
      sourceFiles: { select: { id: true, fileName: true, content: true } },
    },
    take: LIMIT,
  });

  console.log(`\n⚡ Callback Populator — HookScope`);
  console.log(`   Mode : ${FORCE ? "force re-index" : "missing only"}`);
  console.log(`   Total: ${hooks.length} hooks`);
  console.log("");

  let processed = 0, cbIndexed = 0, srcIndexed = 0;
  const startAt = Date.now();

  for (const hook of hooks) {
    processed++;

    // 1. Callback functions from flags
    const cbFns: Parameters<typeof prisma.hookFunction.createMany>[0]["data"] = [];

    for (const cbName of CALLBACK_FLAGS) {
      if (!hook[cbName]) continue;
      const def = CALLBACK_DEFS[cbName];
      if (!def) continue;

      cbFns.push({
        hookId:          hook.id,
        name:            cbName,
        signature:       buildSig(cbName, def.params, def.returns),
        selector:        buildSelector(cbName, def.params),
        params:          def.params as object[],
        returns:         def.returns as object[],
        visibility:      "external",
        stateMutability: "nonpayable",
        isCallback:      true,
        natspec:         def.description,
      });
    }

    // 2. Additional functions from source files
    const extraFns: Parameters<typeof prisma.hookFunction.createMany>[0]["data"] = [];
    const seenNames = new Set(cbFns.map((f) => f.name));

    const mainFile = hook.sourceFiles.find((sf) =>
      sf.fileName.toLowerCase().includes(hook.address.slice(2, 6).toLowerCase()) ||
      (hook.name && sf.fileName.toLowerCase().includes(hook.name.toLowerCase())) ||
      sf.fileName.endsWith(".sol")
    ) ?? hook.sourceFiles[0];

    if (mainFile?.content) {
      const contractName = mainFile.fileName.replace(/\.sol$/, "").split("/").pop() ?? "";
      const parsed = parseSolidityFunctions(mainFile.content, contractName);

      for (const fn of parsed) {
        if (seenNames.has(fn.name)) continue;
        seenNames.add(fn.name);

        extraFns.push({
          hookId:          hook.id,
          name:            fn.name,
          signature:       buildSig(fn.name, fn.params, fn.returns),
          selector:        buildSelector(fn.name, fn.params),
          params:          fn.params as object[],
          returns:         fn.returns as object[],
          visibility:      fn.visibility,
          stateMutability: fn.mutability,
          isCallback:      false,
        });
      }
    }

    const allFns = [...cbFns, ...extraFns];
    if (allFns.length > 0) {
      if (FORCE) await prisma.hookFunction.deleteMany({ where: { hookId: hook.id } });
      await prisma.hookFunction.createMany({ data: allFns, skipDuplicates: true });
      if (cbFns.length > 0) cbIndexed++;
      if (extraFns.length > 0) srcIndexed++;
    }

    const elapsed = (Date.now() - startAt) / 1000;
    const rate = processed / elapsed;
    const eta  = (hooks.length - processed) / (rate || 1);
    process.stdout.write(
      `\r  ${processed}/${hooks.length}  callbacks:${cbIndexed}  +src:${srcIndexed}  ${rate.toFixed(0)}/s  ETA ${fmtTime(eta)}`
    );
  }

  const elapsed = (Date.now() - startAt) / 1000;
  console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Processed      : ${processed}`);
  console.log(`  With callbacks : ${cbIndexed}`);
  console.log(`  + src parsed   : ${srcIndexed}`);
  console.log(`  Duration       : ${fmtTime(elapsed)}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  await prisma.$disconnect();
}

function fmtTime(s: number): string {
  if (s < 60)   return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s/60)}m ${Math.round(s % 60)}s`;
  return `${Math.floor(s/3600)}h ${Math.floor((s % 3600)/60)}m`;
}

main().catch((e) => { console.error("\n❌", e.message); process.exit(1); });
