import { execFile } from "node:child_process";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { computeHookScore } from "@hookscope/analyzer";

const execFileAsync = promisify(execFile);

interface SlitherFinding {
  check: string;
  impact: "High" | "Medium" | "Low" | "Informational" | "Optimization";
  confidence: "High" | "Medium" | "Low";
  description: string;
  elements: Array<{
    type: string;
    name: string;
    source_mapping?: {
      filename: string;
      start: number;
      length: number;
    };
  }>;
}

interface SlitherOutput {
  success: boolean;
  error: string | null;
  results?: {
    detectors?: SlitherFinding[];
  };
}

/**
 * Wraps Slither static analysis tool for Solidity smart contracts.
 *
 * Slither must be installed: pip install slither-analyzer
 * Source code must be available (verified on Etherscan or local files).
 *
 * Falls back gracefully if Slither is not installed.
 */
export class SlitherScanner {
  constructor(private readonly prisma: PrismaClient) {}

  async scan(address: string, chainId: number): Promise<void> {
    const hook = await this.prisma.hook.findUnique({
      where: { address_chainId: { address: address.toLowerCase(), chainId } },
      include: { sourceFiles: true, securityReport: true },
    });

    if (!hook) {
      console.warn(`[Slither] Hook not found: ${address}`);
      return;
    }

    if (!hook.sourceFiles.length) {
      console.log(`[Slither] No source files for ${address}, skipping`);
      return;
    }

    // Check if Slither is installed
    const slitherAvailable = await this.checkSlitherInstalled();
    if (!slitherAvailable) {
      console.warn("[Slither] slither-analyzer not installed. Run: pip install slither-analyzer");
      return;
    }

    // Write source files to temp directory
    const workDir = join(tmpdir(), `hookscope-${hook.id}`);
    await mkdir(workDir, { recursive: true });

    try {
      // Write all source files
      for (const sf of hook.sourceFiles) {
        const safeName = sf.fileName.replace(/[^a-zA-Z0-9._/-]/g, "_");
        const filePath = join(workDir, safeName);
        await mkdir(join(filePath, ".."), { recursive: true });
        await writeFile(filePath, sf.content);
      }

      // Find the main contract file (usually the one with the contract name matching the hook)
      const mainFile = hook.sourceFiles.find((sf) =>
        sf.fileName.endsWith(".sol") && !sf.fileName.includes("/")
      ) ?? hook.sourceFiles[0];

      const mainFilePath = join(workDir, mainFile.fileName);

      // Run Slither
      const findings = await this.runSlither(mainFilePath, workDir);

      // Compute updated score with findings
      const criticalCount = findings.filter((f) => f.impact === "High").length;
      const highCount = findings.filter((f) => f.impact === "High").length;
      const mediumCount = findings.filter((f) => f.impact === "Medium").length;
      const lowCount = findings.filter((f) => f.impact === "Low").length;
      const infoCount = findings.filter((f) => f.impact === "Informational").length;

      const newScore = computeHookScore({
        hasVerifiedSource: true,
        hasSelfdestruct: hook.securityReport?.hasSelfdestruct ?? false,
        hasDelegatecall: hook.securityReport?.hasDelegatecall ?? false,
        hasUpgradeable: hook.securityReport?.hasUpgradeable ?? false,
        usesDeltaReturns:
          hook.beforeSwapReturnsDelta ||
          hook.afterSwapReturnsDelta ||
          hook.afterAddLiquidityReturnsDelta ||
          hook.afterRemoveLiquidityReturnsDelta,
        callbackRiskScore: hook.securityReport?.callbackScore ?? 0,
        criticalFindings: criticalCount,
        highFindings: highCount,
        mediumFindings: mediumCount,
      });

      const riskLevel = scoreToRiskLevel(newScore);

      await this.prisma.$transaction(async (tx) => {
        // Update security report
        await tx.securityReport.upsert({
          where: { hookId: hook.id },
          create: {
            hookId: hook.id,
            score: newScore,
            callbackScore: hook.securityReport?.callbackScore ?? 0,
            slitherRaw: findings as unknown as object,
            findings: findings.length,
            criticalCount,
            highCount,
            mediumCount,
            lowCount,
            infoCount,
            hasSelfdestruct: hook.securityReport?.hasSelfdestruct ?? false,
            hasDelegatecall: hook.securityReport?.hasDelegatecall ?? false,
            hasUpgradeable: hook.securityReport?.hasUpgradeable ?? false,
            hasReentrancy: findings.some((f) => f.check.includes("reentrancy")),
            hasFlashLoan: findings.some((f) => f.check.includes("flash")),
          },
          update: {
            score: newScore,
            slitherRaw: findings as unknown as object,
            findings: findings.length,
            criticalCount,
            highCount,
            mediumCount,
            lowCount,
            infoCount,
            hasReentrancy: findings.some((f) => f.check.includes("reentrancy")),
            hasFlashLoan: findings.some((f) => f.check.includes("flash")),
            analyzedAt: new Date(),
          },
        });

        // Update hook score
        await tx.hook.update({
          where: { id: hook.id },
          data: { hookScore: newScore, riskLevel },
        });

        // Save individual findings as security flags
        for (const finding of findings.slice(0, 50)) {
          const category = finding.check.toUpperCase().replace(/-/g, "_");
          const severity = impactToSeverity(finding.impact);
          const location = finding.elements?.[0]?.source_mapping?.filename;

          await tx.securityFlag.create({
            data: {
              hookId: hook.id,
              category,
              severity,
              description: finding.description.slice(0, 500),
              location,
              source: "slither",
            },
          });
        }
      });

      console.log(`[Slither] Done: ${address} — ${findings.length} findings, score: ${newScore}`);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async runSlither(mainFile: string, workDir: string): Promise<SlitherFinding[]> {
    try {
      const { stdout } = await execFileAsync("slither", [
        mainFile,
        "--json", "-",
        "--disable-color",
        "--exclude-informational",
        "--solc-remaps", `@openzeppelin=${workDir}/node_modules/@openzeppelin`,
      ], {
        cwd: workDir,
        timeout: 120_000, // 2 minute timeout
      });

      const output = JSON.parse(stdout) as SlitherOutput;
      return output.results?.detectors ?? [];
    } catch (err: unknown) {
      // Slither exits with non-zero when findings exist; stdout still has JSON
      const execErr = err as { stdout?: string };
      if (execErr.stdout) {
        try {
          const output = JSON.parse(execErr.stdout) as SlitherOutput;
          return output.results?.detectors ?? [];
        } catch {
          // JSON parse failed
        }
      }
      console.error("[Slither] Execution error:", err);
      return [];
    }
  }

  private async checkSlitherInstalled(): Promise<boolean> {
    try {
      await execFileAsync("slither", ["--version"], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}

function impactToSeverity(
  impact: string
): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN" {
  switch (impact) {
    case "High":         return "HIGH";
    case "Medium":       return "MEDIUM";
    case "Low":          return "LOW";
    case "Informational": return "LOW";
    default:             return "UNKNOWN";
  }
}

function scoreToRiskLevel(
  score: number
): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN" {
  if (score >= 80) return "LOW";
  if (score >= 60) return "MEDIUM";
  if (score >= 40) return "HIGH";
  return "CRITICAL";
}
