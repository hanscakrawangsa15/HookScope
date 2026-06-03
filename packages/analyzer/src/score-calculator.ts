/**
 * HookScore™ — 0 to 100, higher = safer.
 *
 * Scoring dimensions:
 * - Source verification (major trust signal)
 * - Dangerous opcodes (selfdestruct, delegatecall)
 * - Upgradeability (proxy pattern without timelock)
 * - Callback risk (which lifecycle hooks are active + delta returns)
 * - Known vulnerabilities from static analysis
 */

export interface ScoringInput {
  hasVerifiedSource: boolean;
  hasSelfdestruct: boolean;
  hasDelegatecall: boolean;
  hasUpgradeable: boolean;
  usesDeltaReturns: boolean;
  callbackRiskScore: number; // 0-100 from hook-decoder
  criticalFindings: number;
  highFindings: number;
  mediumFindings?: number;
  isAudited?: boolean;
}

export function computeHookScore(input: ScoringInput): number {
  let score = 100;

  // Source verification: -30 if unverified (no way to audit what it does)
  if (!input.hasVerifiedSource) score -= 30;

  // Critical danger: selfdestruct can permanently destroy pools
  if (input.hasSelfdestruct) score -= 40;

  // High danger: delegatecall enables arbitrary code execution
  if (input.hasDelegatecall) score -= 25;

  // Upgradeability: logic can change post-deploy
  if (input.hasUpgradeable) score -= 15;

  // Delta returns: can intercept and redirect token flows
  if (input.usesDeltaReturns) score -= 10;

  // Callback risk (normalised from 0-100 to 0-20 penalty)
  score -= Math.floor(input.callbackRiskScore * 0.2);

  // Static analysis findings
  score -= input.criticalFindings * 20;
  score -= input.highFindings * 10;
  score -= (input.mediumFindings ?? 0) * 3;

  // Audit bonus
  if (input.isAudited) score = Math.min(100, score + 15);

  return Math.max(0, Math.min(100, score));
}

export function scoreToLabel(score: number): string {
  if (score >= 80) return "LOW RISK";
  if (score >= 60) return "MEDIUM RISK";
  if (score >= 40) return "HIGH RISK";
  return "CRITICAL RISK";
}

export function scoreToColor(score: number): string {
  if (score >= 80) return "green";
  if (score >= 60) return "yellow";
  if (score >= 40) return "orange";
  return "red";
}
