import { notFound } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { api } from "@/lib/api";
import { ORCA_WHIRLPOOL_PROGRAM_ID, RAYDIUM_CLMM_PROGRAM_ID, RAYDIUM_AMM_V4_PROGRAM_ID, RAYDIUM_CPMM_PROGRAM_ID } from "@hookscope/shared";
import { RiskBadge } from "@/components/ui/risk-badge";
import { HookCard } from "@/components/hooks/hook-card";
import { CALLBACK_DOCS, getRiskColor, getCategoryColor } from "@/lib/callback-docs";
import { HookAnalyticsPanel } from "@/components/analytics/hook-analytics-panel";
import { LpMetricsPanel } from "@/components/analytics/lp-metrics-panel";
import { SwapPanel } from "@/components/swap/swap-panel";
import { SolanaSwapPanel } from "@/components/swap/solana-swap-panel";
import { AddLiquidityPanel } from "@/components/liquidity/add-liquidity-panel";
import { SolanaAddLiquidityPanel } from "@/components/liquidity/solana-add-liquidity-panel";
import { RaydiumAddLiquidityPanel } from "@/components/liquidity/raydium-add-liquidity-panel";
import { SimpleAddLiquidityPanel } from "@/components/liquidity/simple-add-liquidity-panel";
import { TradingPanelTabs } from "@/components/liquidity/trading-panel-tabs";
import { describeHook } from "@/lib/hook-descriptor";
import { SourceViewer } from "@/components/hooks/source-viewer";
import { AbiExplorer } from "@/components/hooks/abi-explorer";
import { CodeSnippets } from "@/components/hooks/code-snippets";
import { shortAddress, chainName, chainIcon, formatTvl, timeAgo, cn } from "@/lib/utils";
import {
  ExternalLink, ShieldCheck, AlertTriangle,
  Code2, GitCompare, Info, CheckCircle2, XCircle, ChevronDown, Droplets,
  ShieldAlert, Skull, ThumbsUp, ThumbsDown, Lightbulb, FileCode, Terminal
} from "lucide-react";

const CallbackConstellation = dynamic(
  () => import("@/components/three/callback-constellation").then((m) => ({ default: m.CallbackConstellation })),
  { ssr: false, loading: () => <div className="h-full shimmer rounded-2xl" /> }
);

interface PageProps {
  params: { address: string };
  searchParams: Record<string, string | string[] | undefined>;
}

export async function generateMetadata({ params }: PageProps) {
  try {
    const hook = await api.hooks.get(params.address);
    return {
      title: hook.name ?? shortAddress(hook.address),
      description: hook.description ?? `Uniswap v4 Hook — ${hook.address}`,
    };
  } catch {
    return { title: "Hook Detail" };
  }
}

export default async function HookDetailPage({ params, searchParams }: PageProps) {
  const chainId = searchParams.chain
    ? Number(Array.isArray(searchParams.chain) ? searchParams.chain[0] : searchParams.chain)
    : undefined;

  let hook;
  try {
    hook = await api.hooks.get(params.address, chainId);
  } catch {
    notFound();
  }

  const explorerBase: Record<number, string> = {
    1: "https://etherscan.io/address",
    8453: "https://basescan.org/address",
    42161: "https://arbiscan.io/address",
    10: "https://optimistic.etherscan.io/address",
    1399811149: "https://solscan.io/account",
  };
  const explorerUrl = `${explorerBase[hook.chainId] ?? "https://etherscan.io/address"}/${hook.address}`;
  const isSolana = hook.chainId === 1399811149;
  // Solana addresses are base58 and case-sensitive — unlike EVM hex addresses,
  // never lowercase these for comparison.
  const isOrcaWhirlpool = hook.address === ORCA_WHIRLPOOL_PROGRAM_ID;
  const isRaydiumClmm = hook.address === RAYDIUM_CLMM_PROGRAM_ID;
  const isRaydiumAmm = hook.address === RAYDIUM_AMM_V4_PROGRAM_ID;
  const isRaydiumCpmm = hook.address === RAYDIUM_CPMM_PROGRAM_ID;

  const activeCallbacks = Object.entries(hook.callbacks)
    .filter(([, v]) => v)
    .map(([k]) => k);

  // Solana programs have all swap/liquidity callbacks set but they are not EVM risk flags
  const hasWarning = !isSolana && activeCallbacks.some((cb) => CALLBACK_DOCS[cb]?.risk === "high");
  const hasDeltaReturns = !isSolana && activeCallbacks.some((cb) => CALLBACK_DOCS[cb]?.category === "delta");

  // Auto-generate hook description from on-chain data
  const hookDesc = describeHook({
    callbacks:   hook.callbacks,
    riskLevel:   hook.riskLevel,
    hookScore:   hook.hookScore,
    proxyType:   hook.proxyType,
    isVerified:  hook.isVerified,
    auditStatus: hook.auditStatus,
    poolCount:   hook.poolCount,
    tvlUsd:      hook.tvlUsd,
    chainId:     hook.chainId,
    name:        hook.name,
  });

  // Threat intelligence flags (sourced from GoPlus Security API)
  const CRITICAL_THREAT_CATEGORIES = new Set([
    "PHISHING", "SANCTIONED", "CYBERCRIME", "HONEYPOT",
  ]);
  const HIGH_THREAT_CATEGORIES = new Set([
    "FINANCIAL_CRIME", "MONEY_LAUNDERING", "DARKWEB", "BLACKMAIL",
    "FAKE_KYC", "FAKE_TOKEN", "REINIT_ATTACK", "MALICIOUS_DEPLOYER",
  ]);
  const threatFlags = hook.securityFlags.filter((f) => f.source === "goplus");
  const criticalThreats = threatFlags.filter((f) => CRITICAL_THREAT_CATEGORIES.has(f.category));
  const highThreats = threatFlags.filter((f) => HIGH_THREAT_CATEGORIES.has(f.category));
  const hasThreatFlags = threatFlags.length > 0;

  // Human-readable labels for threat categories
  const THREAT_LABELS: Record<string, string> = {
    PHISHING: "Phishing / Address Poisoning",
    SANCTIONED: "Sanctioned Address",
    CYBERCRIME: "Cybercrime",
    HONEYPOT: "Honeypot",
    FINANCIAL_CRIME: "Financial Crime",
    MONEY_LAUNDERING: "Money Laundering",
    DARKWEB: "Dark Web Activity",
    BLACKMAIL: "Blackmail / Extortion",
    FAKE_KYC: "Fake KYC",
    FAKE_TOKEN: "Fake Token",
    REINIT_ATTACK: "Reinitialization Attack",
    MALICIOUS_DEPLOYER: "Malicious Deployer",
    MIXER: "Cryptocurrency Mixer",
    MALICIOUS_MINING: "Malicious Mining",
    GAS_ABUSE: "Gas Abuse",
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

      {/* ─── Threat Intel Banner (full-width, above everything) ─── */}
      {hasThreatFlags && (
        <div className={cn(
          "mb-6 rounded-xl border p-4",
          criticalThreats.length > 0
            ? "bg-red-950/60 border-red-500/40"
            : highThreats.length > 0
            ? "bg-orange-950/50 border-orange-500/40"
            : "bg-yellow-950/40 border-yellow-500/30"
        )}>
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              {criticalThreats.length > 0
                ? <Skull size={18} className="text-red-400" />
                : <ShieldAlert size={18} className="text-orange-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className={cn(
                "font-semibold text-sm mb-1",
                criticalThreats.length > 0 ? "text-red-300"
                  : highThreats.length > 0 ? "text-orange-300"
                  : "text-yellow-300"
              )}>
                {criticalThreats.length > 0
                  ? "Peringatan: Alamat ini dilaporkan terlibat dalam aktivitas berbahaya"
                  : "Perhatian: Alamat ini memiliki sinyal keamanan negatif"}
              </p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {threatFlags.map((f) => (
                  <span key={f.id} className={cn(
                    "inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border",
                    f.severity === "CRITICAL"
                      ? "bg-red-500/15 text-red-300 border-red-500/30"
                      : f.severity === "HIGH"
                      ? "bg-orange-500/15 text-orange-300 border-orange-500/30"
                      : "bg-yellow-500/15 text-yellow-300 border-yellow-500/30"
                  )}>
                    {THREAT_LABELS[f.category] ?? f.category}
                  </span>
                ))}
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                Data dari{" "}
                <span className="text-gray-300">
                  {[...new Set(threatFlags.flatMap((f) => (f.reportedBy ?? "GoPlus").split(", ")))].join(", ")}
                </span>
                {" "}— GoPlus Security API.{" "}
                Harap berhati-hati saat berinteraksi dengan pool yang menggunakan hook ini.
                Lakukan verifikasi independen sebelum menyetorkan dana.
              </p>
            </div>
          </div>
          {/* Per-flag details */}
          {threatFlags.map((f) => (
            <div key={f.id} className="mt-3 pt-3 border-t border-white/5 text-xs text-gray-400 leading-relaxed">
              <span className={cn(
                "font-semibold mr-2",
                f.severity === "CRITICAL" ? "text-red-300"
                  : f.severity === "HIGH" ? "text-orange-300"
                  : "text-yellow-300"
              )}>
                [{THREAT_LABELS[f.category] ?? f.category}]
              </span>
              {f.description}
            </div>
          ))}
        </div>
      )}

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
        <Link href="/dashboard" className="hover:text-white transition-colors">Explorer</Link>
        <span>/</span>
        <span className="text-gray-300 font-mono text-xs">{shortAddress(hook.address, 10)}</span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-6 mb-8">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold text-white">
              {hook.name ?? "Unnamed Hook"}
            </h1>
            {hook.isVerified && (
              <span className="badge bg-green-500/10 text-green-400 border-green-500/20 text-xs">
                <ShieldCheck size={11} className="mr-1" /> VERIFIED
              </span>
            )}
            <RiskBadge level={hook.riskLevel} score={hook.hookScore} size="md" />
          </div>

          <div className="flex items-center gap-2 font-mono text-sm text-gray-400 mt-1 flex-wrap">
            <span className="break-all">{hook.address}</span>
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer" title="View on explorer">
              <ExternalLink size={13} className="text-gray-500 hover:text-blue-400 transition-colors flex-shrink-0" />
            </a>
          </div>

          <div className="flex flex-wrap gap-4 mt-3 text-sm text-gray-400">
            <span>{chainIcon(hook.chainId)} {chainName(hook.chainId)}</span>
            {hook.deployedAt && <span>Deployed {timeAgo(hook.deployedAt)}</span>}
            {hook.deployer && <span>by <span className="font-mono">{shortAddress(hook.deployer)}</span></span>}
            <span>{hook.poolCount} pool{hook.poolCount !== 1 ? "s" : ""}</span>
            {hook.tvlUsd != null && <span>TVL: {formatTvl(hook.tvlUsd)}</span>}
          </div>

          {/* Proxy warning */}
          {hook.proxyType !== "NONE" && (
            <div className="mt-3 flex items-center gap-2 text-sm p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 w-fit">
              <AlertTriangle size={14} className="text-yellow-400 flex-shrink-0" />
              <span className="text-yellow-300">
                {hook.proxyType} Proxy — logic dapat diupgrade oleh owner
              </span>
              {hook.implementationAddress && (
                <Link href={`/hooks/${hook.implementationAddress}?chain=${hook.chainId}`}
                  className="text-blue-400 hover:underline font-mono text-xs">
                  impl: {shortAddress(hook.implementationAddress)}
                </Link>
              )}
            </div>
          )}

          {/* High-risk warning */}
          {hasWarning && (
            <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <div className="flex items-center gap-2 text-red-400 text-sm font-semibold mb-1">
                <AlertTriangle size={14} /> Peringatan Risiko Tinggi
              </div>
              <p className="text-xs text-red-300">
                Hook ini mengimplementasikan callback berisiko tinggi yang dapat mengubah aliran token atau memblokir operasi.
                Wajib review source code sebelum berinteraksi dengan pool yang menggunakan hook ini.
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-2 flex-shrink-0">
          <a href="#add-liquidity" className="btn-primary text-sm">
            <Droplets size={14} /> Add Liquidity
          </a>
          <Link href={`/compare?addresses=${hook.address}`} className="btn-ghost text-sm">
            <GitCompare size={14} /> Compare
          </Link>
          <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost text-sm">
            <ExternalLink size={14} /> Explorer
          </a>
        </div>
      </div>

      {/* ─── Live Analytics — full width ── */}
      <HookAnalyticsPanel address={hook.address} />

      {/* ─── Hook Descriptor — archetype + pros/cons ── */}
      <section className="card p-5 mb-6">
        {/* Archetype badge + summary */}
        <div className="flex items-start gap-4 mb-4">
          <div className="text-3xl flex-shrink-0 leading-none mt-0.5">{hookDesc.icon}</div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className="text-sm font-bold text-white">{hookDesc.archetype}</span>
              <span className="badge text-[10px] font-semibold"
                style={{ background: hookDesc.archetypeColor + "20", border: `1px solid ${hookDesc.archetypeColor}50`, color: hookDesc.archetypeColor }}>
                {hookDesc.archetypeId.replace(/_/g, " ").toUpperCase()}
              </span>
            </div>
            <p className="text-sm text-gray-300 leading-relaxed">{hookDesc.summary}</p>
          </div>
        </div>

        {/* Risk summary bar */}
        <div className="mb-4 px-3 py-2 rounded-xl text-xs leading-relaxed"
          style={{
            background: hook.riskLevel === "CRITICAL" ? "rgba(239,68,68,0.08)" : hook.riskLevel === "HIGH" ? "rgba(249,115,22,0.08)" : hook.riskLevel === "MEDIUM" ? "rgba(234,179,8,0.08)" : "rgba(34,197,94,0.06)",
            border: `1px solid ${hook.riskLevel === "CRITICAL" ? "rgba(239,68,68,0.2)" : hook.riskLevel === "HIGH" ? "rgba(249,115,22,0.2)" : hook.riskLevel === "MEDIUM" ? "rgba(234,179,8,0.2)" : "rgba(34,197,94,0.15)"}`,
            color: hook.riskLevel === "CRITICAL" ? "#fca5a5" : hook.riskLevel === "HIGH" ? "#fdba74" : hook.riskLevel === "MEDIUM" ? "#fde047" : "#86efac",
          }}>
          {hookDesc.riskSummary}
        </div>

        {/* Pros / Cons grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Pros */}
          <div>
            <p className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <ThumbsUp size={11} /> Kelebihan
            </p>
            <ul className="space-y-1.5">
              {hookDesc.pros.map((p, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-300">
                  <span className="text-emerald-500 flex-shrink-0 mt-0.5 text-[10px]">✓</span>
                  {p}
                </li>
              ))}
              {hookDesc.pros.length === 0 && (
                <li className="text-xs text-gray-600">Tidak ada kelebihan yang terdeteksi</li>
              )}
            </ul>
          </div>

          {/* Cons */}
          <div>
            <p className="text-[11px] font-bold text-red-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <ThumbsDown size={11} /> Kekurangan
            </p>
            <ul className="space-y-1.5">
              {hookDesc.cons.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-300">
                  <span className="text-red-500 flex-shrink-0 mt-0.5 text-[10px]">✗</span>
                  {c}
                </li>
              ))}
              {hookDesc.cons.length === 0 && (
                <li className="text-xs text-gray-600">Tidak ada kekurangan yang terdeteksi</li>
              )}
            </ul>
          </div>
        </div>

        {/* Usage tip */}
        <div className="mt-4 flex items-start gap-2 text-xs text-gray-500 pt-3 border-t border-white/5">
          <Lightbulb size={12} className="text-yellow-500 flex-shrink-0 mt-0.5" />
          {hookDesc.usageNote}
        </div>
      </section>

      {/* Main layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ─── Left column ─────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Callbacks dengan penjelasan */}
          <section className="card p-6">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">
              {isSolana ? "Program Capabilities" : `Active Callbacks (${activeCallbacks.length}/14)`}
            </h2>
            <p className="text-xs text-gray-500 mb-5">
              {isSolana
                ? "Operasi lifecycle yang diimplementasikan oleh program Solana ini."
                : "Decoded dari 14 bit terakhir address — tidak bisa dipalsukan setelah deploy."}
            </p>

            {activeCallbacks.length === 0 ? (
              <p className="text-gray-500 text-sm">Tidak ada callback aktif (no-op hook)</p>
            ) : (
              <div className="space-y-3">
                {activeCallbacks.map((cbName) => {
                  const doc = CALLBACK_DOCS[cbName];
                  if (!doc) return null;
                  return (
                    <div key={cbName} className={cn(
                      "rounded-xl border p-4",
                      doc.category === "delta"
                        ? "bg-purple-500/5 border-purple-500/20"
                        : doc.risk === "high"
                        ? "bg-orange-500/5 border-orange-500/20"
                        : "bg-white/3 border-white/10"
                    )}>
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="font-mono text-sm font-semibold text-white">
                              {doc.label}
                            </span>
                            <span className={cn("badge text-[10px] border", getCategoryColor(doc.category))}>
                              {doc.category.toUpperCase()}
                            </span>
                            <span className={cn("badge text-[10px] border", getRiskColor(doc.risk))}>
                              {doc.risk.toUpperCase()} RISK
                            </span>
                          </div>
                          <p className="text-xs text-gray-300 leading-relaxed mb-2">{doc.description}</p>

                          {/* Use cases */}
                          <div className="flex flex-wrap gap-1.5">
                            {doc.useCases.map((uc) => (
                              <span key={uc} className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-gray-400 border border-white/10">
                                {uc}
                              </span>
                            ))}
                          </div>

                          {/* Warning */}
                          {doc.warning && (
                            <div className="mt-2 flex items-start gap-1.5 text-[11px] text-orange-300">
                              <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
                              {doc.warning}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Inactive callbacks summary */}
            {activeCallbacks.length < 14 && (
              <details className="mt-4">
                <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-400 flex items-center gap-1">
                  <ChevronDown size={12} />
                  {14 - activeCallbacks.length} callback tidak aktif
                </summary>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.keys(CALLBACK_DOCS)
                    .filter((cb) => !hook.callbacks[cb])
                    .map((cb) => (
                      <span key={cb} className="text-[10px] px-2 py-0.5 rounded bg-white/3 text-gray-700 border border-white/5 font-mono">
                        {cb}
                      </span>
                    ))}
                </div>
              </details>
            )}
          </section>

          {/* Delta Returns explanation */}
          {hasDeltaReturns && (
            <section className="card p-5 border-purple-500/20 bg-purple-500/5">
              <h2 className="text-sm font-semibold text-purple-300 mb-2 flex items-center gap-2">
                <Info size={14} /> Apa itu Delta Returns?
              </h2>
              <p className="text-xs text-gray-300 leading-relaxed">
                Hook ini menggunakan <strong className="text-purple-300">Custom Accounting (Delta Returns)</strong> —
                mekanisme Uniswap v4 yang memungkinkan hook untuk secara langsung mempengaruhi jumlah token
                yang diterima atau dikirim dalam operasi swap/liquidity.
              </p>
              <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                Ini adalah fitur paling powerful di Uniswap v4 — memungkinkan pembuatan AMM curve custom,
                fee extraction di level hook, atau custom accounting tanpa perlu deploy pool baru.
                Namun juga berisiko: hook dapat mengambil sebagian token dari setiap transaksi.
              </p>
            </section>
          )}

          {/* ── Trading: candlestick chart + Swap/Add Liquidity, position management ── */}
          <section id="add-liquidity" className="card p-5">
            {!isSolana ? (
              <TradingPanelTabs
                swap={
                  <SwapPanel hookAddress={hook.address} chainId={hook.chainId} riskLevel={hook.riskLevel} hookScore={hook.hookScore} />
                }
                addLiquidity={
                  <AddLiquidityPanel hookAddress={hook.address} chainId={hook.chainId} riskLevel={hook.riskLevel} hookScore={hook.hookScore} />
                }
              />
            ) : isOrcaWhirlpool ? (
              <TradingPanelTabs
                swap={<SolanaSwapPanel hookAddress={hook.address} riskLevel={hook.riskLevel} hookScore={hook.hookScore} dex="orca" />}
                addLiquidity={<SolanaAddLiquidityPanel hookAddress={hook.address} riskLevel={hook.riskLevel} hookScore={hook.hookScore} />}
              />
            ) : isRaydiumClmm ? (
              <TradingPanelTabs
                swap={<SolanaSwapPanel hookAddress={hook.address} riskLevel={hook.riskLevel} hookScore={hook.hookScore} dex="raydium" />}
                addLiquidity={<RaydiumAddLiquidityPanel hookAddress={hook.address} riskLevel={hook.riskLevel} hookScore={hook.hookScore} />}
              />
            ) : isRaydiumAmm ? (
              <TradingPanelTabs
                swap={<SolanaSwapPanel hookAddress={hook.address} riskLevel={hook.riskLevel} hookScore={hook.hookScore} dex="raydium-amm" />}
                addLiquidity={
                  <SimpleAddLiquidityPanel hookAddress={hook.address} riskLevel={hook.riskLevel} hookScore={hook.hookScore} dex="raydium-amm" />
                }
              />
            ) : isRaydiumCpmm ? (
              <TradingPanelTabs
                swap={<SolanaSwapPanel hookAddress={hook.address} riskLevel={hook.riskLevel} hookScore={hook.hookScore} dex="raydium-cpmm" />}
                addLiquidity={
                  <SimpleAddLiquidityPanel hookAddress={hook.address} riskLevel={hook.riskLevel} hookScore={hook.hookScore} dex="raydium-cpmm" />
                }
              />
            ) : (
              <>
                <h2 className="text-sm font-semibold text-purple-300 mb-2 flex items-center gap-2">
                  <Info size={14} /> Swap &amp; Add Liquidity
                </h2>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Swap and Add Liquidity currently support Uniswap v4 pools, Orca Whirlpool pools,
                  and Raydium CLMM/AMM v4/CPMM pools only. Trading and LP support for other Solana DEX programs is a planned
                  future phase and is not available here yet.
                </p>
              </>
            )}
          </section>

          {/* ── ABI Explorer (EVM only) ─────────────────────── */}
          {!isSolana && (
            <section>
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Code2 size={13} className="text-yellow-400" /> ABI Explorer
                {hook.functions.length > 0 && (
                  <span className="badge bg-yellow-500/10 text-yellow-400 border-yellow-500/20 text-[10px] ml-1">
                    {hook.functions.length} fungsi
                  </span>
                )}
              </h2>
              <AbiExplorer
                address={hook.address}
                name={hook.name}
                functions={hook.functions}
              />
            </section>
          )}

          {/* ── Source Code Viewer (EVM only) ─────────────────── */}
          {!isSolana && (
            <section>
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                <FileCode size={13} className="text-blue-400" /> Source Code
                {hook.isVerified && (
                  <span className="badge bg-green-500/10 text-green-400 border-green-500/20 text-[10px] ml-1">
                    ✓ VERIFIED · {hook.sourceFiles.length} file{hook.sourceFiles.length !== 1 ? "s" : ""}
                  </span>
                )}
              </h2>
              <SourceViewer
                address={hook.address}
                isVerified={hook.isVerified}
                chainId={hook.chainId}
              />
            </section>
          )}

          {/* ── Solana Program Info ────────────────────────────── */}
          {isSolana && (
            <section className="card p-5 border-purple-500/20 bg-purple-500/5">
              <h2 className="text-sm font-semibold text-purple-300 mb-3 flex items-center gap-2">
                <Info size={14} /> Solana On-Chain Program
              </h2>
              <div className="space-y-3 text-xs text-gray-300 leading-relaxed">
                <p>{hook.description}</p>
                <div className="pt-3 border-t border-white/10 space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="text-gray-500 w-24 flex-shrink-0">Program ID</span>
                    <span className="font-mono text-blue-400 break-all">{hook.address}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 w-24 flex-shrink-0">Explorer</span>
                    <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
                      className="text-blue-400 hover:underline flex items-center gap-1">
                      Solscan ↗
                    </a>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 w-24 flex-shrink-0">Audit</span>
                    <span className={hook.auditStatus === "AUDITED" ? "text-green-400" : "text-yellow-400"}>
                      {hook.auditStatus === "AUDITED" ? "✓ Audited by third party" : hook.auditStatus}
                    </span>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ── Integration Snippets (EVM only) ───────────────── */}
          {!isSolana && (
            <section>
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Terminal size={13} className="text-purple-400" /> Integration Snippets
              </h2>
              <CodeSnippets
                address={hook.address}
                name={hook.name}
                chainId={hook.chainId}
                callbacks={hook.callbacks}
                poolCount={hook.poolCount}
                functions={hook.functions}
              />
            </section>
          )}

        </div>

        {/* ─── Right sidebar ───────────────────────────────── */}
        <div className="space-y-5">

          {/* 3D Callback Constellation */}
          <section className="card overflow-hidden relative" style={{ height: "300px" }}>
            {/* Header overlay */}
            <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-3 pt-3 pb-1"
              style={{ background: "linear-gradient(to bottom, rgba(8,11,18,0.85) 0%, transparent 100%)" }}>
              <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">
                Callback Constellation
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold"
                  style={{ color: hook.riskLevel === "CRITICAL" ? "#f87171" : hook.riskLevel === "HIGH" ? "#fb923c" : hook.riskLevel === "MEDIUM" ? "#fde047" : "#60a5fa" }}>
                  {hook.poolCount} pools orbiting
                </span>
                <span className="text-[10px] text-gray-700 italic">drag to rotate</span>
              </div>
            </div>
            <CallbackConstellation
              callbacks={hook.callbacks}
              riskLevel={hook.riskLevel}
              poolCount={hook.poolCount}
              className="w-full h-full"
            />
            {/* Bottom legend */}
            <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-center gap-4 pb-2 pt-4"
              style={{ background: "linear-gradient(to top, rgba(8,11,18,0.85) 0%, transparent 100%)" }}>
              <LegendDot color="#60a5fa" label="Callback active" />
              <LegendDot color="#f97316" label="Delta returns" />
              <LegendDot color="rgba(255,255,255,0.3)" label="Pool" size={4} />
            </div>
          </section>

          {/* LP Metrics Panel */}
          <section className="card p-5">
            <LpMetricsPanel address={hook.address} />
          </section>

          {/* HookScore */}
          <section className="card p-5">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
              Security
            </h2>

            {/* Score circle */}
            <div className="text-center mb-5">
              <div className={cn(
                "text-6xl font-bold tabular-nums",
                hook.hookScore == null ? "text-gray-600" :
                hook.hookScore >= 80 ? "text-green-400" :
                hook.hookScore >= 60 ? "text-yellow-400" :
                hook.hookScore >= 40 ? "text-orange-400" : "text-red-400"
              )}>
                {hook.hookScore ?? "—"}
              </div>
              <p className="text-xs text-gray-500 mt-1">HookScore™ / 100</p>
              <RiskBadge level={hook.riskLevel} size="md" />
            </div>

            {/* Checklist */}
            <div className="space-y-2 text-xs">
              <CheckItem ok={hook.isVerified}   label="Source code verified" />
              <CheckItem ok={hook.auditStatus === "AUDITED"} label="Security audit" />
              <CheckItem ok={hook.proxyType === "NONE"} label="Non-upgradeable" invert />
              <CheckItem ok={!hasDeltaReturns} label="No custom accounting" invert />
              <CheckItem ok={activeCallbacks.length <= 4} label="Limited attack surface" invert />
              {/* Hook authenticity validation */}
              {(() => {
                const poolValidated = hook.poolCount > 0;
                const hookValidated = hook.securityFlags.some(
                  (f) => f.source === "validator" && f.category === "HOOK_VALIDATED"
                );
                const hasFakeFlag = hook.securityFlags.some(
                  (f) => f.source === "validator" && f.category !== "HOOK_VALIDATED"
                );
                if (hasFakeFlag) {
                  return (
                    <div className="flex items-center gap-2 mt-1 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                      <XCircle size={13} className="text-red-400 flex-shrink-0" />
                      <span className="text-red-300 font-medium">Hook validation FAILED</span>
                    </div>
                  );
                }
                if (poolValidated || hookValidated) {
                  return (
                    <div className="flex items-center gap-2 mt-1 p-2 rounded-lg bg-green-500/5 border border-green-500/20">
                      <CheckCircle2 size={13} className="text-green-400 flex-shrink-0" />
                      <span className="text-green-300 text-[11px]">
                        Genuine v4 hook{" "}
                        <span className="text-gray-500">
                          ({poolValidated ? "pool-event proof" : "permissions verified"})
                        </span>
                      </span>
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            {/* Security flags */}
            {hook.securityFlags.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/10 space-y-2">
                {/* Threat intel flags (GoPlus) shown first with distinct styling */}
                {threatFlags.length > 0 && (
                  <div className="mb-1">
                    <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wider mb-1.5 flex items-center gap-1">
                      <ShieldAlert size={10} /> Threat Intel
                    </p>
                    {threatFlags.map((flag) => (
                      <div key={flag.id} className={cn(
                        "p-2.5 rounded-lg border text-xs mb-1.5",
                        flag.severity === "CRITICAL" ? "bg-red-500/10 border-red-500/30 text-red-300" :
                        flag.severity === "HIGH"     ? "bg-orange-500/10 border-orange-500/30 text-orange-300" :
                                                       "bg-yellow-500/10 border-yellow-500/30 text-yellow-300"
                      )}>
                        <div className="font-semibold text-[11px] mb-0.5">
                          {THREAT_LABELS[flag.category] ?? flag.category}
                        </div>
                        <div className="opacity-80 leading-relaxed">{flag.description}</div>
                        <div className="mt-1 text-[10px] opacity-50">src: {flag.reportedBy ?? "GoPlus"}</div>
                      </div>
                    ))}
                  </div>
                )}
                {/* Validator flags — fake hook detection */}
                {hook.securityFlags
                  .filter((f) => f.source === "validator" && f.category !== "HOOK_VALIDATED")
                  .map((flag) => (
                    <div key={flag.id} className="p-2.5 rounded-lg border text-xs bg-red-500/10 border-red-500/20 text-red-300">
                      <div className="font-semibold text-[11px] mb-0.5 flex items-center gap-1">
                        <ShieldAlert size={10} /> {flag.category.replace(/_/g, " ")} · {flag.severity}
                      </div>
                      <div className="opacity-80 leading-relaxed">{flag.description}</div>
                    </div>
                  ))}
                {/* Technical security flags (slither / manual) */}
                {hook.securityFlags
                  .filter((f) => f.source !== "goplus" && f.source !== "validator")
                  .map((flag) => (
                    <div key={flag.id} className={cn(
                      "p-2.5 rounded-lg border text-xs",
                      flag.severity === "CRITICAL" ? "bg-red-500/10 border-red-500/20 text-red-300" :
                      flag.severity === "HIGH"     ? "bg-orange-500/10 border-orange-500/20 text-orange-300" :
                      flag.severity === "MEDIUM"   ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-300" :
                                                     "bg-white/5 border-white/10 text-gray-400"
                    )}>
                      <div className="font-semibold text-[11px] mb-0.5">{flag.category} · {flag.severity}</div>
                      <div className="opacity-80 leading-relaxed">{flag.description}</div>
                    </div>
                  ))}
              </div>
            )}

            {/* Audit records */}
            {hook.auditRecords.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <p className="text-[11px] text-gray-500 mb-2 font-semibold uppercase">Audit Records</p>
                {hook.auditRecords.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-xs py-1">
                    <span className="text-gray-300">{a.auditor}</span>
                    {a.reportUrl && (
                      <a href={a.reportUrl} target="_blank" rel="noopener noreferrer"
                        className="text-blue-400 hover:underline">Report ↗</a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Contract info */}
          <section className="card p-5">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
              Contract Info
            </h2>
            <dl className="space-y-2.5">
              <InfoRow label="Address"   value={shortAddress(hook.address, 8)}  mono />
              <InfoRow label="Chain"     value={`${chainIcon(hook.chainId)} ${chainName(hook.chainId)}`} />
              <InfoRow label="Source"    value={hook.isVerified ? "Verified ✓" : "Unverified"} />
              <InfoRow label="Proxy"     value={hook.proxyType} />
              <InfoRow label="Audit"     value={hook.auditStatus} />
              <InfoRow label="Callbacks" value={`${activeCallbacks.length} / 14 active`} />
              {hook.bytecodeHash && (
                <InfoRow label="Bytecode" value={shortAddress(hook.bytecodeHash, 6)} mono />
              )}
            </dl>
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
              className="mt-4 flex items-center gap-2 text-xs text-blue-400 hover:underline">
              <ExternalLink size={11} /> View on {chainName(hook.chainId)} explorer
            </a>
          </section>

          {/* Similar hooks */}
          {hook.similarHooks.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 px-1">
                Similar Hooks
              </h2>
              <div className="space-y-2">
                {hook.similarHooks.map((s) => (
                  <HookCard key={`${s.address}-${s.chainId}`} hook={s} view="list" />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function LegendDot({ color, label, size = 6 }: { color: string; label: string; size?: number }) {
  return (
    <div className="flex items-center gap-1">
      <span style={{ width: size, height: size, borderRadius: "50%", background: color, display: "inline-block", boxShadow: `0 0 4px ${color}` }} />
      <span className="text-[9px] text-gray-600">{label}</span>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-xs text-gray-500 flex-shrink-0">{label}</dt>
      <dd className={cn("text-xs text-gray-300 text-right", mono && "font-mono text-[10px]")}>{value}</dd>
    </div>
  );
}

function CheckItem({ ok, label, invert }: { ok: boolean; label: string; invert?: boolean }) {
  const pass = invert ? !ok : ok;
  return (
    <div className="flex items-center gap-2">
      {pass
        ? <CheckCircle2 size={13} className="text-green-400 flex-shrink-0" />
        : <XCircle size={13} className="text-gray-600 flex-shrink-0" />}
      <span className={pass ? "text-gray-300" : "text-gray-600"}>{label}</span>
    </div>
  );
}
