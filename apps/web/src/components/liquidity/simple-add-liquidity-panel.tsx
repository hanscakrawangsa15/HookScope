"use client";

import { useEffect, useState, useCallback } from "react";
import { useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { useAppKitConnection } from "@reown/appkit-adapter-solana/react";
import type { Provider } from "@reown/appkit-adapter-solana";
import { Transaction } from "@solana/web3.js";
import { Droplets, AlertTriangle, ExternalLink, Loader2, CheckCircle2 } from "lucide-react";
import { api, type SwapPool } from "@/lib/api";
import { RiskBadge } from "@/components/ui/risk-badge";
import { explorerTxUrl } from "@/lib/utils";
import { ConnectButton } from "@/components/wallet/connect-button";
import { PoolCandlestickChart } from "@/components/liquidity/pool-candlestick-chart";

const SOLANA_CHAIN_ID = 1399811149;
const SLIPPAGE_OPTIONS = [0.1, 0.5, 1, 2];

type SimpleLpDex = "raydium-amm" | "raydium-cpmm";

const DEX_LABELS: Record<SimpleLpDex, string> = {
  "raydium-amm": "Raydium AMM v4",
  "raydium-cpmm": "Raydium CPMM",
};

function quoteFor(dex: SimpleLpDex, params: { poolId: string; amountA?: string; amountB?: string }) {
  return dex === "raydium-amm" ? api.raydiumAmmLp.quote(params) : api.raydiumCpmmLp.quote(params);
}

function buildFor(dex: SimpleLpDex, params: { poolId: string; amountA: string; amountB: string; owner: string; slippageBps?: number }) {
  return dex === "raydium-amm" ? api.raydiumAmmLp.build(params) : api.raydiumCpmmLp.build(params);
}

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

interface SimpleAddLiquidityPanelProps {
  hookAddress: string;
  riskLevel: string;
  hookScore: number | null;
  dex: SimpleLpDex;
}

// Add Liquidity UI for plain constant-product Raydium AMMs (AMM v4 / CPMM) —
// no tick-range selection needed, just an auto-balanced two-token deposit.
export function SimpleAddLiquidityPanel({ hookAddress, riskLevel, hookScore, dex }: SimpleAddLiquidityPanelProps) {
  const dexLabel = DEX_LABELS[dex];
  const [pools, setPools] = useState<SwapPool[] | null>(null);
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);
  const [decimalsA, setDecimalsA] = useState(9);
  const [decimalsB, setDecimalsB] = useState(9);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [amountAStr, setAmountAStr] = useState("");
  const [amountBStr, setAmountBStr] = useState("");
  const [activeSide, setActiveSide] = useState<"amountA" | "amountB" | null>(null);
  const [slippagePct, setSlippagePct] = useState(0.5);
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
  const symbolA = pool?.token0Symbol ?? "tokenA";
  const symbolB = pool?.token1Symbol ?? "tokenB";

  const { address: account } = useAppKitAccount({ namespace: "solana" });
  const { connection } = useAppKitConnection();
  const { walletProvider } = useAppKitProvider<Provider>("solana");

  useEffect(() => {
    setAmountAStr("");
    setAmountBStr("");
    setQuoteError(null);
    setCurrentPrice(null);
    if (!pool) return;
    quoteFor(dex, { poolId: pool.poolId, amountA: "0" })
      .then((q) => {
        setDecimalsA(q.decimalsA);
        setDecimalsB(q.decimalsB);
        setCurrentPrice(q.price);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool?.poolId]);

  const amountARaw = parseAmount(amountAStr, decimalsA);
  const amountBRaw = parseAmount(amountBStr, decimalsB);

  // Auto-balance the other side whenever the user edits one amount (debounced).
  useEffect(() => {
    if (!pool || !activeSide) return;
    const rawAmount = activeSide === "amountA" ? amountARaw : amountBRaw;
    if (!rawAmount || rawAmount <= 0n) return;
    const handle = setTimeout(() => {
      setQuoteLoading(true);
      setQuoteError(null);
      quoteFor(dex, {
        poolId: pool.poolId,
        ...(activeSide === "amountA" ? { amountA: amountAStr } : { amountB: amountBStr }),
      })
        .then((q) => {
          if (activeSide === "amountA") setAmountBStr(formatAmount(q.tokenEstB, q.decimalsB));
          else setAmountAStr(formatAmount(q.tokenEstA, q.decimalsA));
        })
        .catch((e: Error) => setQuoteError(e.message))
        .finally(() => setQuoteLoading(false));
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSide, amountAStr, amountBStr, pool, dex]);

  const handleAdd = useCallback(async () => {
    if (!pool || !amountARaw || !amountBRaw || !account) return;
    setTxError(null);
    setTxSignature(null);
    setBuilding(true);
    try {
      const built = await buildFor(dex, {
        poolId: pool.poolId,
        amountA: amountARaw.toString(),
        amountB: amountBRaw.toString(),
        owner: account,
        slippageBps: Math.round(slippagePct * 100),
      });
      const transaction = Transaction.from(Buffer.from(built.transactionBase64, "base64"));
      if (!connection) throw new Error("Solana connection unavailable");
      const signature = await walletProvider.sendTransaction(transaction, connection);
      setTxSignature(signature);
    } catch (e) {
      setTxError(e instanceof Error ? e.message : "Add liquidity failed");
    } finally {
      setBuilding(false);
    }
  }, [pool, amountARaw, amountBRaw, account, slippagePct, connection, walletProvider, dex]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <Droplets size={14} className="text-purple-400" />
          Add Liquidity ({dexLabel})
        </h2>
        <RiskBadge level={riskLevel} score={hookScore} size="sm" />
      </div>

      <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs"
        style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.18)" }}>
        <AlertTriangle size={11} className="text-orange-400 flex-shrink-0 mt-0.5" />
        <p className="text-gray-400">
          Providing liquidity exposes your funds to this pool&apos;s on-chain logic on every swap
          against your position. HookScope shows risk transparently but never blocks a deposit.
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

          {pool && (
            <PoolCandlestickChart
              hookAddress={hookAddress}
              poolId={pool.poolId}
              chainId={SOLANA_CHAIN_ID}
              currentPrice={currentPrice}
              symbolA={symbolA}
              symbolB={symbolB}
            />
          )}

          {!account ? (
            <div className="flex justify-center py-2"><ConnectButton namespace="solana" /></div>
          ) : (
            <>
              <div className="space-y-2">
                <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wide">Amount</span>
                    <span className="text-[10px] text-gray-500">{symbolA}</span>
                  </div>
                  <input
                    type="number" min="0" step="any" placeholder="0.0"
                    value={amountAStr}
                    onChange={(e) => { setActiveSide("amountA"); setAmountAStr(e.target.value); }}
                    className="w-full bg-transparent text-xl font-semibold text-white outline-none"
                  />
                </div>

                <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wide">Amount</span>
                    <span className="text-[10px] text-gray-500">{symbolB}</span>
                  </div>
                  <input
                    type="number" min="0" step="any" placeholder="0.0"
                    value={amountBStr}
                    onChange={(e) => { setActiveSide("amountB"); setAmountBStr(e.target.value); }}
                    className="w-full bg-transparent text-xl font-semibold text-white outline-none"
                  />
                </div>
              </div>

              {quoteLoading && (
                <p className="text-[11px] text-gray-500 px-1 flex items-center gap-1.5">
                  <Loader2 size={10} className="animate-spin" /> Balancing amounts…
                </p>
              )}
              {quoteError && <p className="text-[11px] text-orange-400 px-1">{quoteError}</p>}

              <div className="flex items-center gap-1.5 px-1">
                <span className="text-[10px] text-gray-500">Slippage</span>
                {SLIPPAGE_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setSlippagePct(opt)}
                    className="text-[10px] px-1.5 py-0.5 rounded cursor-pointer transition-all"
                    style={{
                      background: slippagePct === opt ? "rgba(168,85,247,0.2)" : "rgba(255,255,255,0.04)",
                      border: slippagePct === opt ? "1px solid rgba(168,85,247,0.4)" : "1px solid rgba(255,255,255,0.08)",
                      color: slippagePct === opt ? "#d8b4fe" : "#6b7280",
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
                  <span className="text-emerald-300">Liquidity added</span>
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
                onClick={handleAdd}
                disabled={!amountARaw || !amountBRaw || building}
                className="w-full btn-primary justify-center cursor-pointer disabled:opacity-50"
              >
                {building ? <Loader2 size={14} className="animate-spin" /> : null}
                Add Liquidity
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
