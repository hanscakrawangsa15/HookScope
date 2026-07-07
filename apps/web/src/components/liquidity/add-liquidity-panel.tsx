"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  useConnection, useChainId, useSwitchChain,
  useReadContract, useWriteContract, useSendTransaction, useWaitForTransactionReceipt,
} from "wagmi";
import { parseUnits, formatUnits, maxUint256, erc20Abi, decodeEventLog, type Address } from "viem";
import { Droplets, AlertTriangle, ExternalLink, Loader2, CheckCircle2 } from "lucide-react";
import { api, type SwapPool } from "@/lib/api";
import {
  MIN_TICK, MAX_TICK, nearestUsableTick,
  V4_POSITION_MANAGER_ADDRESSES, POSITION_MANAGER_TRANSFER_ABI,
} from "@hookscope/shared";
import { RiskBadge } from "@/components/ui/risk-badge";
import { explorerTxUrl } from "@/lib/utils";
import { ConnectButton } from "@/components/wallet/connect-button";
import { PoolRangeChart } from "@/components/liquidity/pool-range-chart";
import { ManualRangeInput } from "@/components/liquidity/manual-range-input";
import { SuggestRangeButton } from "@/components/liquidity/suggest-range-button";
import { demoAutoApprove } from "@/lib/anvil-utils";

// Mainnet rollout: contract addresses (PoolManager/Quoter/PositionManager/StateView)
// for Ethereum/Base/Arbitrum/Optimism re-verified directly against
// developers.uniswap.org/contracts/v4/deployments before enabling — see constants.ts.
const SUPPORTED_CHAIN_IDS = [1, 8453, 42161, 10, 11155111, 84532, 31337];

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const SLIPPAGE_OPTIONS = [0.1, 0.5, 1, 2];
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

type RangePreset = "full" | "10" | "25" | "custom";

function presetTicks(preset: RangePreset, currentTick: number, tickSpacing: number): { tickLower: number; tickUpper: number } {
  if (preset === "full") {
    return { tickLower: nearestUsableTick(MIN_TICK, tickSpacing), tickUpper: nearestUsableTick(MAX_TICK, tickSpacing) };
  }
  const pct = preset === "10" ? 0.10 : 0.25;
  const deltaTicks = Math.round(Math.log(1 + pct) / Math.log(1.0001));
  return {
    tickLower: nearestUsableTick(currentTick - deltaTicks, tickSpacing),
    tickUpper: nearestUsableTick(currentTick + deltaTicks, tickSpacing),
  };
}

interface AddLiquidityPanelProps {
  hookAddress: string;
  chainId: number;
  riskLevel: string;
  hookScore: number | null;
}

export function AddLiquidityPanel({ hookAddress, chainId, riskLevel, hookScore }: AddLiquidityPanelProps) {
  const [pools, setPools] = useState<SwapPool[] | null>(null);
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);
  const [rangePreset, setRangePreset] = useState<RangePreset>("full");
  const [ticks, setTicks] = useState<{ tickLower: number; tickUpper: number } | null>(null);
  const [currentTick, setCurrentTick] = useState<number | null>(null);
  const [amount0Str, setAmount0Str] = useState("");
  const [amount1Str, setAmount1Str] = useState("");
  const [activeSide, setActiveSide] = useState<"amount0" | "amount1" | null>(null);
  const [slippagePct, setSlippagePct] = useState(0.5);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
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
  const isNative0 = pool?.token0.toLowerCase() === ZERO_ADDRESS;
  const isNative1 = pool?.token1.toLowerCase() === ZERO_ADDRESS;
  const symbol0 = pool?.token0Symbol ?? "token0";
  const symbol1 = pool?.token1Symbol ?? "token1";

  const { address: account } = useConnection();
  const walletChainId = useChainId();
  const { mutate: switchChain, isPending: switching } = useSwitchChain();

  // Demo Mode: when wallet is on Anvil (31337) and the hook is on a supported EVM
  // mainnet chain, allow transacting on the Anvil fork instead (Anvil mirrors all
  // V4 contracts + hook bytecode from the block it forked). All API calls and wallet
  // transactions use effectiveChainId=31337 so they hit the local Anvil RPC.
  const isAnvilForkMode =
    walletChainId === 31337 &&
    [1, 8453, 42161, 10, 11155111, 84532].includes(chainId);
  const effectiveChainId = isAnvilForkMode ? 31337 : chainId;
  const isSupportedChain = SUPPORTED_CHAIN_IDS.includes(chainId) || isAnvilForkMode;

  const { data: decimals0Read } = useReadContract({
    address: pool?.token0 as Address | undefined,
    abi: erc20Abi,
    functionName: "decimals",
    chainId: effectiveChainId,
    query: { enabled: !!pool && !isNative0 },
  });
  const { data: decimals1Read } = useReadContract({
    address: pool?.token1 as Address | undefined,
    abi: erc20Abi,
    functionName: "decimals",
    chainId: effectiveChainId,
    query: { enabled: !!pool && !isNative1 },
  });
  const dec0 = isNative0 ? 18 : decimals0Read ?? 18;
  const dec1 = isNative1 ? 18 : decimals1Read ?? 18;

  // Probe the pool's current tick whenever the pool selection changes, so the
  // range presets have a price reference before the user types anything.
  useEffect(() => {
    setRangePreset("full");
    setTicks(null);
    setCurrentTick(null);
    setAmount0Str("");
    setAmount1Str("");
    setQuoteError(null);
    if (!pool || !isSupportedChain) return;
    const fullRange = presetTicks("full", 0, pool.tickSpacing);
    api.lp.quote({
      chainId: effectiveChainId,
      poolKey: { currency0: pool.token0, currency1: pool.token1, fee: pool.fee, tickSpacing: pool.tickSpacing, hooks: hookAddress },
      tickLower: fullRange.tickLower,
      tickUpper: fullRange.tickUpper,
    })
      .then((q) => {
        setTicks(presetTicks("full", q.currentTick, pool.tickSpacing));
        setCurrentTick(q.currentTick);
      })
      .catch((e: Error) => setQuoteError(e.message));
  }, [pool?.poolId, isSupportedChain, chainId, hookAddress]);

  const handlePreset = useCallback((preset: RangePreset) => {
    if (!pool) return;
    setRangePreset(preset);
    api.lp.quote({
      chainId: effectiveChainId,
      poolKey: { currency0: pool.token0, currency1: pool.token1, fee: pool.fee, tickSpacing: pool.tickSpacing, hooks: hookAddress },
      tickLower: presetTicks("full", 0, pool.tickSpacing).tickLower,
      tickUpper: presetTicks("full", 0, pool.tickSpacing).tickUpper,
    })
      .then((q) => {
        setTicks(presetTicks(preset, q.currentTick, pool.tickSpacing));
        setCurrentTick(q.currentTick);
      })
      .catch((e: Error) => setQuoteError(e.message));
  }, [pool, chainId, hookAddress]);

  const handleManualOrSuggestedTicks = useCallback((newTicks: { tickLower: number; tickUpper: number }) => {
    setRangePreset("custom");
    setTicks(newTicks);
  }, []);

  let amount0Raw: bigint | null = null;
  try { amount0Raw = amount0Str && Number(amount0Str) > 0 ? parseUnits(amount0Str, dec0) : null; } catch { amount0Raw = null; }
  let amount1Raw: bigint | null = null;
  try { amount1Raw = amount1Str && Number(amount1Str) > 0 ? parseUnits(amount1Str, dec1) : null; } catch { amount1Raw = null; }

  // Auto-balance the other side whenever the user edits one amount (debounced).
  useEffect(() => {
    if (!pool || !ticks || !activeSide || !isSupportedChain) return;
    const rawAmount = activeSide === "amount0" ? amount0Raw : amount1Raw;
    if (!rawAmount || rawAmount <= 0n) return;
    const handle = setTimeout(() => {
      setQuoteLoading(true);
      setQuoteError(null);
      api.lp.quote({
        chainId,
        poolKey: { currency0: pool.token0, currency1: pool.token1, fee: pool.fee, tickSpacing: pool.tickSpacing, hooks: hookAddress },
        tickLower: ticks.tickLower,
        tickUpper: ticks.tickUpper,
        ...(activeSide === "amount0" ? { amount0: rawAmount.toString() } : { amount1: rawAmount.toString() }),
      })
        .then((q) => {
          if (activeSide === "amount0") setAmount1Str(formatUnits(BigInt(q.amount1), dec1));
          else setAmount0Str(formatUnits(BigInt(q.amount0), dec0));
        })
        .catch((e: Error) => setQuoteError(e.message))
        .finally(() => setQuoteLoading(false));
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSide, amount0Raw?.toString(), amount1Raw?.toString(), ticks, pool, chainId, hookAddress, dec0, dec1]);

  const { data: allowance0, refetch: refetchAllowance0 } = useReadContract({
    address: pool?.token0 as Address | undefined,
    abi: erc20Abi,
    functionName: "allowance",
    args: account ? [account, PERMIT2_ADDRESS as Address] : undefined,
    chainId: effectiveChainId,
    query: { enabled: !!pool && !!account && !isNative0 },
  });
  const { data: allowance1, refetch: refetchAllowance1 } = useReadContract({
    address: pool?.token1 as Address | undefined,
    abi: erc20Abi,
    functionName: "allowance",
    args: account ? [account, PERMIT2_ADDRESS as Address] : undefined,
    chainId: effectiveChainId,
    query: { enabled: !!pool && !!account && !isNative1 },
  });

  const { mutateAsync: writeContractAsync, isPending: approving } = useWriteContract();
  const { mutateAsync: sendTransactionAsync, isPending: sending } = useSendTransaction();
  const { data: receipt, isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash ?? undefined });

  const mintedTokenId = useMemo(() => {
    if (!receipt) return null;
    const pmAddr = V4_POSITION_MANAGER_ADDRESSES[effectiveChainId];
    if (!pmAddr) return null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== pmAddr.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: POSITION_MANAGER_TRANSFER_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName === "Transfer" && decoded.args.from.toLowerCase() === ZERO_ADDRESS) {
          return decoded.args.id.toString();
        }
      } catch { /* not a Transfer log on this contract — skip */ }
    }
    return null;
  }, [receipt, chainId]);

  const needsApproval0 = !isNative0 && amount0Raw != null && (allowance0 ?? 0n) < amount0Raw;
  const needsApproval1 = !isNative1 && amount1Raw != null && (allowance1 ?? 0n) < amount1Raw;
  const [demoApproving, setDemoApproving] = useState(false);

  const handleApprove = useCallback(async (side: "amount0" | "amount1") => {
    if (!pool) return;
    const token = side === "amount0" ? pool.token0 : pool.token1;
    setTxError(null);
    try {
      await writeContractAsync({
        address: token as Address,
        abi: erc20Abi,
        functionName: "approve",
        args: [PERMIT2_ADDRESS as Address, maxUint256],
        chainId: effectiveChainId,
      });
      if (side === "amount0") await refetchAllowance0();
      else await refetchAllowance1();
    } catch (e) {
      setTxError(e instanceof Error ? e.message : "Approval failed");
    }
  }, [pool, chainId, writeContractAsync, refetchAllowance0, refetchAllowance1]);

  const handleMint = useCallback(async () => {
    if (!pool || !ticks || !amount0Raw || !amount1Raw || !account) return;
    setTxError(null);
    setTxHash(null);
    setBuilding(true);
    try {
      const built = await api.lp.build({
        chainId: effectiveChainId,
        poolKey: { currency0: pool.token0, currency1: pool.token1, fee: pool.fee, tickSpacing: pool.tickSpacing, hooks: hookAddress },
        tickLower: ticks.tickLower,
        tickUpper: ticks.tickUpper,
        amount0: amount0Raw.toString(),
        amount1: amount1Raw.toString(),
        recipient: account,
        slippageBps: Math.round(slippagePct * 100),
      });
      const hash = await sendTransactionAsync({
        to: built.to as Address,
        data: built.data as `0x${string}`,
        value: BigInt(built.value),
        chainId: effectiveChainId,
      });
      setTxHash(hash);
    } catch (e) {
      setTxError(e instanceof Error ? e.message : "Mint failed");
    } finally {
      setBuilding(false);
    }
  }, [pool, ticks, amount0Raw, amount1Raw, account, chainId, hookAddress, slippagePct, sendTransactionAsync]);

  // Demo Mode: auto-approve both tokens via Anvil impersonation, then mint.
  // No MetaMask approval popup — Anvil signs txs on behalf of any address.
  const handleDemoMint = useCallback(async () => {
    if (!pool || !account) return;
    setTxError(null);
    setDemoApproving(true);
    try {
      // Fund wallet with enough ETH to cover the LP amount + gas.
      // amount0Raw may be ETH (native) for the position, so ensure wallet has that + buffer.
      const ethNeeded = amount0Raw
        ? Math.ceil(Number(amount0Raw) / 1e18) + 100
        : 1000;
      const { demoEnsureGas, demoFundToken } = await import("@/lib/anvil-utils");
      await demoEnsureGas(account, ethNeeded);

      // Fund ERC20 tokens via storage override so the wallet has enough balance.
      // Uses keccak256 slot computation (OZ ERC20 mapping at slot 0) — immediate,
      // no mining needed, works for any standard OZ ERC20 regardless of supply.
      if (!isNative0 && amount0Raw && amount0Raw > 0n) {
        await demoFundToken(pool.token0, account, amount0Raw * 10n);
      }
      if (!isNative1 && amount1Raw && amount1Raw > 0n) {
        await demoFundToken(pool.token1, account, amount1Raw * 10n);
      }

      if (!isNative0) {
        await demoAutoApprove(pool.token0, account);
        await refetchAllowance0();
      }
      if (!isNative1) {
        await demoAutoApprove(pool.token1, account);
        await refetchAllowance1();
      }
    } catch (e) {
      setTxError(e instanceof Error ? e.message : "Auto-approve gagal — cek Anvil berjalan");
      setDemoApproving(false);
      return;
    }
    setDemoApproving(false);
    await handleMint();
  }, [pool, account, amount0Raw, needsApproval0, needsApproval1, isNative0, isNative1,
      refetchAllowance0, refetchAllowance1, handleMint]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <Droplets size={14} className="text-blue-400" />
          Add Liquidity
        </h2>
        <RiskBadge level={riskLevel} score={hookScore} size="sm" />
      </div>

      {/* Demo / Mainnet mode banner — visually distinct so LP always knows which chain they're on */}
      {isAnvilForkMode ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold"
          style={{ background: "rgba(234,179,8,0.08)", border: "2px solid rgba(234,179,8,0.4)" }}>
          <span className="text-lg">🧪</span>
          <div className="flex-1">
            <span className="text-yellow-300">DEMO MODE — Anvil Fork (chainId 31337)</span>
            <p className="text-yellow-700 text-[10px] font-normal mt-0.5">
              Transaksi dikirim ke local fork — tidak ada ETH/token asli yang terpakai.
              Aman untuk testing tanpa risiko.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs"
          style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.18)" }}>
          <AlertTriangle size={11} className="text-orange-400 flex-shrink-0 mt-0.5" />
          <p className="text-gray-400">
            <span className="text-orange-300 font-semibold">MAINNET</span> — Providing liquidity exposes your funds to this hook&apos;s custom logic on every swap.
            HookScope shows risk transparently but never blocks a mint —
            review the Security section above before proceeding.
          </p>
        </div>
      )}

      {!isSupportedChain ? (
        <div className="rounded-xl p-4 text-xs text-gray-500 text-center"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          Add Liquidity is available on Ethereum, Base, Arbitrum, Optimism, Sepolia, and
          Base Sepolia. This chain isn&apos;t supported yet.
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

          {pool && (
            <PoolRangeChart
              hookAddress={hookAddress}
              poolId={pool.poolId}
              chainId={effectiveChainId}
              currentTick={currentTick}
              decimalsA={dec0}
              decimalsB={dec1}
              tickLower={ticks?.tickLower}
              tickUpper={ticks?.tickUpper}
              tickSpacing={pool.tickSpacing}
              minTick={MIN_TICK}
              maxTick={MAX_TICK}
              symbolA={symbol0}
              symbolB={symbol1}
              onRangeChange={(newLower, newUpper) => {
                handleManualOrSuggestedTicks({ tickLower: newLower, tickUpper: newUpper });
              }}
            />
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
              <div className="px-3 py-2.5 rounded-xl text-xs mb-1 space-y-1"
                style={{ background: "rgba(234,179,8,0.06)", border: "1px dashed rgba(234,179,8,0.35)" }}>
                <div className="flex items-center gap-2">
                  <span>🧪</span>
                  <span className="text-yellow-300 font-bold">DEMO MODE AKTIF — Anvil Fork</span>
                  <span className="ml-auto font-mono text-yellow-700 text-[10px]">chainId 31337</span>
                </div>
                <p className="text-yellow-800 text-[10px] leading-relaxed">
                  MetaMask mungkin menampilkan "Tinjau peringatan" — ini <span className="text-yellow-600 font-semibold">normal dan aman di Demo Mode</span> karena transaksi
                  dikirim ke Anvil fork, bukan mainnet. Tidak ada ETH/token asli yang digunakan.
                </p>
              </div>
            )}
              <div className="flex items-center gap-1.5 px-1">
                <span className="text-[10px] text-gray-500">Range</span>
                {([["full", "Full range"], ["10", "±10%"], ["25", "±25%"]] as [RangePreset, string][]).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => handlePreset(val)}
                    className="text-[10px] px-1.5 py-0.5 rounded cursor-pointer transition-all"
                    style={{
                      background: rangePreset === val ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.04)",
                      border: rangePreset === val ? "1px solid rgba(59,130,246,0.4)" : "1px solid rgba(255,255,255,0.08)",
                      color: rangePreset === val ? "#93c5fd" : "#6b7280",
                    }}
                  >
                    {label}
                  </button>
                ))}
                {pool && (
                  <SuggestRangeButton
                    hookAddress={hookAddress}
                    poolId={pool.poolId}
                    chainId={chainId}
                    currentTick={currentTick}
                    tickSpacing={pool.tickSpacing}
                    minTick={MIN_TICK}
                    maxTick={MAX_TICK}
                    onApply={handleManualOrSuggestedTicks}
                  />
                )}
              </div>

              {pool && (
                <ManualRangeInput
                  currentTick={currentTick}
                  tickSpacing={pool.tickSpacing}
                  decimalsA={dec0}
                  decimalsB={dec1}
                  minTick={MIN_TICK}
                  maxTick={MAX_TICK}
                  symbolA={symbol0}
                  symbolB={symbol1}
                  onApply={handleManualOrSuggestedTicks}
                />
              )}

              <div className="space-y-2">
                <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wide">Amount</span>
                    <span className="text-[10px] text-gray-500">{symbol0}</span>
                  </div>
                  <input
                    type="number" min="0" step="any" placeholder="0.0"
                    value={amount0Str}
                    onChange={(e) => { setActiveSide("amount0"); setAmount0Str(e.target.value); }}
                    className="w-full bg-transparent text-xl font-semibold text-white outline-none"
                  />
                </div>

                <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wide">Amount</span>
                    <span className="text-[10px] text-gray-500">{symbol1}</span>
                  </div>
                  <input
                    type="number" min="0" step="any" placeholder="0.0"
                    value={amount1Str}
                    onChange={(e) => { setActiveSide("amount1"); setAmount1Str(e.target.value); }}
                    className="w-full bg-transparent text-xl font-semibold text-white outline-none"
                  />
                </div>
              </div>

              {quoteLoading && (
                <p className="text-[11px] text-gray-500 px-1 flex items-center gap-1.5">
                  <Loader2 size={10} className="animate-spin" /> Balancing amounts…
                </p>
              )}
              {quoteError && (
                <div className="px-1">
                  <p className="text-[11px] text-orange-400">{quoteError}</p>
                  {isAnvilForkMode && /HTTP request failed|Anvil/i.test(quoteError) && (
                    <p className="text-[10px] text-yellow-600 mt-0.5">
                      → Jalankan <code className="font-mono bg-black/20 px-1 rounded">pnpm anvil:start</code> di terminal, lalu refresh.
                    </p>
                  )}
                </div>
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

              {txError && (
                <div className="px-1 space-y-1">
                  <p className="text-[11px] text-red-400">{txError}</p>
                  {isAnvilForkMode && /0xd81b2f2e|execution reverted/i.test(txError) && (
                    <div className="text-[10px] text-yellow-600 leading-relaxed p-2 rounded"
                      style={{ background: "rgba(234,179,8,0.06)", border: "1px solid rgba(234,179,8,0.2)" }}>
                      <p className="font-semibold text-yellow-500 mb-1">Hook mungkin memiliki pembatasan akses</p>
                      <p>Hook ini (HookScore {hookScore}/100) memiliki custom logic yang mungkin menolak LP dari address ini.</p>
                      <p className="mt-1">Untuk testing tanpa batasan, gunakan <strong>test pool</strong>:</p>
                      <a href="/hooks/0x0000000000000000000000000000000000000000?chainId=31337"
                        className="text-yellow-400 hover:underline font-mono text-[10px]">
                        → Buka Test Pool (no hook, chainId 31337)
                      </a>
                    </div>
                  )}
                </div>
              )}

              {txHash && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                  style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}>
                  {confirming ? (
                    <Loader2 size={12} className="animate-spin text-emerald-400" />
                  ) : confirmed ? (
                    <CheckCircle2 size={12} className="text-emerald-400" />
                  ) : null}
                  <span className="text-emerald-300">
                    {confirming ? "Confirming…" : confirmed
                      ? mintedTokenId ? `Position #${mintedTokenId} minted` : "Mint confirmed"
                      : "Transaction sent"}
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
                // Demo Mode: auto-approve via Anvil impersonation, no MetaMask popup
                <button
                  onClick={handleDemoMint}
                  disabled={!amount0Raw || !amount1Raw || !ticks || demoApproving || building || sending || confirming}
                  className="w-full btn-primary justify-center cursor-pointer disabled:opacity-50"
                  style={{ background: "rgba(234,179,8,0.25)", border: "1px solid rgba(234,179,8,0.5)" }}
                >
                  {demoApproving ? (
                    <><Loader2 size={14} className="animate-spin" /> Auto-approving…</>
                  ) : building || sending || confirming ? (
                    <><Loader2 size={14} className="animate-spin" /> Adding Liquidity…</>
                  ) : (
                    <>🧪 Add Liquidity (Demo — tanpa popup)</>
                  )}
                </button>
              ) : needsApproval0 ? (
                <button
                  onClick={() => handleApprove("amount0")}
                  disabled={approving}
                  className="w-full btn-primary justify-center cursor-pointer disabled:opacity-50"
                >
                  {approving ? <Loader2 size={14} className="animate-spin" /> : null}
                  Approve {symbol0}
                </button>
              ) : needsApproval1 ? (
                <button
                  onClick={() => handleApprove("amount1")}
                  disabled={approving}
                  className="w-full btn-primary justify-center cursor-pointer disabled:opacity-50"
                >
                  {approving ? <Loader2 size={14} className="animate-spin" /> : null}
                  Approve {symbol1}
                </button>
              ) : (
                <button
                  onClick={handleMint}
                  disabled={!amount0Raw || !amount1Raw || !ticks || building || sending || confirming}
                  className="w-full btn-primary justify-center cursor-pointer disabled:opacity-50"
                >
                  {building || sending || confirming ? <Loader2 size={14} className="animate-spin" /> : null}
                  Add Liquidity
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
