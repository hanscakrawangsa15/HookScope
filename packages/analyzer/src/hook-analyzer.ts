import { type PublicClient, type Address } from "viem";
import { PrismaClient } from "@prisma/client";
import {
  decodeHookFlags,
  callbackRiskScore,
  usesDeltaReturns,
} from "@hookscope/shared";
import { detectProxy } from "./proxy-detector.js";
import { fetchVerifiedSource, fetchDeployerInfo } from "./etherscan-client.js";
import { analyzeBytecode } from "./bytecode-analyzer.js";
import { computeHookScore } from "./score-calculator.js";

/**
 * Main analysis engine for a single hook contract.
 *
 * Execution order:
 * 1. Decode callbacks from address (always works)
 * 2. Detect proxy type + resolve implementation
 * 3. Analyze bytecode (dangerous opcodes, selectors) — works without source
 * 4. Fetch verified source + ABI from Etherscan (if available)
 * 5. Compute HookScore™
 * 6. Persist all findings to DB
 */
export class HookAnalyzer {
  constructor(
    private readonly client: PublicClient,
    private readonly chainId: number,
    private readonly prisma: PrismaClient
  ) {}

  async analyze(address: Address, explorerApiKey?: string): Promise<void> {
    console.log(`[Analyzer] Analyzing hook: ${address} (chain ${this.chainId})`);

    const hook = await this.prisma.hook.findUnique({
      where: { address_chainId: { address: address.toLowerCase(), chainId: this.chainId } },
    });
    if (!hook) {
      console.warn(`[Analyzer] Hook not found in DB: ${address}`);
      return;
    }

    // ── 1. Proxy detection ────────────────────────────────────────────────
    const proxyInfo = await detectProxy(this.client, address);
    const effectiveAddress = proxyInfo.implementationAddress ?? address;

    // ── 2. Bytecode analysis ──────────────────────────────────────────────
    const bytecodeResult = await analyzeBytecode(this.client, effectiveAddress);

    // ── 3. Source code + ABI (Etherscan) ──────────────────────────────────
    const sourceResult = await fetchVerifiedSource(
      effectiveAddress,
      this.chainId,
      explorerApiKey
    );

    // ── 4. Deployer info ──────────────────────────────────────────────────
    const deployerInfo = !hook.deployer
      ? await fetchDeployerInfo(address, this.chainId, explorerApiKey)
      : null;

    // ── 5. Callbacks (from address bitmask — always authoritative) ────────
    const callbacks = decodeHookFlags(address);

    // ── 6. Score calculation ──────────────────────────────────────────────
    const cbRiskScore = callbackRiskScore(callbacks);
    const hookScore = computeHookScore({
      hasVerifiedSource: !!sourceResult,
      hasSelfdestruct: bytecodeResult.hasSelfdestruct,
      hasDelegatecall: bytecodeResult.hasDelegatecall,
      hasUpgradeable: proxyInfo.proxyType !== "NONE",
      usesDeltaReturns: usesDeltaReturns(callbacks),
      callbackRiskScore: cbRiskScore,
      criticalFindings: 0,
      highFindings: 0,
    });

    const riskLevel = scoreToRiskLevel(hookScore);

    // ── 7. Persist to database ────────────────────────────────────────────
    await this.prisma.$transaction(async (tx) => {
      // Update hook
      await tx.hook.update({
        where: { id: hook.id },
        data: {
          bytecodeHash: bytecodeResult.bytecodeHash,
          isVerified: !!sourceResult,
          proxyType: proxyInfo.proxyType,
          implementationAddress: proxyInfo.implementationAddress?.toLowerCase(),
          deployer: deployerInfo?.deployer?.toLowerCase() ?? hook.deployer,
          deployTxHash: deployerInfo?.txHash ?? hook.deployTxHash,
          name: sourceResult?.contractName ?? hook.name,
          riskLevel,
          hookScore,
          lastAnalyzedAt: new Date(),
        },
      });

      // Source files
      if (sourceResult?.sourceFiles?.length) {
        await tx.sourceFile.deleteMany({ where: { hookId: hook.id } });
        await tx.sourceFile.createMany({
          data: sourceResult.sourceFiles.map((sf) => ({
            hookId: hook.id,
            fileName: sf.name,
            content: sf.content,
            language: sf.language,
          })),
        });
      }

      // Functions from ABI
      if (sourceResult?.abi?.length) {
        await tx.hookFunction.deleteMany({ where: { hookId: hook.id } });
        const abiFunctions = (sourceResult.abi as AbiItem[])
          .filter((item) => item.type === "function");

        for (const fn of abiFunctions) {
          const sig = buildSignature(fn);
          const selector = computeSelector(sig);
          await tx.hookFunction.upsert({
            where: { hookId_selector: { hookId: hook.id, selector } },
            create: {
              hookId: hook.id,
              name: fn.name,
              signature: sig,
              selector,
              params: fn.inputs ?? [],
              returns: fn.outputs ?? [],
              visibility: "public",
              stateMutability: fn.stateMutability ?? "nonpayable",
              isCallback: isHookCallback(fn.name),
            },
            update: {},
          });
        }
      }

      // Security report (basic — full Slither scan is a separate job)
      await tx.securityReport.upsert({
        where: { hookId: hook.id },
        create: {
          hookId: hook.id,
          score: hookScore,
          callbackScore: cbRiskScore,
          hasSelfdestruct: bytecodeResult.hasSelfdestruct,
          hasDelegatecall: bytecodeResult.hasDelegatecall,
          hasUpgradeable: proxyInfo.proxyType !== "NONE",
        },
        update: {
          score: hookScore,
          callbackScore: cbRiskScore,
          hasSelfdestruct: bytecodeResult.hasSelfdestruct,
          hasDelegatecall: bytecodeResult.hasDelegatecall,
          hasUpgradeable: proxyInfo.proxyType !== "NONE",
          analyzedAt: new Date(),
        },
      });

      // Security flags for dangerous patterns
      const flags = buildSecurityFlags(hook.id, bytecodeResult, proxyInfo);
      for (const flag of flags) {
        await tx.securityFlag.upsert({
          where: {
            id: `${hook.id}-${flag.category}`,
          },
          create: { id: `${hook.id}-${flag.category}`, ...flag },
          update: flag,
        });
      }
    });

    console.log(`[Analyzer] Done: ${address} (score: ${hookScore}, risk: ${riskLevel})`);
  }

  async securityScan(address: Address): Promise<void> {
    // Full Slither scan — delegated to scanner package
    const { SlitherScanner } = await import("@hookscope/scanner");
    const scanner = new SlitherScanner(this.prisma);
    await scanner.scan(address, this.chainId);
  }

  async refreshAnalytics(address: Address): Promise<void> {
    const hook = await this.prisma.hook.findUnique({
      where: { address_chainId: { address: address.toLowerCase(), chainId: this.chainId } },
      include: { pools: true },
    });
    if (!hook) return;

    const poolCount = hook.pools.length;

    await this.prisma.hookAnalytics.upsert({
      where: { hookId: hook.id },
      create: {
        hookId: hook.id,
        poolCount,
        updatedAt: new Date(),
      },
      update: {
        poolCount,
        updatedAt: new Date(),
      },
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface AbiItem {
  type: string;
  name: string;
  inputs?: Array<{ name: string; type: string }>;
  outputs?: Array<{ name: string; type: string }>;
  stateMutability?: string;
}

function buildSignature(fn: AbiItem): string {
  const params = (fn.inputs ?? []).map((p) => p.type).join(",");
  return `${fn.name}(${params})`;
}

function computeSelector(signature: string): string {
  const { keccak256, toHex } = require("viem");
  const hash = keccak256(toHex(signature) as `0x${string}`);
  return hash.slice(0, 10); // 0x + 4 bytes
}

const HOOK_CALLBACK_NAMES = new Set([
  "beforeInitialize", "afterInitialize",
  "beforeAddLiquidity", "afterAddLiquidity",
  "beforeRemoveLiquidity", "afterRemoveLiquidity",
  "beforeSwap", "afterSwap",
  "beforeDonate", "afterDonate",
]);

function isHookCallback(name: string): boolean {
  return HOOK_CALLBACK_NAMES.has(name);
}

function scoreToRiskLevel(score: number): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN" {
  if (score >= 80) return "LOW";
  if (score >= 60) return "MEDIUM";
  if (score >= 40) return "HIGH";
  return "CRITICAL";
}

function buildSecurityFlags(
  hookId: string,
  bytecodeResult: { hasSelfdestruct: boolean; hasDelegatecall: boolean },
  proxyInfo: { proxyType: string }
): Array<{
  hookId: string;
  category: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";
  description: string;
  source: string;
}> {
  const flags = [];

  if (bytecodeResult.hasSelfdestruct) {
    flags.push({
      hookId,
      category: "SELFDESTRUCT",
      severity: "CRITICAL" as const,
      description: "Hook contains SELFDESTRUCT opcode — contract can be permanently destroyed, locking all funds in pools that use it.",
      source: "bytecode",
    });
  }

  if (bytecodeResult.hasDelegatecall) {
    flags.push({
      hookId,
      category: "DELEGATECALL",
      severity: "HIGH" as const,
      description: "Hook uses DELEGATECALL — execution context can be hijacked if the called contract is malicious or upgradeable.",
      source: "bytecode",
    });
  }

  if (proxyInfo.proxyType !== "NONE") {
    flags.push({
      hookId,
      category: "UPGRADEABLE",
      severity: "MEDIUM" as const,
      description: `Hook is a ${proxyInfo.proxyType} proxy — logic can be changed by the owner after deployment. Verify timelock controls.`,
      source: "bytecode",
    });
  }

  return flags;
}
