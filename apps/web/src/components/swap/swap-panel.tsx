"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  useConnection, useChainId, useSwitchChain,
  useReadContract, useWriteContract, useSendTransaction, useWaitForTransactionReceipt,
} from "wagmi";
import { parseUnits, formatUnits, maxUint256, erc20Abi, type Address } from "viem";
import { ArrowDownUp, AlertTriangle, ExternalLink, Loader2, CheckCircle2 } from "lucide-react";
import { api, type SwapPool } from "@/lib/api";
import { demoAutoApprove } from "@/lib/anvil-utils";
import { RiskBadge } from "@/components/ui/risk-badge";
import { explorerTxUrl } from "@/lib/utils";
import { ConnectButton } from "@/components/wallet/connect-button";

// Mainnet rollout: contract addresses (PoolManager/Quoter/PositionManager/StateView)
// for Ethereum/Base/Arbitrum/Optimism re-verified directly against
// developers.uniswap.org/contracts/v4/deployments before enabling — see constants.ts.
const SUPPORTED_CHAIN_IDS = [1, 8453, 42161, 10, 11155111, 84532];

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const SLIPPAGE_OPTIONS = [0.1, 0.5, 1, 2];
// Canonical Permit2 address — identical on every chain HookScope targets.
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

interface SwapPanelProps {
  hookAddress: string;
  chainId: number;
  riskLevel: string;
  hookScore: number | null;
}

function feeLabel(fee: number): string {
  if (fee === 0 || (fee & 0x800000) !== 0) return "dynamic";
  return `${(fee / 10_000).toFixed(3)}%`;
}

export function SwapPanel({ hookAddress, chainId, riskLevel, hookScore }: SwapPanelProps) {
  const [pools, setPools] = useState<SwapPool[] | null>(null);
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);
  const [zeroForOne, setZeroForOne] = useState(true);
  const [amountInStr, setAmountInStr] = useState("");
  const [slippagePct, setSlippagePct] = useState(0.5);
  const [quote, setQuote] = useState<{ amountOut: string; gasEstimate: string; priceImpactBps: number | null } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Address | null>(null);
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
  const tokenIn = pool ? (zeroForOne ? pool.token0 : pool.token1) : null;
  const tokenOut = pool ? (zeroForOne ? pool.token1 : pool.token0) : null;
  const symbolIn = pool ? (zeroForOne ? pool.token0Symbol : pool.token1Symbol) ?? "token0" : "—";
  const symbolOut = pool ? (zeroForOne ? pool.token1Symbol : pool.token0Symbol) ?? "token1" : "—";
  const isNativeIn = tokenIn?.toLowerCase() === ZERO_ADDRESS;

  const { address: account } = useConnection();
  const walletChainId = useChainId();
  const { mutate: switchChain, isPending: switching } = useSwitchChain();

  // Demo Mode: Anvil (31337) forks mainnet — all hook contracts exist at the same
  // addresses. Allow swapping on the fork when wallet is on Anvil.
  const isAnvilForkMode =
    walletChainId === 31337 &&
    [1, 8453, 42161, 10, 11155111, 84532].includes(chainId);
  const effectiveChainId = isAnvilForkMode ? 31337 : chainId;
  const isSupportedChain = SUPPORTED_CHAIN_IDS.includes(chainId) || isAnvilForkMode;

  const { data: decimalsIn } = useReadContract({
    address: tokenIn as Address | undefined,
    abi: erc20Abi,
    functionName: "decimals",
    chainId: effectiveChainId,
    query: { enabled: !!tokenIn && !isNativeIn },
  });
  const { data: decimalsOut } = useReadContract({
    address: tokenOut as Address | undefined,
    abi: erc20Abi,
    functionName: "decimals",
    chainId: effectiveChainId,
    query: { enabled: !!tokenOut && tokenOut.toLowerCase() !== ZERO_ADDRESS },
  });

  const decIn = isNativeIn ? 18 : decimalsIn ?? 18;
  const decOut = tokenOut?.toLowerCase() === ZERO_ADDRESS ? 18 : decimalsOut ?? 18;

  let amountInRaw: bigint | null = null;
  try {
    amountInRaw = amountInStr && Number(amountInStr) > 0 ? parseUnits(amountInStr, decIn) : null;
  } catch { amountInRaw = null; }

  const { data: permit2Allowance, refetch: refetchAllowance } = useReadContract({
    address: tokenIn as Address | undefined,
    abi: erc20Abi,
    functionName: "allowance",
    args: account ? [account, PERMIT2_ADDRESS as Address] : undefined,
    chainId: effectiveChainId,
    query: { enabled: !!tokenIn && !!account && !isNativeIn },
  });

  // Fetch a fresh quote whenever inputs change (debounced).
  useEffect(() => {
    if (!pool || !amountInRaw || amountInRaw <= 0n || !isSupportedChain) {
      setQuote(null);
      return;
    }
    setQuoteError(null);
    const handle = setTimeout(() => {
      setQuoteLoading(true);
      api.swap.quote({
        chainId: effectiveChainId,
        poolKey: { currency0: pool.token0, currency1: pool.token1, fee: pool.fee, tickSpacing: pool.tickSpacing, hooks: hookAddress },
        zeroForOne,
        amountIn: amountInRaw!.toString(),
      })
        .then((q) => setQuote({ amountOut: q.amountOut, gasEstimate: q.gasEstimate, priceImpactBps: q.priceImpactBps }))
        .catch((e: Error) => { setQuote(null); setQuoteError(e.message); })
        .finally(() => setQuoteLoading(false));
    }, 400);
    return () => clearTimeout(handle);
  }, [pool, amountInRaw?.toString(), zeroForOne, chainId, isSupportedChain, hookAddress]);

  const { mutateAsync: writeContractAsync, isPending: approving } = useWriteContract();
  const { mutateAsync: sendTransactionAsync, isPending: sending } = useSendTransaction();
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash ?? undefined });

  const minAmountOut = useMemo(() => {
    if (!quote) return null;
    try {
      const out = BigInt(quote.amountOut);
      const bps = BigInt(Math.round((1 - slippagePct / 100) * 10_000));
      return (out * bps) / 10_000n;
    } catch { return null; }
  }, [quote, slippagePct]);

  const needsApproval = !isNativeIn && amountInRaw != null && (permit2Allowance ?? 0n) < amountInRaw;
  const [demoApproving, setDemoApproving] = useState(false);

  // Demo Mode: auto-approve + swap in one click, no MetaMask approval popup.
  const handleApprove = useCallback(async () => {
    if (!tokenIn || !amountInRaw) return;
    setTxError(null);
    try {
      await writeContractAsync({
        address: tokenIn as Address,
        abi: erc20Abi,
        functionName: "approve",
        args: [PERMIT2_ADDRESS as Address, maxUint256],
        chainId: effectiveChainId,
      });
      await refetchAllowance();
    } catch (e) {
      setTxError(e instanceof Error ? e.message : "Approval failed");
    }
  }, [tokenIn, amountInRaw, chainId, writeContractAsync, refetchAllowance]);

  const handleSwap = useCallback(async () => {
    if (!pool || !amountInRaw || minAmountOut == null) return;
    setTxError(null);
    setTxHash(null);
    try {
      const built = await api.swap.build({
        chainId: effectiveChainId,
        poolKey: { currency0: pool.token0, currency1: pool.token1, fee: pool.fee, tickSpacing: pool.tickSpacing, hooks: hookAddress },
        zeroForOne,
        amountIn: amountInRaw.toString(),
        minAmountOut: minAmountOut.toString(),
      });
      const hash = await sendTransactionAsync({
        to: built.to as Address,
        data: built.data as `0x${string}`,
        value: BigInt(built.value),
        chainId: effectiveChainId,
      });
      setTxHash(hash);
    } catch (e) {
      setTxError(e instanceof Error ? e.message : "Swap failed");
    }
  }, [pool, amountInRaw, minAmountOut, chainId, zeroForOne, hookAddress, sendTransactionAsync]);

  // Demo Mode: auto-approve + swap without MetaMask approval popup.
  const handleDemoSwap = useCallback(async () => {
    if (!tokenIn || !account) return;
    setTxError(null);
    setDemoApproving(true);
    try {
      // Ensure wallet has enough ETH for swap amount + gas
      const ethNeeded = isNativeIn && amountInRaw
        ? Math.ceil(Number(amountInRaw) / 1e18) + 100
        : 200;
      const { demoEnsureGas, demoFundToken } = await import("@/lib/anvil-utils");
      await demoEnsureGas(account, ethNeeded);

      // Fund input ERC20 token via storage slot override so wallet has balance.
      if (!isNativeIn && amountInRaw && amountInRaw > 0n) {
        await demoFundToken(tokenIn, account, amountInRaw * 10n);
      }

      if (!isNativeIn) {
        await demoAutoApprove(tokenIn, account);
        await refetchAllowance();
      }
    } catch (e) {
      setTxError(e instanceof Error ? e.message : "Auto-approve failed — check that Anvil is running");
      setDemoApproving(false);
      return;
    }
    setDemoApproving(false);
    await handleSwap();
  }, [tokenIn, account, amountInRaw, isNativeIn, needsApproval, refetchAllowance, handleSwap]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <ArrowDownUp size={14} className="text-blue-400" />
          Swap
        </h2>
        <RiskBadge level={riskLevel} score={hookScore} size="sm" />
      </div>

      {/* Demo / Mainnet visual distinction */}
      {isAnvilForkMode ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold"
          style={{ background: "rgba(234,179,8,0.08)", border: "2px solid rgba(234,179,8,0.4)" }}>
          <span className="text-lg">🧪</span>
          <div className="flex-1">
            <span className="text-yellow-300">DEMO MODE — Anvil Fork (chainId 31337)</span>
            <p className="text-yellow-700 text-[10px] font-normal mt-0.5">
              Swaps are sent to a local fork — no real tokens or ETH are used.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs"
          style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.18)" }}>
          <AlertTriangle size={11} className="text-orange-400 flex-shrink-0 mt-0.5" />
          <p className="text-gray-400">
            <span className="text-orange-300 font-semibold">MAINNET</span> — You are trading against a pool governed by this hook&apos;s custom logic.
            HookScope shows risk transparently but never blocks a swap — review the Security section above.
          </p>
        </div>
      )}

      {!isSupportedChain ? (
        <div className="rounded-xl p-4 text-xs text-gray-500 text-center"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          Swap is available on Ethereum, Base, Arbitrum, Optimism, Sepolia, and Base
          Sepolia. This chain isn&apos;t supported yet.
        </div>
      ) : pools === null ? (
        <div className="h-40 shimmer rounded-xl" />
      ) : pools.length === 0 ? (
        <div className="rounded-xl p-4 text-xs text-gray-500 text-center"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          No indexed pools for this hook yet.
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
            <div className="flex justify-center py-2"><ConnectButton namespace="eip155" /></div>
          ) : (walletChainId !== chainId && !isAnvilForkMode) ? (
            <button
              onClick={() => switchChain({ chainId })}
              disabled={switching}
              className="w-full btn-primary justify-center cursor-pointer disabled:opacity-50"
            >
              {switching ? <Loader2 size={14} className="animate-spin" /> : null}
              Switch network to continue
            </button>
          ) : (
            <>
              {isAnvilForkMode && (
                <div className="px-3 py-2.5 rounded-xl text-xs space-y-1"
                  style={{ background: "rgba(234,179,8,0.06)", border: "1px dashed rgba(234,179,8,0.35)" }}>
                  <div className="flex items-center gap-2">
                    <span>🧪</span>
                    <span className="text-yellow-300 font-bold">DEMO MODE ACTIVE — Anvil Fork</span>
                    <span className="ml-auto font-mono text-yellow-700 text-[10px]">chainId 31337</span>
                  </div>
                  <p className="text-yellow-800 text-[10px]">
                    Swaps are sent to the Anvil fork — no real tokens are used.
                    MetaMask confirmation is safe here.
                  </p>
                </div>
              )}
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
                      quote ? formatUnits(BigInt(quote.amountOut), decOut) : "0.0"}
                  </p>
                </div>
              </div>

              {quoteError && (
                <p className="text-[11px] text-orange-400 px-1">{quoteError}</p>
              )}

              {quote?.priceImpactBps != null && (
                <p className="text-[11px] px-1"
                  style={{ color: quote.priceImpactBps > 300 ? "#f87171" : quote.priceImpactBps > 50 ? "#fbbf24" : "#6b7280" }}>
                  Est. price impact: {(quote.priceImpactBps / 100).toFixed(2)}%
                </p>
              )}

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

              {txHash && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                  style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}>
                  {confirming ? (
                    <Loader2 size={12} className="animate-spin text-emerald-400" />
                  ) : confirmed ? (
                    <CheckCircle2 size={12} className="text-emerald-400" />
                  ) : null}
                  <span className="text-emerald-300">
                    {confirming ? "Confirming…" : confirmed ? "Swap confirmed" : "Transaction sent"}
                  </span>
                  <a
                    href={explorerTxUrl(txHash, chainId)}
                    target="_blank" rel="noopener noreferrer"
                    className="ml-auto flex items-center gap-1 text-emerald-400 hover:text-emerald-300"
                  >
                    View <ExternalLink size={10} />
                  </a>
                </div>
              )}

              {isAnvilForkMode ? (
                // Demo Mode: auto-approve + swap without MetaMask approval popup
                <button
                  onClick={handleDemoSwap}
                  disabled={!quote || !amountInRaw || demoApproving || sending || confirming}
                  className="w-full btn-primary justify-center cursor-pointer disabled:opacity-50"
                  style={{ background: "rgba(234,179,8,0.25)", border: "1px solid rgba(234,179,8,0.5)" }}
                >
                  {demoApproving ? (
                    <><Loader2 size={14} className="animate-spin" /> Auto-approving…</>
                  ) : sending || confirming ? (
                    <><Loader2 size={14} className="animate-spin" /> Swapping…</>
                  ) : (
                    <>🧪 Swap (Demo — no popup)</>
                  )}
                </button>
              ) : needsApproval ? (
                <button
                  onClick={handleApprove}
                  disabled={approving || !amountInRaw}
                  className="w-full btn-primary justify-center cursor-pointer disabled:opacity-50"
                >
                  {approving ? <Loader2 size={14} className="animate-spin" /> : null}
                  Approve {symbolIn}
                </button>
              ) : (
                <button
                  onClick={handleSwap}
                  disabled={!quote || !amountInRaw || sending || confirming}
                  className="w-full btn-primary justify-center cursor-pointer disabled:opacity-50"
                >
                  {sending || confirming ? <Loader2 size={14} className="animate-spin" /> : null}
                  Swap
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
