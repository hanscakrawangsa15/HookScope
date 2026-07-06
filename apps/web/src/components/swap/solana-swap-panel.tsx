"use client";

import { useEffect, useState, useCallback } from "react";
import { useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { useAppKitConnection } from "@reown/appkit-adapter-solana/react";
import type { Provider } from "@reown/appkit-adapter-solana";
import { Transaction } from "@solana/web3.js";
import { ArrowDownUp, AlertTriangle, ExternalLink, Loader2, CheckCircle2 } from "lucide-react";
import { api, type SwapPool, type SolanaSwapQuoteResult, type SolanaSwapBuildResult } from "@/lib/api";
import { RiskBadge } from "@/components/ui/risk-badge";
import { explorerTxUrl } from "@/lib/utils";
import { ConnectButton } from "@/components/wallet/connect-button";

const SOLANA_CHAIN_ID = 1399811149;
const SLIPPAGE_OPTIONS = [0.1, 0.5, 1, 2];

function parseAmount(str: string, decimals: number): bigint | null {
  if (!str || Number(str) <= 0) return null;
  try {
    const [whole, frac = ""] = str.split(".");
    const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
    return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
  } catch {
    return null;
  }
}

function formatAmount(raw: string, decimals: number): string {
  try {
    const value = BigInt(raw);
    const divisor = 10n ** BigInt(decimals);
    const whole = value / divisor;
    const frac = (value % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : whole.toString();
  } catch {
    return "0";
  }
}

type SolanaDex = "orca" | "raydium" | "raydium-amm" | "raydium-cpmm";

const DEX_LABELS: Record<SolanaDex, string> = {
  orca: "Orca Whirlpool",
  raydium: "Raydium CLMM",
  "raydium-amm": "Raydium AMM v4",
  "raydium-cpmm": "Raydium CPMM",
};

function quoteFor(dex: SolanaDex, params: { poolAddress: string; inputMint: string; amountIn: string; slippageBps?: number }) {
  switch (dex) {
    case "orca":
      return api.orcaSwap.quote({ whirlpoolAddress: params.poolAddress, inputMint: params.inputMint, amountIn: params.amountIn, slippageBps: params.slippageBps });
    case "raydium":
      return api.raydiumSwap.quote({ poolId: params.poolAddress, inputMint: params.inputMint, amountIn: params.amountIn, slippageBps: params.slippageBps });
    case "raydium-amm":
      return api.raydiumAmmSwap.quote({ poolId: params.poolAddress, inputMint: params.inputMint, amountIn: params.amountIn, slippageBps: params.slippageBps });
    case "raydium-cpmm":
      return api.raydiumCpmmSwap.quote({ poolId: params.poolAddress, inputMint: params.inputMint, amountIn: params.amountIn, slippageBps: params.slippageBps });
  }
}

function buildFor(dex: SolanaDex, params: { poolAddress: string; inputMint: string; amountIn: string; slippageBps?: number; owner: string }) {
  switch (dex) {
    case "orca":
      return api.orcaSwap.build({ whirlpoolAddress: params.poolAddress, inputMint: params.inputMint, amountIn: params.amountIn, slippageBps: params.slippageBps, owner: params.owner });
    case "raydium":
      return api.raydiumSwap.build({ poolId: params.poolAddress, inputMint: params.inputMint, amountIn: params.amountIn, slippageBps: params.slippageBps, owner: params.owner });
    case "raydium-amm":
      return api.raydiumAmmSwap.build({ poolId: params.poolAddress, inputMint: params.inputMint, amountIn: params.amountIn, slippageBps: params.slippageBps, owner: params.owner });
    case "raydium-cpmm":
      return api.raydiumCpmmSwap.build({ poolId: params.poolAddress, inputMint: params.inputMint, amountIn: params.amountIn, slippageBps: params.slippageBps, owner: params.owner });
  }
}

interface SolanaSwapPanelProps {
  hookAddress: string;
  riskLevel: string;
  hookScore: number | null;
  dex: SolanaDex;
}

// Generic Solana swap UI shared by every native Solana DEX integration — the
// interaction shape (two pool-bound mints, one amount, one slippage knob) is
// identical across DEXes; only the API namespace differs per dex. Takes a
// plain `dex` string (not function props) because this is rendered from a
// Server Component — functions can't cross that boundary as props.
export function SolanaSwapPanel({ hookAddress, riskLevel, hookScore, dex }: SolanaSwapPanelProps) {
  const dexLabel = DEX_LABELS[dex];
  const [pools, setPools] = useState<SwapPool[] | null>(null);
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);
  const [zeroForOne, setZeroForOne] = useState(true);
  const [amountInStr, setAmountInStr] = useState("");
  const [slippagePct, setSlippagePct] = useState(0.5);
  const [decimalsA, setDecimalsA] = useState(9);
  const [decimalsB, setDecimalsB] = useState(9);
  const [quote, setQuote] = useState<SolanaSwapQuoteResult | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  useEffect(() => {
    api.hooks.pools(hookAddress, 1)
      .then((res) => {
        const sorted = [...res.data].sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));
        setPools(sorted);
        if (sorted.length > 0) setSelectedPoolId(sorted[0].poolId);
      })
      .catch(() => setPools([]));
  }, [hookAddress]);

  const pool = pools?.find((p) => p.poolId === selectedPoolId) ?? null;
  const symbolIn = pool ? (zeroForOne ? pool.token0Symbol : pool.token1Symbol) ?? "tokenA" : "—";
  const symbolOut = pool ? (zeroForOne ? pool.token1Symbol : pool.token0Symbol) ?? "tokenB" : "—";
  const inputMint = pool ? (zeroForOne ? pool.token0 : pool.token1) : null;
  const decimalsIn = zeroForOne ? decimalsA : decimalsB;
  const decimalsOut = zeroForOne ? decimalsB : decimalsA;

  const { address: account } = useAppKitAccount({ namespace: "solana" });
  const { connection } = useAppKitConnection();
  const { walletProvider } = useAppKitProvider<Provider>("solana");

  const amountInRaw = parseAmount(amountInStr, decimalsIn);

  // Fetch a fresh quote whenever inputs change (debounced).
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!pool || !inputMint || !amountInRaw || amountInRaw <= 0n) return;
    const handle = setTimeout(() => {
      setQuoteLoading(true);
      quoteFor(dex, {
        poolAddress: pool.poolId,
        inputMint,
        amountIn: amountInRaw!.toString(),
        slippageBps: Math.round(slippagePct * 100),
      })
        .then((q) => {
          setQuote(q);
          setDecimalsA(q.decimalsA);
          setDecimalsB(q.decimalsB);
        })
        .catch((e: Error) => setQuoteError(e.message))
        .finally(() => setQuoteLoading(false));
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool?.poolId, inputMint, amountInRaw?.toString(), slippagePct, dex]);

  const handleSwap = useCallback(async () => {
    if (!pool || !inputMint || !amountInRaw || !account) return;
    setTxError(null);
    setTxSignature(null);
    setBuilding(true);
    try {
      const built = await buildFor(dex, {
        poolAddress: pool.poolId,
        inputMint,
        amountIn: amountInRaw.toString(),
        slippageBps: Math.round(slippagePct * 100),
        owner: account,
      });
      const transaction = Transaction.from(Buffer.from(built.transactionBase64, "base64"));
      if (!connection) throw new Error("Solana connection unavailable");
      const signature = await walletProvider.sendTransaction(transaction, connection);
      setTxSignature(signature);
    } catch (e) {
      setTxError(e instanceof Error ? e.message : "Swap failed");
    } finally {
      setBuilding(false);
    }
  }, [pool, inputMint, amountInRaw, account, slippagePct, connection, walletProvider, dex]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <ArrowDownUp size={14} className="text-blue-400" />
          Swap ({dexLabel})
        </h2>
        <RiskBadge level={riskLevel} score={hookScore} size="sm" />
      </div>

      <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs"
        style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.18)" }}>
        <AlertTriangle size={11} className="text-orange-400 flex-shrink-0 mt-0.5" />
        <p className="text-gray-400">
          You are trading directly against a pool governed by this program&apos;s on-chain
          logic. HookScope shows risk transparently but never blocks a swap.
        </p>
      </div>

      {pools === null ? (
        <div className="h-40 shimmer rounded-xl" />
      ) : pools.length === 0 ? (
        <div className="rounded-xl p-4 text-xs text-gray-500 text-center"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          No indexed pools for this program yet.
        </div>
      ) : (
        <>
          {pools.length > 1 && (
            <select
              value={selectedPoolId ?? ""}
              onChange={(e) => setSelectedPoolId(e.target.value)}
              className="w-full text-xs rounded-lg px-3 py-2 bg-black/20 text-gray-300 border border-white/10"
            >
              {pools.map((p) => (
                <option key={p.poolId} value={p.poolId}>
                  {(p.token0Symbol ?? "?")}/{(p.token1Symbol ?? "?")} — {(p.fee / 10_000).toFixed(2)}% fee
                </option>
              ))}
            </select>
          )}

          {!account ? (
            <div className="flex justify-center py-2"><ConnectButton namespace="solana" /></div>
          ) : (
            <>
              <div className="space-y-2">
                <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wide">You pay</span>
                    <span className="text-[10px] text-gray-500">{symbolIn}</span>
                  </div>
                  <input
                    type="number" min="0" step="any" placeholder="0.0"
                    value={amountInStr}
                    onChange={(e) => setAmountInStr(e.target.value)}
                    className="w-full bg-transparent text-xl font-semibold text-white outline-none"
                  />
                </div>

                <div className="flex justify-center">
                  <button
                    onClick={() => setZeroForOne((v) => !v)}
                    className="w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition-colors"
                    style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.25)" }}
                    aria-label="Flip swap direction"
                  >
                    <ArrowDownUp size={13} className="text-blue-400" />
                  </button>
                </div>

                <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wide">You receive (est.)</span>
                    <span className="text-[10px] text-gray-500">{symbolOut}</span>
                  </div>
                  <p className="text-xl font-semibold text-white truncate">
                    {quoteLoading ? <Loader2 size={16} className="animate-spin text-gray-500" /> :
                      quote ? formatAmount(quote.estimatedAmountOut, decimalsOut) : "0.0"}
                  </p>
                </div>
              </div>

              {quoteError && <p className="text-[11px] text-orange-400 px-1">{quoteError}</p>}

              <div className="flex items-center gap-1.5 px-1">
                <span className="text-[10px] text-gray-500">Slippage</span>
                {SLIPPAGE_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setSlippagePct(opt)}
                    className="text-[10px] px-1.5 py-0.5 rounded cursor-pointer transition-all"
                    style={{
                      background: slippagePct === opt ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.04)",
                      border: slippagePct === opt ? "1px solid rgba(59,130,246,0.4)" : "1px solid rgba(255,255,255,0.08)",
                      color: slippagePct === opt ? "#93c5fd" : "#6b7280",
                    }}
                  >
                    {opt}%
                  </button>
                ))}
              </div>

              {txError && <p className="text-[11px] text-red-400 px-1">{txError}</p>}

              {txSignature && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                  style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}>
                  <CheckCircle2 size={12} className="text-emerald-400" />
                  <span className="text-emerald-300">Swap sent</span>
                  <a
                    href={explorerTxUrl(txSignature, SOLANA_CHAIN_ID)}
                    target="_blank" rel="noopener noreferrer"
                    className="ml-auto flex items-center gap-1 text-emerald-400 hover:text-emerald-300"
                  >
                    View <ExternalLink size={10} />
                  </a>
                </div>
              )}

              <button
                onClick={handleSwap}
                disabled={!quote || !amountInRaw || building}
                className="w-full btn-primary justify-center cursor-pointer disabled:opacity-50"
              >
                {building ? <Loader2 size={14} className="animate-spin" /> : null}
                Swap
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
