/**
 * Hook Authenticity Validator
 *
 * Validates that indexed contracts are genuine Uniswap v4 hooks using 3 layers:
 *
 * Layer 1 — Pool Event Proof (highest confidence)
 *   Hooks indexed from PoolManager.Initialize have been through Uniswap's own
 *   validateHookPermissions() check on-chain. This is cryptographic proof.
 *
 * Layer 2 — getHookPermissions() On-chain Call
 *   Calls the standard BaseHook function and compares its returned Permissions
 *   struct against the 14-bit address bitmask. A mismatch means either:
 *     a) The contract was address-mined to look like a hook but isn't one, or
 *     b) The hook returns wrong permissions (developer bug — still suspicious).
 *
 * Layer 3 — Bytecode Function Selector Scan
 *   Extracts 4-byte PUSH4 values from the contract bytecode and checks that
 *   every active callback flag has a matching function selector. If the address
 *   claims "beforeSwap" but no beforeSwap selector exists in bytecode, it's
 *   likely a fake or misconfigured hook.
 *
 * Results are stored as SecurityFlag records (source: "validator") and
 * the hook's hookScore / riskLevel are updated accordingly.
 *
 * Run: pnpm --filter @hookscope/indexer validate-hooks
 * Options:
 *   --chain 1        only validate hooks on this chainId
 *   --limit 200      max hooks (default: all)
 *   --revalidate     re-check already-validated hooks
 *   --no-pool-skip   also validate hooks that have pool-event proof
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

import {
  keccak256,
  toBytes,
  toHex,
  decodeAbiParameters,
  parseAbiParameters,
  type PublicClient,
} from "viem";
import { PrismaClient } from "@prisma/client";
import { buildChainConfigs } from "./chain-config.js";
import { decodeHookFlags, extractFlagsBitmask } from "@hookscope/shared";

// ─── getHookPermissions() ABI ────────────────────────────────────────────────
// Returns Hooks.Permissions memory — a struct of 14 booleans.
// In ABI encoding each bool is a padded 32-byte word.
const PERMISSIONS_ABI = parseAbiParameters(
  "bool,bool,bool,bool,bool,bool,bool,bool,bool,bool,bool,bool,bool,bool"
);

// Compute selector once at startup
const GET_HOOK_PERMISSIONS_SELECTOR = keccak256(
  toBytes("getHookPermissions()")
).slice(0, 10) as `0x${string}`; // "0x" + 8 hex chars = 4 bytes

// ─── Known Uniswap v4 IHooks function selectors ───────────────────────────
// Pre-computed from ABI signatures using the canonical v4 types.
// PoolKey = (address,address,uint24,int24,address)
// SwapParams = (bool,int256,uint160)
// ModifyLiquidityParams = (int24,int24,int256,bytes32)
// BalanceDelta = (int128,int128) — returned as tuple not passed as param
const IHOOKS_SELECTORS: Record<string, string> = {};

function computeSelectors() {
  const sigs: [string, string][] = [
    ["beforeInitialize", "beforeInitialize(address,(address,address,uint24,int24,address),uint160,bytes)"],
    ["afterInitialize",  "afterInitialize(address,(address,address,uint24,int24,address),uint160,int24,bytes)"],
    ["beforeAddLiquidity",  "beforeAddLiquidity(address,(address,address,uint24,int24,address),(int24,int24,int256,bytes32),bytes)"],
    ["afterAddLiquidity",   "afterAddLiquidity(address,(address,address,uint24,int24,address),(int24,int24,int256,bytes32),(int128,int128),(int128,int128),bytes)"],
    ["beforeRemoveLiquidity","beforeRemoveLiquidity(address,(address,address,uint24,int24,address),(int24,int24,int256,bytes32),bytes)"],
    ["afterRemoveLiquidity", "afterRemoveLiquidity(address,(address,address,uint24,int24,address),(int24,int24,int256,bytes32),(int128,int128),(int128,int128),bytes)"],
    ["beforeSwap", "beforeSwap(address,(address,address,uint24,int24,address),(bool,int256,uint160),bytes)"],
    ["afterSwap",  "afterSwap(address,(address,address,uint24,int24,address),(bool,int256,uint160),(int128,int128),bytes)"],
    ["beforeDonate", "beforeDonate(address,(address,address,uint24,int24,address),uint256,uint256,bytes)"],
    ["afterDonate",  "afterDonate(address,(address,address,uint24,int24,address),uint256,uint256,bytes)"],
  ];
  for (const [name, sig] of sigs) {
    IHOOKS_SELECTORS[name] = keccak256(toBytes(sig)).slice(0, 10);
  }
}
computeSelectors();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  return {
    chainId: get("--chain") ? parseInt(get("--chain")!, 10) : undefined,
    limit: get("--limit") ? parseInt(get("--limit")!, 10) : undefined,
    revalidate: args.includes("--revalidate"),
    noPoolSkip: args.includes("--no-pool-skip"),
  };
}

// ─── Validation result ───────────────────────────────────────────────────────

interface ValidationIssue {
  category: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  description: string;
}

interface ValidationResult {
  confidence: "high" | "medium" | "low" | "unverifiable";
  method: "pool_proof" | "permissions_match" | "bytecode_match" | "permissions_mismatch" | "no_bytecode" | "unverifiable";
  issues: ValidationIssue[];
}

// ─── Layer 2: getHookPermissions() on-chain call ─────────────────────────────

async function checkHookPermissions(
  client: PublicClient,
  address: `0x${string}`,
): Promise<{ ok: boolean; mismatch: boolean; addressBitmask: number; permissionsBitmask: number } | null> {
  try {
    const result = await client.call({
      to: address,
      data: GET_HOOK_PERMISSIONS_SELECTOR,
    });

    if (!result.data || result.data === "0x" || result.data.length < 10) {
      return null; // contract didn't respond (may not implement getHookPermissions)
    }

    // Decode 14 booleans from the returned tuple
    let decoded: readonly boolean[];
    try {
      decoded = decodeAbiParameters(PERMISSIONS_ABI, result.data) as readonly boolean[];
    } catch {
      return null;
    }

    if (decoded.length < 14) return null;

    // Reconstruct bitmask from permissions in the SAME order as HOOK_FLAGS
    // Order: beforeInitialize(13), afterInitialize(12), beforeAddLiquidity(11), ...
    const PERM_TO_BIT = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    let permissionsBitmask = 0;
    for (let i = 0; i < 14; i++) {
      if (decoded[i]) permissionsBitmask |= (1 << PERM_TO_BIT[i]);
    }

    const addressBitmask = extractFlagsBitmask(address);
    const mismatch = permissionsBitmask !== addressBitmask;

    return { ok: true, mismatch, addressBitmask, permissionsBitmask };
  } catch {
    return null;
  }
}

// ─── Layer 3: Bytecode function selector scan ─────────────────────────────────

async function checkBytecodeSelectorss(
  client: PublicClient,
  address: `0x${string}`,
  flags: ReturnType<typeof decodeHookFlags>,
): Promise<{ hasBytecode: boolean; missingSelectors: string[] }> {
  let bytecode: `0x${string}`;
  try {
    const code = await client.getBytecode({ address });
    if (!code || code === "0x") {
      return { hasBytecode: false, missingSelectors: [] };
    }
    bytecode = code;
  } catch {
    return { hasBytecode: false, missingSelectors: [] };
  }

  // Extract all 4-byte values that appear as PUSH4 operands in the bytecode.
  // PUSH4 opcode = 0x63. Each occurrence is followed by 4 bytes that are a selector.
  // We also collect all raw 4-byte windows to catch jump tables and other patterns.
  const hex = bytecode.slice(2).toLowerCase();
  const foundSelectors = new Set<string>();

  // Method 1: PUSH4 operands (most reliable)
  for (let i = 0; i < hex.length - 10; i += 2) {
    const opcode = hex.slice(i, i + 2);
    if (opcode === "63") { // PUSH4
      foundSelectors.add("0x" + hex.slice(i + 2, i + 10));
    }
  }

  // Method 2: sliding 4-byte window (catches dispatch tables, JUMPI targets)
  for (let i = 0; i < hex.length - 8; i += 2) {
    foundSelectors.add("0x" + hex.slice(i, i + 8));
  }

  // Check which expected selectors are absent
  const activeCallbacks: Array<keyof ReturnType<typeof decodeHookFlags>> = [
    "beforeInitialize", "afterInitialize",
    "beforeAddLiquidity", "afterAddLiquidity",
    "beforeRemoveLiquidity", "afterRemoveLiquidity",
    "beforeSwap", "afterSwap",
    "beforeDonate", "afterDonate",
  ];

  // Delta returns callbacks share the same selector as their non-delta counterparts
  // (they're the same function with different return values), so we check the base callback.
  const deltaToBase: Record<string, string> = {
    beforeSwapReturnsDelta: "beforeSwap",
    afterSwapReturnsDelta: "afterSwap",
    afterAddLiquidityReturnsDelta: "afterAddLiquidity",
    afterRemoveLiquidityReturnsDelta: "afterRemoveLiquidity",
  };

  const missingSelectors: string[] = [];

  for (const cbName of activeCallbacks) {
    if (!flags[cbName as keyof typeof flags]) continue;
    const selector = IHOOKS_SELECTORS[cbName];
    if (!selector) continue;
    if (!foundSelectors.has(selector)) {
      missingSelectors.push(cbName);
    }
  }

  // Also check delta-return flags
  for (const [deltaFlag, baseCallback] of Object.entries(deltaToBase)) {
    if (!flags[deltaFlag as keyof typeof flags]) continue;
    const selector = IHOOKS_SELECTORS[baseCallback];
    if (!selector) continue;
    if (!foundSelectors.has(selector) && !missingSelectors.includes(baseCallback)) {
      missingSelectors.push(deltaFlag);
    }
  }

  return { hasBytecode: true, missingSelectors };
}

// ─── Main validation logic ────────────────────────────────────────────────────

async function validateHook(
  address: `0x${string}`,
  chainId: number,
  poolCount: number,
  client: PublicClient,
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];

  // Layer 1: pool-event proof — if has pools, PoolManager already validated it
  if (poolCount > 0) {
    return {
      confidence: "high",
      method: "pool_proof",
      issues: [],
    };
  }

  const flags = decodeHookFlags(address);

  // Layer 2: getHookPermissions() call
  const permCheck = await checkHookPermissions(client, address);

  if (permCheck !== null) {
    if (permCheck.mismatch) {
      issues.push({
        category: "PERMISSIONS_MISMATCH",
        severity: "CRITICAL",
        description:
          `getHookPermissions() returned bitmask 0x${permCheck.permissionsBitmask.toString(16)} ` +
          `but address encodes 0x${permCheck.addressBitmask.toString(16)}. ` +
          `The contract does not honestly report its own permissions — likely a fake or misconfigured hook.`,
      });
      return { confidence: "high", method: "permissions_mismatch", issues };
    }
    // Permissions match → medium-high confidence (doesn't prove actual implementation, just honest reporting)
    // Continue to bytecode check for full validation
  }

  // Layer 3: bytecode selector scan
  const bcCheck = await checkBytecodeSelectorss(client, address, flags);

  if (!bcCheck.hasBytecode) {
    issues.push({
      category: "NO_BYTECODE",
      severity: "CRITICAL",
      description:
        "No bytecode found at this address. The contract may have self-destructed or this is an EOA address being misrepresented as a hook.",
    });
    return { confidence: "high", method: "no_bytecode", issues };
  }

  if (bcCheck.missingSelectors.length > 0) {
    const missing = bcCheck.missingSelectors.join(", ");
    const isCritical = bcCheck.missingSelectors.length >= 3;
    issues.push({
      category: "MISSING_CALLBACK_SELECTORS",
      severity: isCritical ? "CRITICAL" : "HIGH",
      description:
        `Address claims ${bcCheck.missingSelectors.length} callback(s) in its bitmask, ` +
        `but these function selectors are absent from the bytecode: ${missing}. ` +
        `This is a strong indicator of address spoofing — the address was mined to look like a hook ` +
        `without actually implementing the callbacks.`,
    });
  }

  if (permCheck !== null && issues.length === 0) {
    // getHookPermissions matches + all selectors present
    return { confidence: "medium", method: "permissions_match", issues };
  }

  if (permCheck === null && issues.length === 0) {
    // Contract exists, selectors found, but no getHookPermissions — might be a minimal hook
    return { confidence: "low", method: "bytecode_match", issues };
  }

  return {
    confidence: issues.length > 0 ? "low" : "medium",
    method: issues.length > 0 ? "permissions_mismatch" : "permissions_match",
    issues,
  };
}

// ─── Batch runner ─────────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  const opts = parseArgs();
  const chainConfigs = buildChainConfigs();

  const clientByChain = new Map<number, PublicClient>(
    chainConfigs.map((c) => [c.chain.id, c.client])
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (opts.chainId) where.chainId = opts.chainId;
  if (!opts.revalidate) {
    where.securityFlags = { none: { source: "validator" } };
  }
  if (!opts.noPoolSkip) {
    // By default, skip hooks that have pool-event proof — they're already validated
    where.pools = { none: {} }; // hooks with 0 pools — need extra verification
  }

  const total = await prisma.hook.count({ where });
  const scanLimit = opts.limit ?? total;

  console.log(`\nHookScope Hook Validator`);
  console.log(`========================`);
  console.log(`Validating : hooks without pool-event proof`);
  console.log(`To check   : ${Math.min(total, scanLimit)}`);
  console.log(`\nComputed selectors:`);
  for (const [name, sel] of Object.entries(IHOOKS_SELECTORS)) {
    console.log(`  ${name.padEnd(30)} ${sel}`);
  }
  console.log(`  getHookPermissions()           ${GET_HOOK_PERMISSIONS_SELECTOR}`);
  console.log(``);

  let processed = 0;
  let passed = 0;
  let failed = 0;
  let unverifiable = 0;

  for (let skip = 0; skip < scanLimit; skip += 50) {
    const hooks = await prisma.hook.findMany({
      where,
      skip,
      take: Math.min(50, scanLimit - skip),
      select: {
        id: true,
        address: true,
        chainId: true,
        hookScore: true,
        riskLevel: true,
        _count: { select: { pools: true } },
      },
    });

    for (const hook of hooks) {
      process.stdout.write(`\r  [${processed + 1}/${Math.min(total, scanLimit)}] ${hook.address.slice(0, 18)}...`);

      const client = clientByChain.get(hook.chainId);
      if (!client) { unverifiable++; processed++; continue; }

      // Delete old validator flags if revalidating
      if (opts.revalidate) {
        await prisma.securityFlag.deleteMany({ where: { hookId: hook.id, source: "validator" } });
      }

      const result = await validateHook(
        hook.address as `0x${string}`,
        hook.chainId,
        hook._count.pools,
        client,
      );

      if (result.issues.length > 0) {
        failed++;

        // Store flags
        await prisma.securityFlag.createMany({
          data: result.issues.map((issue) => ({
            hookId: hook.id,
            category: issue.category,
            severity: issue.severity,
            description: issue.description,
            source: "validator",
            reportedBy: `HookScope Validator (${result.method})`,
          })),
          skipDuplicates: true,
        });

        // Escalate risk + flag audit status
        const hasCritical = result.issues.some((i) => i.severity === "CRITICAL");
        await prisma.hook.update({
          where: { id: hook.id },
          data: {
            riskLevel: hasCritical ? "CRITICAL" : "HIGH",
            auditStatus: "FLAGGED",
          },
        });

        process.stdout.write(` ✗ ${result.issues.map((i) => i.category).join(", ")}`);
      } else if (result.confidence === "unverifiable") {
        unverifiable++;
      } else {
        passed++;
        // Add a positive validation marker
        await prisma.securityFlag.create({
          data: {
            hookId: hook.id,
            category: "HOOK_VALIDATED",
            severity: "LOW",
            description: `Hook validated as genuine Uniswap v4 contract via ${result.method} (confidence: ${result.confidence}).`,
            source: "validator",
            reportedBy: `HookScope Validator (${result.method})`,
          },
        });
      }

      processed++;
      await sleep(200); // ~5 req/sec per RPC
    }
  }

  console.log(`\n\n=== Validation Results ===`);
  console.log(`  Processed      : ${processed}`);
  console.log(`  Passed         : ${passed}`);
  console.log(`  Failed (fake)  : ${failed}`);
  console.log(`  Unverifiable   : ${unverifiable}`);

  // Summary of fake hook categories
  const fakeSummary = await prisma.securityFlag.groupBy({
    by: ["category"],
    where: { source: "validator", category: { not: "HOOK_VALIDATED" } },
    _count: { id: true },
  });

  if (fakeSummary.length > 0) {
    console.log(`\n  Fake hook indicators found:`);
    for (const row of fakeSummary) {
      console.log(`    ${row.category.padEnd(30)} ${row._count.id}`);
    }
  }

  console.log(`\n✅ Validation complete!`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});