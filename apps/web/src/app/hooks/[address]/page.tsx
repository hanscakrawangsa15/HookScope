import { notFound } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { RiskBadge } from "@/components/ui/risk-badge";
import { CallbackGrid } from "@/components/ui/callback-grid";
import { HookCard } from "@/components/hooks/hook-card";
import {
  shortAddress, chainName, chainIcon, formatTvl, timeAgo, cn
} from "@/lib/utils";
import {
  ExternalLink, ShieldCheck, ShieldOff, Copy,
  Code2, Activity, GitCompare, AlertTriangle
} from "lucide-react";

interface PageProps {
  params: { address: string };
  searchParams: { chain?: string };
}

export async function generateMetadata({ params, searchParams }: PageProps) {
  try {
    const hook = await api.hooks.get(params.address, searchParams.chain ? Number(searchParams.chain) : undefined);
    return {
      title: hook.name ?? shortAddress(hook.address),
      description: hook.description ?? `Uniswap v4 Hook at ${hook.address}`,
    };
  } catch {
    return { title: "Hook Not Found" };
  }
}

export default async function HookDetailPage({ params, searchParams }: PageProps) {
  let hook;
  try {
    hook = await api.hooks.get(
      params.address,
      searchParams.chain ? Number(searchParams.chain) : undefined
    );
  } catch {
    notFound();
  }

  const explorerUrl = getExplorerUrl(hook.chainId, hook.address);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
        <Link href="/" className="hover:text-white">Explorer</Link>
        <span>/</span>
        <span className="text-gray-300 font-mono">{shortAddress(hook.address, 8)}</span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-8">
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-white">
              {hook.name ?? "Unknown Hook"}
            </h1>
            {hook.isVerified && (
              <span className="badge bg-green-500/10 text-green-400 border-green-500/20">
                <ShieldCheck size={11} className="mr-1" /> SOURCE VERIFIED
              </span>
            )}
            <RiskBadge level={hook.riskLevel} score={hook.hookScore} size="md" />
          </div>

          <div className="flex items-center gap-3 mt-2 font-mono text-sm text-gray-400">
            <span>{hook.address}</span>
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={13} className="hover:text-white transition-colors" />
            </a>
          </div>

          <div className="flex flex-wrap gap-4 mt-4 text-sm text-gray-400">
            <span>{chainIcon(hook.chainId)} {chainName(hook.chainId)}</span>
            <span>Deployed {timeAgo(hook.deployedAt)}</span>
            {hook.deployer && (
              <span>by <span className="font-mono">{shortAddress(hook.deployer)}</span></span>
            )}
            {hook.poolCount > 0 && <span>{hook.poolCount} active pools</span>}
            {hook.tvlUsd != null && <span>TVL: {formatTvl(hook.tvlUsd)}</span>}
          </div>

          {hook.proxyType !== "NONE" && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              <AlertTriangle size={14} className="text-yellow-400" />
              <span className="text-yellow-400">
                {hook.proxyType} Proxy
              </span>
              {hook.implementationAddress && (
                <span className="text-gray-500">
                  → impl: <Link
                    href={`/hooks/${hook.implementationAddress}?chain=${hook.chainId}`}
                    className="font-mono text-blue-400 hover:underline"
                  >
                    {shortAddress(hook.implementationAddress)}
                  </Link>
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Link
            href={`/compare?addresses=${hook.address}`}
            className="btn-ghost text-sm"
          >
            <GitCompare size={14} />
            Compare
          </Link>
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-sm"
          >
            <ExternalLink size={14} />
            Explorer
          </a>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Callbacks */}
          <section className="card p-5">
            <h2 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-wider">
              Active Callbacks
            </h2>
            <CallbackGrid callbacks={hook.callbacks} />
            <p className="mt-3 text-xs text-gray-600">
              Decoded from address bitmask — cannot be falsified after deployment.
            </p>
          </section>

          {/* Functions */}
          {hook.functions.length > 0 && (
            <section className="card p-5">
              <h2 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-wider">
                <Code2 size={13} className="inline mr-2" />
                Functions ({hook.functions.length})
              </h2>
              <div className="space-y-2">
                {hook.functions.map((fn) => (
                  <div
                    key={fn.id}
                    className={cn(
                      "p-3 rounded-lg border text-sm",
                      fn.isCallback
                        ? "bg-blue-500/5 border-blue-500/20"
                        : "bg-white/3 border-white/10"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-blue-300">{fn.name}</span>
                      {fn.isCallback && (
                        <span className="badge bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px]">
                          HOOK CALLBACK
                        </span>
                      )}
                      <span className={cn(
                        "ml-auto badge text-[10px]",
                        fn.stateMutability === "view" || fn.stateMutability === "pure"
                          ? "bg-green-500/10 text-green-400 border-green-500/20"
                          : "bg-orange-500/10 text-orange-400 border-orange-500/20"
                      )}>
                        {fn.stateMutability}
                      </span>
                    </div>
                    <p className="font-mono text-xs text-gray-500 mt-1">{fn.signature}</p>
                    {fn.natspec && (
                      <p className="text-xs text-gray-400 mt-1">{fn.natspec}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Source code viewer */}
          {hook.sourceFiles.length > 0 && (
            <section className="card p-5">
              <h2 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-wider">
                Source Files
              </h2>
              <div className="space-y-2">
                {hook.sourceFiles.map((sf) => (
                  <Link
                    key={sf.name}
                    href={`/hooks/${hook.address}/source?file=${encodeURIComponent(sf.name)}`}
                    className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    <Code2 size={13} />
                    <span className="font-mono">{sf.name}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Pools */}
          {hook.analytics && hook.analytics.poolCount > 0 && (
            <section className="card p-5">
              <h2 className="text-sm font-semibold text-gray-300 mb-1 uppercase tracking-wider">
                <Activity size={13} className="inline mr-2" />
                Analytics
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
                <Metric label="TVL" value={formatTvl(hook.analytics.tvlUsd)} />
                <Metric label="Vol 7d" value={formatTvl(hook.analytics.volume7dUsd)} />
                <Metric label="Vol 30d" value={formatTvl(hook.analytics.volume30dUsd)} />
                <Metric label="Unique LPs" value={hook.analytics.uniqueLps.toLocaleString()} />
              </div>
            </section>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* Security */}
          <section className="card p-5">
            <h2 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-wider">
              Security
            </h2>
            <div className="text-center mb-4">
              <div className={cn(
                "text-5xl font-bold",
                hook.hookScore == null ? "text-gray-600" :
                hook.hookScore >= 80 ? "text-green-400" :
                hook.hookScore >= 60 ? "text-yellow-400" :
                hook.hookScore >= 40 ? "text-orange-400" : "text-red-400"
              )}>
                {hook.hookScore ?? "—"}
              </div>
              <p className="text-xs text-gray-500 mt-1">HookScore™ / 100</p>
            </div>

            {hook.securityFlags.length > 0 ? (
              <div className="space-y-2">
                {hook.securityFlags.map((flag) => (
                  <div
                    key={flag.id}
                    className={cn(
                      "p-2.5 rounded-lg border text-xs",
                      flag.severity === "CRITICAL" ? "bg-red-500/10 border-red-500/20 text-red-300" :
                      flag.severity === "HIGH"     ? "bg-orange-500/10 border-orange-500/20 text-orange-300" :
                      flag.severity === "MEDIUM"   ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-300" :
                                                     "bg-white/5 border-white/10 text-gray-400"
                    )}
                  >
                    <div className="font-semibold mb-0.5">{flag.category}</div>
                    <div className="text-[11px] opacity-80">{flag.description}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-500 text-center">No flags detected</p>
            )}

            {hook.auditRecords.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <p className="text-xs text-gray-500 mb-2">Audit Records</p>
                {hook.auditRecords.map((audit) => (
                  <div key={audit.id} className="flex items-center justify-between text-xs">
                    <span className="text-gray-300">{audit.auditor}</span>
                    {audit.reportUrl && (
                      <a
                        href={audit.reportUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:underline"
                      >
                        Report ↗
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Contract info */}
          <section className="card p-5">
            <h2 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wider">
              Contract Info
            </h2>
            <dl className="space-y-2 text-xs">
              <InfoRow label="Address" value={shortAddress(hook.address, 8)} mono />
              <InfoRow label="Chain" value={`${chainIcon(hook.chainId)} ${chainName(hook.chainId)}`} />
              <InfoRow label="Verified" value={hook.isVerified ? "Yes" : "No"} />
              <InfoRow label="Proxy" value={hook.proxyType} />
              <InfoRow label="Audit" value={hook.auditStatus} />
              {hook.bytecodeHash && (
                <InfoRow label="Bytecode Hash" value={shortAddress(hook.bytecodeHash, 6)} mono />
              )}
            </dl>
          </section>

          {/* Similar hooks */}
          {hook.similarHooks.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wider px-1">
                Similar Hooks
              </h2>
              <div className="space-y-2">
                {hook.similarHooks.map((similar) => (
                  <HookCard
                    key={`${similar.address}-${similar.chainId}`}
                    hook={similar}
                    view="list"
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center p-3 bg-white/3 rounded-lg">
      <p className="text-lg font-bold text-white">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-gray-500">{label}</dt>
      <dd className={cn("text-gray-300", mono && "font-mono text-[11px]")}>{value}</dd>
    </div>
  );
}

function getExplorerUrl(chainId: number, address: string): string {
  const explorers: Record<number, string> = {
    1: "https://etherscan.io/address",
    8453: "https://basescan.org/address",
    42161: "https://arbiscan.io/address",
    10: "https://optimistic.etherscan.io/address",
    11155111: "https://sepolia.etherscan.io/address",
  };
  const base = explorers[chainId] ?? "https://etherscan.io/address";
  return `${base}/${address}`;
}
