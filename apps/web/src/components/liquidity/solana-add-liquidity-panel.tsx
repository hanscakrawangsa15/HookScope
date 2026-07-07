"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { useAppKitConnection } from "@reown/appkit-adapter-solana/react";
import type { Provider } from "@reown/appkit-adapter-solana";
import { Transaction } from "@solana/web3.js";
import { Droplets, AlertTriangle, ExternalLink, Loader2, CheckCircle2 } from "lucide-react";
import { api, type SwapPool } from "@/lib/api";
import { RiskBadge } from "@/components/ui/risk-badge";
import { explorerTxUrl } from "@/lib/utils";
import { ConnectButton } from "@/components/wallet/connect-button";
import { PoolRangeChart } from "@/components/liquidity/pool-range-chart";
import { ManualRangeInput } from "@/components/liquidity/manual-range-input";
import { SuggestRangeButton } from "@/components/liquidity/suggest-range-button";

const SOLANA_CHAIN_ID = 1399811149;
const SLIPPAGE_OPTIONS = [0.1, 0.5, 1, 2];
// Real, SDK-exported invariants (whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc's
// MIN_TICK_INDEX/MAX_TICK_INDEX) — not guessed, mirrors MIN_TICK/MAX_TICK on the EVM side.
const MIN_TICK_INDEX = -443636;
const MAX_TICK_INDEX = 443636;

type RangePreset = "full" | "10" | "25" | "custom";

// Mirrors nearestUsableTick from @hookscope/shared, but for Orca's tick semantics
// (its own TickUtil.getInitializableTickIndex lives server-side only — this is a
// client-side preview before the user has typed anything, refined by the live
// quote response once it lands).
function nearestUsableTick(tick: number, tickSpacing: number): number {
  const rounded = Math.round(tick / tickSpacing) * tickSpacing;
  if (rounded < MIN_TICK_INDEX) return Math.ceil(MIN_TICK_INDEX / tickSpacing) * tickSpacing;
  if (rounded > MAX_TICK_INDEX) return Math.floor(MAX_TICK_INDEX / tickSpacing) * tickSpacing;
  return rounded;
}

function presetTicks(preset: RangePreset, currentTick: number, tickSpacing: number): { tickLower: number; tickUpper: number } {
  if (preset === "full") {
    return { tickLower: nearestUsableTick(MIN_TICK_INDEX, tickSpacing), tickUpper: nearestUsableTick(MAX_TICK_INDEX, tickSpacing) };
  }
  const pct = preset === "10" ? 0.10 : 0.25;
  const deltaTicks = Math.round(Math.log(1 + pct) / Math.log(1.0001));
  return {
    tickLower: nearestUsableTick(currentTick - deltaTicks, tickSpacing),
    tickUpper: nearestUsableTick(currentTick + deltaTicks, tickSpacing),
  };
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

interface SolanaAddLiquidityPanelProps {
  hookAddress: string;
  riskLevel: string;
  hookScore: number | null;
}

export function SolanaAddLiquidityPanel({ hookAddress, riskLevel, hookScore }: SolanaAddLiquidityPanelProps) {
  const [pools, setPools] = useState<SwapPool[] | null>(null);
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);
  const [rangePreset, setRangePreset] = useState<RangePreset>("full");
  const [ticks, setTicks] = useState<{ tickLower: number; tickUpper: number } | null>(null);
  const [currentTick, setCurrentTick] = useState<number | null>(null);
  const [decimalsA, setDecimalsA] = useState(9);
  const [decimalsB, setDecimalsB] = useState(9);
  const [amountAStr, setAmountAStr] = useState("");
  const [amountBStr, setAmountBStr] = useState("");
  const [activeSide, setActiveSide] = useState<"amountA" | "amountB" | null>(null);
  const [slippagePct, setSlippagePct] = useState(0.5);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [mintedPositionMint, setMintedPositionMint] = useState<string | null>(null);
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

  // Probe the pool's current tick whenever the pool selection changes, so the
  // range presets have a price reference before the user types anything.
  useEffect(() => {
    setRangePreset("full");
    setTicks(null);
    setCurrentTick(null);
    setAmountAStr("");
    setAmountBStr("");
    setQuoteError(null);
    if (!pool) return;
    const fullRange = presetTicks("full", 0, pool.tickSpacing);
    api.solanaLp.quote({ whirlpoolAddress: pool.poolId, tickLower: fullRange.tickLower, tickUpper: fullRange.tickUpper })
      .then((q) => {
        setTicks(presetTicks("full", q.currentTick, pool.tickSpacing));
        setCurrentTick(q.currentTick);
        setDecimalsA(q.decimalsA);
        setDecimalsB(q.decimalsB);
      })
      .catch((e: Error) => setQuoteError(e.message));
  }, [pool?.poolId]);

  const handlePreset = useCallback((preset: RangePreset) => {
    if (!pool) return;
    setRangePreset(preset);
    const fullRange = presetTicks("full", 0, pool.tickSpacing);
    api.solanaLp.quote({ whirlpoolAddress: pool.poolId, tickLower: fullRange.tickLower, tickUpper: fullRange.tickUpper })
      .then((q) => {
        setTicks(presetTicks(preset, q.currentTick, pool.tickSpacing));
        setCurrentTick(q.currentTick);
      })
      .catch((e: Error) => setQuoteError(e.message));
  }, [pool]);

  const handleManualOrSuggestedTicks = useCallback((newTicks: { tickLower: number; tickUpper: number }) => {
    setRangePreset("custom");
    setTicks(newTicks);
  }, []);

  const amountARaw = parseAmount(amountAStr, decimalsA);
  const amountBRaw = parseAmount(amountBStr, decimalsB);

  // Auto-balance the other side whenever the user edits one amount (debounced).
  useEffect(() => {
    if (!pool || !ticks || !activeSide) return;
    const rawAmount = activeSide === "amountA" ? amountARaw : amountBRaw;
    if (!rawAmount || rawAmount <= 0n) return;
    const handle = setTimeout(() => {
      setQuoteLoading(true);
      setQuoteError(null);
      api.solanaLp.quote({
        whirlpoolAddress: pool.poolId,
        tickLower: ticks.tickLower,
        tickUpper: ticks.tickUpper,
        ...(activeSide === "amountA" ? { amountA: rawAmount.toString() } : { amountB: rawAmount.toString() }),
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
  }, [activeSide, amountARaw?.toString(), amountBRaw?.toString(), ticks, pool]);

  const handleMint = useCallback(async () => {
    if (!pool || !ticks || !amountARaw || !amountBRaw || !account) return;
    setTxError(null);
    setTxSignature(null);
    setMintedPositionMint(null);
    setBuilding(true);
    try {
      const built = await api.solanaLp.build({
        whirlpoolAddress: pool.poolId,
        tickLower: ticks.tickLower,
        tickUpper: ticks.tickUpper,
        amountA: amountARaw.toString(),
        amountB: amountBRaw.toString(),
        owner: account,
        slippageBps: Math.round(slippagePct * 100),
      });
      const transaction = Transaction.from(Buffer.from(built.transactionBase64, "base64"));
      if (!connection) throw new Error("Solana connection unavailable");
      const signature = await walletProvider.sendTransaction(transaction, connection);
      setTxSignature(signature);
      setMintedPositionMint(built.positionMint);
    } catch (e) {
      setTxError(e instanceof Error ? e.message : "Mint failed");
    } finally {
      setBuilding(false);
    }
  }, [pool, ticks, amountARaw, amountBRaw, account, slippagePct, connection, walletProvider]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <Droplets size={14} className="text-purple-400" />
          Add Liquidity (Orca Whirlpool)
        </h2>
        <RiskBadge level={riskLevel} score={hookScore} size="sm" />
      </div>

      <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs"
        style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.18)" }}>
        <AlertTriangle size={11} className="text-orange-400 flex-shrink-0 mt-0.5" />
        <p className="text-gray-400">
          Providing liquidity exposes your funds to this pool&apos;s on-chain logic on every swap
          against your position. HookScope shows risk transparently but never blocks a mint.
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
            <PoolRangeChart
              hookAddress={hookAddress}
              poolId={pool.poolId}
              chainId={SOLANA_CHAIN_ID}
              currentTick={currentTick}
              decimalsA={decimalsA}
              decimalsB={decimalsB}
              tickLower={ticks?.tickLower}
              tickUpper={ticks?.tickUpper}
              tickSpacing={pool.tickSpacing}
              minTick={MIN_TICK_INDEX}
              maxTick={MAX_TICK_INDEX}
              symbolA={symbolA}
              symbolB={symbolB}
              onRangeChange={(lo, hi) => handleManualOrSuggestedTicks({ tickLower: lo, tickUpper: hi })}
            />
          )}

          {!account ? (
            <div className="flex justify-center py-2"><ConnectButton namespace="solana" /></div>
          ) : (
            <>
              <div className="flex items-center gap-1.5 px-1">
                <span className="text-[10px] text-gray-500">Range</span>
                {([["full", "Full range"], ["10", "±10%"], ["25", "±25%"]] as [RangePreset, string][]).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => handlePreset(val)}
                    className="text-[10px] px-1.5 py-0.5 rounded cursor-pointer transition-all"
                    style={{
                      background: rangePreset === val ? "rgba(168,85,247,0.2)" : "rgba(255,255,255,0.04)",
                      border: rangePreset === val ? "1px solid rgba(168,85,247,0.4)" : "1px solid rgba(255,255,255,0.08)",
                      color: rangePreset === val ? "#d8b4fe" : "#6b7280",
                    }}
                  >
                    {label}
                  </button>
                ))}
                {pool && (
                  <SuggestRangeButton
                    hookAddress={hookAddress}
                    poolId={pool.poolId}
                    chainId={SOLANA_CHAIN_ID}
                    currentTick={currentTick}
                    tickSpacing={pool.tickSpacing}
                    minTick={MIN_TICK_INDEX}
                    maxTick={MAX_TICK_INDEX}
                    onApply={handleManualOrSuggestedTicks}
                  />
                )}
              </div>

              {pool && (
                <ManualRangeInput
                  currentTick={currentTick}
                  tickSpacing={pool.tickSpacing}
                  decimalsA={decimalsA}
                  decimalsB={decimalsB}
                  minTick={MIN_TICK_INDEX}
                  maxTick={MAX_TICK_INDEX}
                  symbolA={symbolA}
                  symbolB={symbolB}
                  onApply={handleManualOrSuggestedTicks}
                />
              )}

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
                  <span className="text-emerald-300">
                    {mintedPositionMint ? `Position ${mintedPositionMint.slice(0, 4)}…${mintedPositionMint.slice(-4)} minted` : "Mint confirmed"}
                  </span>
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
                onClick={handleMint}
                disabled={!amountARaw || !amountBRaw || !ticks || building}
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
