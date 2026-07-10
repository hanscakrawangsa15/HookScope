"use client";

import { useState, useEffect, useCallback } from "react";
import { useChainId, useSwitchChain, useSendTransaction, useBalance, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { parseEther } from "viem";
import {
  FlaskConical, Copy, Check, Zap, Wallet,
  ArrowRight, Loader2, CheckCircle2, ExternalLink, AlertTriangle,
} from "lucide-react";

// Well-known Anvil funded accounts — documented in Foundry, safe to embed.
const TEST_ACCOUNTS = [
  { label: "Account 0 (deployer)", address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", key: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" },
  { label: "Account 1", address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" },
];

const ERC20_TRANSFER_ABI = [{
  name: "transfer", type: "function" as const, stateMutability: "nonpayable",
  inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ type: "bool" }],
}] as const;

interface TokenAddrs { tokenA: string; tokenB: string }

export function AnvilDemoSection() {
  const { open } = useAppKit();
  const { isConnected, address: account } = useAppKitAccount({ namespace: "eip155" });
  const chainId = useChainId();
  const isOnAnvil = chainId === 31337;

  const { switchChain, isPending: switching, error: switchError } = useSwitchChain();
  const { sendTransactionAsync, isPending: sending } = useSendTransaction();
  const { writeContractAsync, isPending: minting } = useWriteContract();

  const [copied, setCopied] = useState<string | null>(null);
  const [tokenAddrs, setTokenAddrs] = useState<TokenAddrs | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [demoType, setDemoType] = useState<"eth" | "token">("eth");
  const [txError, setTxError] = useState<string | null>(null);

  const { data: balance } = useBalance({
    address: account as `0x${string}` | undefined,
    chainId: 31337,
    query: { enabled: isOnAnvil && !!account },
  });

  const { data: receipt, isLoading: confirming } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
  });

  useEffect(() => {
    fetch("/api/dev/anvil")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => d && setTokenAddrs(d))
      .catch(() => {});
  }, []);

  const copy = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  const handleSwitchToAnvil = () => {
    switchChain({ chainId: 31337 });
  };

  const runDemo = async () => {
    if (!account) return;
    setTxError(null);
    setTxHash(null);
    const recipient = TEST_ACCOUNTS[1].address as `0x${string}`;
    try {
      let hash: `0x${string}`;
      if (demoType === "token" && tokenAddrs) {
        hash = await writeContractAsync({
          address: tokenAddrs.tokenA as `0x${string}`,
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: [recipient, 1_000_000_000_000_000_000n],
          chainId: 31337,
        });
      } else {
        hash = await sendTransactionAsync({ to: recipient, value: parseEther("0.001"), chainId: 31337 });
      }
      setTxHash(hash);
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      setTxError(msg.split("\n")[0].slice(0, 120));
    }
  };

  // ── Step logic ─────────────────────────────────────────────────────────────
  const step1Done = isConnected;
  const step2Done = isConnected && isOnAnvil;
  const step3Done = !!receipt;

  const ACTIVE_BORDER = (active: boolean, done: boolean) =>
    done ? "rgba(16,185,129,0.35)" : active ? "rgba(99,102,241,0.4)" : "rgba(255,255,255,0.07)";
  const ACTIVE_BG = (active: boolean, done: boolean) =>
    done ? "rgba(16,185,129,0.05)" : active ? "rgba(99,102,241,0.06)" : "rgba(255,255,255,0.02)";

  return (
    <section id="anvil-demo" className="relative z-10 max-w-6xl mx-auto px-6 py-20">
      {/* Heading */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-4"
          style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", color: "#6ee7b7" }}>
          <FlaskConical size={12} />
          Local Demo — Anvil Testnet
        </div>
        <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">
          Try a smart contract transaction right now
        </h2>
        <p className="text-gray-400 max-w-xl mx-auto">
          Connect your wallet to a local Anvil instance and run real transactions on a mainnet fork — no real ETH needed.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">

        {/* ── Step 1: Connect Wallet ─────────────────────────────────────── */}
        <div className="rounded-2xl p-5 transition-all"
          style={{ border: `1px solid ${ACTIVE_BORDER(!step1Done, step1Done)}`, background: ACTIVE_BG(!step1Done, step1Done) }}>
          <div className="flex items-center gap-2 mb-4">
            <span className="font-mono text-sm" style={{ color: step1Done ? "#10b981" : "#6366f1" }}>01</span>
            {step1Done && <CheckCircle2 size={14} className="text-emerald-400" />}
            <h3 className="font-semibold text-sm" style={{ color: step1Done ? "#6ee7b7" : "#e5e7eb" }}>
              Connect Wallet
            </h3>
          </div>

          {step1Done ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium mb-3">
                <CheckCircle2 size={15} /> Wallet connected
              </div>
              <div className="rounded-lg px-3 py-2 font-mono text-xs text-gray-400 truncate"
                style={{ background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.15)" }}>
                {account}
              </div>
            </div>
          ) : (
            <>
              <p className="text-gray-400 text-sm leading-relaxed mb-4">
                Click the button below to connect your wallet (MetaMask / Brave Wallet).
                Choose the wallet you want to use.
              </p>
              <button
                onClick={() => open()}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm cursor-pointer transition-all"
                style={{ background: "rgba(99,102,241,0.2)", border: "1px solid rgba(99,102,241,0.4)", color: "#a5b4fc" }}
              >
                <Wallet size={14} />
                Connect Wallet
              </button>
            </>
          )}
        </div>

        {/* ── Step 2: Switch to Anvil ────────────────────────────────────── */}
        <div className="rounded-2xl p-5 transition-all"
          style={{ border: `1px solid ${ACTIVE_BORDER(step1Done && !step2Done, step2Done)}`, background: ACTIVE_BG(step1Done && !step2Done, step2Done) }}>
          <div className="flex items-center gap-2 mb-4">
            <span className="font-mono text-sm" style={{ color: step2Done ? "#10b981" : step1Done ? "#6366f1" : "#374151" }}>02</span>
            {step2Done && <CheckCircle2 size={14} className="text-emerald-400" />}
            <h3 className="font-semibold text-sm" style={{ color: step2Done ? "#6ee7b7" : step1Done ? "#e5e7eb" : "#6b7280" }}>
              Switch to Anvil (31337)
            </h3>
          </div>

          {step2Done ? (
            <>
              <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium mb-3">
                <CheckCircle2 size={15} /> Connected to Anvil
              </div>
              {/* Show test account info here */}
              <p className="text-gray-500 text-xs mb-2">Import a test account into MetaMask:</p>
              <div className="space-y-2">
                {TEST_ACCOUNTS.map((acc) => (
                  <div key={acc.address} className="rounded-lg p-2.5"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-gray-500 text-[10px]">{acc.label}</span>
                      <button onClick={() => copy(acc.address, `a-${acc.address}`)}
                        className="flex items-center gap-1 cursor-pointer text-gray-600 hover:text-gray-300 font-mono text-[10px]">
                        {copied === `a-${acc.address}` ? <Check size={9} className="text-emerald-400" /> : <Copy size={9} />}
                        {acc.address.slice(0, 8)}…
                      </button>
                    </div>
                    <button
                      onClick={() => copy(acc.key, `k-${acc.address}`)}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
                      style={{ background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.25)", color: "#c4b5fd" }}
                    >
                      {copied === `k-${acc.address}` ? <><Check size={10} className="text-emerald-400" /> Copied!</> : <><Copy size={10} /> Copy Private Key</>}
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-gray-700 text-[10px] mt-2">
                MetaMask → account icon → Import Account → paste key
              </p>
            </>
          ) : (
            <>
              <p className="text-gray-400 text-sm leading-relaxed mb-4">
                Add Anvil Local Fork (chainId 31337) to your wallet.
                All Uniswap v4 contracts are already deployed on this fork.
              </p>
              {switchError && (
                <div className="flex items-start gap-1.5 mb-3 text-orange-300 text-xs"
                  style={{ background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.2)", borderRadius: 8, padding: "8px 10px" }}>
                  <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
                  {switchError.message.split("\n")[0].slice(0, 100)}
                </div>
              )}
              <button
                onClick={handleSwitchToAnvil}
                disabled={!step1Done || switching}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: "rgba(16,185,129,0.2)", border: "1px solid rgba(16,185,129,0.4)", color: "#86efac" }}
              >
                {switching ? <><Loader2 size={14} className="animate-spin" /> Switching…</> : <><Zap size={14} /> Switch to Anvil (31337)</>}
              </button>
              {!step1Done && (
                <p className="text-gray-700 text-xs mt-2 text-center">Complete step 1 first</p>
              )}
            </>
          )}
        </div>

        {/* ── Step 3: Demo Transaction ───────────────────────────────────── */}
        <div className="rounded-2xl p-5 transition-all"
          style={{ border: `1px solid ${ACTIVE_BORDER(step2Done && !step3Done, step3Done)}`, background: ACTIVE_BG(step2Done && !step3Done, step3Done) }}>
          <div className="flex items-center gap-2 mb-4">
            <span className="font-mono text-sm" style={{ color: step3Done ? "#10b981" : step2Done ? "#6366f1" : "#374151" }}>03</span>
            {step3Done && <CheckCircle2 size={14} className="text-emerald-400" />}
            <h3 className="font-semibold text-sm" style={{ color: step3Done ? "#6ee7b7" : step2Done ? "#e5e7eb" : "#6b7280" }}>
              Send Demo Transaction
            </h3>
          </div>

          {step2Done ? (
            <>
              {/* Balance */}
              {balance && (
                <div className="rounded-lg px-3 py-2 mb-3"
                  style={{ background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.15)" }}>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 text-xs">Wallet</span>
                    <span className="font-mono text-gray-400 text-[10px]">{account?.slice(0, 8)}…</span>
                  </div>
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-gray-500 text-xs">Balance</span>
                    <span className="text-emerald-300 font-bold text-sm">
                      {(Number(balance.value) / 1e18).toFixed(4)} ETH
                    </span>
                  </div>
                </div>
              )}

              {/* Demo type */}
              <div className="flex gap-1.5 mb-3">
                {[{ id: "eth", label: "ETH (0.001)" }, { id: "token", label: `TTKA${!tokenAddrs ? " ✗" : ""}` }].map(({ id, label }) => (
                  <button
                    key={id}
                    onClick={() => setDemoType(id as "eth" | "token")}
                    disabled={id === "token" && !tokenAddrs}
                    className="flex-1 py-1.5 rounded-lg text-xs font-medium cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                    style={{
                      background: demoType === id ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.04)",
                      border: `1px solid ${demoType === id ? "rgba(99,102,241,0.4)" : "rgba(255,255,255,0.08)"}`,
                      color: demoType === id ? "#a5b4fc" : "#6b7280",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Preview */}
              <div className="flex items-center gap-2 mb-3 px-2.5 py-2 rounded-lg text-xs"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <Wallet size={11} className="text-gray-500" />
                <span className="text-gray-400">{demoType === "eth" ? "Send 0.001 ETH" : "Send 1 TTKA"}</span>
                <ArrowRight size={10} className="text-gray-600" />
                <span className="font-mono text-gray-500 text-[10px]">Account 1</span>
              </div>

              {/* Result */}
              {txError && (
                <div className="flex items-start gap-1.5 mb-3 text-red-300 text-xs"
                  style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, padding: "8px 10px" }}>
                  <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
                  {txError}
                </div>
              )}

              {txHash && (
                <div className="rounded-lg px-3 py-2 mb-3 text-xs"
                  style={{ background: confirming ? "rgba(59,130,246,0.07)" : "rgba(16,185,129,0.07)", border: `1px solid ${confirming ? "rgba(59,130,246,0.2)" : "rgba(16,185,129,0.25)"}` }}>
                  {confirming ? (
                    <div className="flex items-center gap-2 text-blue-300">
                      <Loader2 size={11} className="animate-spin" /> Confirming…
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-1.5 text-emerald-300 font-semibold mb-1">
                        <CheckCircle2 size={12} /> Transaction confirmed!
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-gray-500 text-[10px] truncate">{txHash.slice(0, 20)}…</span>
                        <ExternalLink size={10} className="text-gray-600 flex-shrink-0" />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={runDemo}
                disabled={sending || minting || confirming}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm cursor-pointer transition-all disabled:opacity-60"
                style={{ background: "rgba(99,102,241,0.2)", border: "1px solid rgba(99,102,241,0.4)", color: "#a5b4fc" }}
              >
                {(sending || minting) ? <><Loader2 size={14} className="animate-spin" /> Sending…</>
                  : confirming ? <><Loader2 size={14} className="animate-spin" /> Confirming…</>
                  : <><Zap size={14} /> Send Demo Transaction</>}
              </button>
            </>
          ) : (
            <div className="text-gray-600 text-sm text-center py-6">
              Complete steps 1 and 2 first
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-gray-600 text-xs">
        All transactions run on an Anvil local fork — no real ETH is used.
        Run <code className="font-mono bg-white/5 px-1.5 py-0.5 rounded">pnpm anvil:start</code> first.
      </p>
    </section>
  );
}
