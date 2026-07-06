"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useChainId, useSwitchChain, useBalance } from "wagmi";
import { useAppKitAccount } from "@reown/appkit/react";
import { FlaskConical, Copy, Check, Zap, X, ChevronDown, Loader2, Coins } from "lucide-react";
import { type Address } from "viem";
import { demoFundWallet, demoFundERC20 } from "@/lib/anvil-utils";

const ANVIL_RPC = "http://127.0.0.1:8545";
const ACCOUNT0_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;

const TEST_ACCOUNTS = [
  { label: "Account 0", address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", key: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" },
  { label: "Account 1", address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" },
];

export function DemoModeToggle() {
  const chainId = useChainId();
  const isOnAnvil = chainId === 31337;
  const { isConnected, address: account } = useAppKitAccount({ namespace: "eip155" });
  const { switchChain, isPending } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [funding, setFunding] = useState(false);
  const [fundMsg, setFundMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [anvilStatus, setAnvilStatus] = useState<"unknown" | "up" | "down">("unknown");
  const ref = useRef<HTMLDivElement>(null);

  // Check Anvil health every 15s when the popover is open
  const checkAnvil = useCallback(async () => {
    try {
      const res = await fetch(ANVIL_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }),
        signal: AbortSignal.timeout(3000),
      });
      const data = await res.json() as { result?: string };
      setAnvilStatus(data.result ? "up" : "down");
    } catch {
      setAnvilStatus("down");
    }
  }, []);

  useEffect(() => {
    if (!open || !isOnAnvil) return;
    checkAnvil();
    const id = setInterval(checkAnvil, 15_000);
    return () => clearInterval(id);
  }, [open, isOnAnvil, checkAnvil]);

  const { data: balance } = useBalance({
    address: account as `0x${string}` | undefined,
    chainId: 31337,
    query: { enabled: isOnAnvil && !!account },
  });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const fundWallet = async () => {
    if (!account) return;
    setFunding(true);
    setFundMsg(null);
    try {
      if (account.toLowerCase() === ACCOUNT0_ADDR.toLowerCase()) {
        setFundMsg({ ok: false, text: "Kamu sudah menggunakan Account 0 — tidak perlu di-fund." });
        return;
      }
      await demoFundWallet(account);
      const ok = true;
      if (!ok) throw new Error("anvil_setBalance gagal");

      // Also try to fund ERC20 tokens from the current page's pool (if available)
      // by loading deployed test tokens from the dev API
      let tokenMsg = "";
      try {
        const addrs = await fetch("/api/dev/anvil").then(r => r.ok ? r.json() : null) as {
          tokenA: string; tokenB: string;
        } | null;
        if (addrs) {
          // Use the Anvil deployer (Account 0) as whale — it already has tokens from anvil:setup
          const amt = 1_000n * 10n ** 18n;
          const amtB = 1_000_000n * 10n ** 6n;
          await demoFundERC20(addrs.tokenA, account, amt);
          await demoFundERC20(addrs.tokenB, account, amtB);
          tokenMsg = " + 1000 TTKA + 1M TTKB";
        }
      } catch { /* test tokens not set up — ETH only is fine */ }

      setFundMsg({ ok: true, text: `Wallet diberi 10 ETH${tokenMsg}. Balance akan update otomatis.` });
    } catch (e) {
      setFundMsg({ ok: false, text: `Gagal: ${(e as Error).message.slice(0, 80)}` });
    } finally {
      setFunding(false);
    }
  };

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!isConnected) return null;

  return (
    <div ref={ref} className="relative">
      {/* Toggle button */}
      <button
        onClick={() => isOnAnvil ? setOpen(v => !v) : switchChain({ chainId: 31337 })}
        disabled={isPending}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all"
        style={{
          background: isOnAnvil ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.05)",
          border: `1px solid ${isOnAnvil ? "rgba(16,185,129,0.4)" : "rgba(255,255,255,0.12)"}`,
          color: isOnAnvil ? "#86efac" : "#6b7280",
        }}
        title={isOnAnvil ? "Demo Mode aktif" : "Masuk ke Demo Mode (Anvil)"}
      >
        <FlaskConical size={12} className={isOnAnvil ? "text-emerald-400" : "text-gray-600"} />
        {isPending ? "Switching…" : isOnAnvil ? "Demo" : "Demo"}
        {isOnAnvil
          ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          : <ChevronDown size={10} className="text-gray-600" />
        }
      </button>

      {/* Popover (only when on Anvil) */}
      {open && isOnAnvil && (
        <div className="absolute right-0 top-full mt-2 w-72 rounded-2xl shadow-2xl z-50 overflow-hidden"
          style={{ background: "#0d1117", border: "1px solid rgba(16,185,129,0.3)" }}>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3"
            style={{ background: "rgba(16,185,129,0.08)", borderBottom: "1px solid rgba(16,185,129,0.15)" }}>
            <div className="flex items-center gap-2">
              <FlaskConical size={13} className="text-emerald-400" />
              <span className="text-emerald-300 font-bold text-[11px] uppercase tracking-wider">Demo Mode Aktif</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Anvil health indicator */}
              <div className="flex items-center gap-1 text-[10px]">
                <span className={`w-1.5 h-1.5 rounded-full ${anvilStatus === "up" ? "bg-emerald-400 animate-pulse" : anvilStatus === "down" ? "bg-red-400" : "bg-yellow-500"}`} />
                <span className={anvilStatus === "up" ? "text-emerald-400" : anvilStatus === "down" ? "text-red-400" : "text-gray-500"}>
                  Anvil {anvilStatus === "up" ? "OK" : anvilStatus === "down" ? "MATI" : "..."}
                </span>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-600 hover:text-gray-300 cursor-pointer">
                <X size={13} />
              </button>
            </div>
          </div>

          {/* Anvil down warning */}
          {anvilStatus === "down" && (
            <div className="mx-4 mt-3 px-3 py-2.5 rounded-xl text-xs"
              style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.35)" }}>
              <p className="text-red-300 font-semibold mb-1">⚠ Anvil tidak berjalan!</p>
              <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
                Quote dan transaksi akan gagal selama Anvil mati.
              </p>
              <p className="font-mono text-yellow-300 text-[10px] p-2 rounded bg-black/30">
                pnpm anvil:start
              </p>
              <p className="text-gray-600 text-[10px] mt-1.5">
                Jalankan di terminal baru, lalu tunggu "Listening on 127.0.0.1:8545".
              </p>
            </div>
          )}

          <div className="p-4 space-y-3">
            {/* Status */}
            <div className="rounded-xl px-3 py-2.5 text-xs"
              style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)" }}>
              <div className="flex justify-between items-center mb-1">
                <span className="text-gray-500">Network</span>
                <span className="text-emerald-300 font-mono font-semibold">Anvil (31337)</span>
              </div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-gray-500">RPC</span>
                <span className="text-gray-400 font-mono text-[10px]">localhost:8545</span>
              </div>
              {balance && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Balance</span>
                  <span className="text-white font-bold">{(Number(balance.value) / 1e18).toFixed(4)} ETH</span>
                </div>
              )}
            </div>

            {/* Fund Current Wallet */}
            <div>
              <p className="text-gray-600 text-[10px] uppercase font-semibold tracking-wider mb-2 flex items-center gap-1">
                <Coins size={9} className="text-yellow-500" /> Fund Wallet Aktif
              </p>
              <div className="rounded-xl p-2.5 mb-2"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <p className="text-gray-600 text-[10px] mb-2 leading-relaxed">
                  Wallet <span className="font-mono text-gray-500">{account?.slice(0,8)}…</span> tidak punya ETH di Anvil.
                  Klik tombol di bawah untuk otomatis memberi 100 ETH (+ test tokens TTKA/TTKB jika sudah di-setup).
                </p>
                <button
                  onClick={fundWallet}
                  disabled={funding || !account}
                  className="w-full flex items-center justify-center gap-2 py-1.5 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50"
                  style={{ background: "rgba(234,179,8,0.15)", border: "1px solid rgba(234,179,8,0.35)", color: "#fde047" }}
                >
                  {funding ? <><Loader2 size={11} className="animate-spin" /> Funding…</> : <><Coins size={11} /> Beri 10 ETH ke Wallet Ini</>}
                </button>
                {fundMsg && (
                  <p className={`text-[10px] mt-1.5 leading-relaxed ${fundMsg.ok ? "text-emerald-400" : "text-red-400"}`}>
                    {fundMsg.ok ? "✅" : "❌"} {fundMsg.text}
                  </p>
                )}
              </div>
            </div>

            {/* Test Accounts */}
            <div>
              <p className="text-gray-600 text-[10px] uppercase font-semibold tracking-wider mb-2">Test Accounts (10.000 ETH)</p>
              <div className="space-y-2">
                {TEST_ACCOUNTS.map(acc => (
                  <div key={acc.address} className="rounded-lg p-2.5"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-gray-500 text-[10px]">{acc.label}</span>
                      <button onClick={() => copy(acc.address, `a${acc.address}`)}
                        className="flex items-center gap-1 cursor-pointer text-gray-600 hover:text-gray-300 text-[10px] font-mono">
                        {copied === `a${acc.address}` ? <Check size={9} className="text-emerald-400" /> : <Copy size={9} />}
                        {acc.address.slice(0, 10)}…
                      </button>
                    </div>
                    <button
                      onClick={() => copy(acc.key, `k${acc.address}`)}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer"
                      style={{ background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.25)", color: "#c4b5fd" }}
                    >
                      {copied === `k${acc.address}` ? <><Check size={10} className="text-emerald-400" /> Key disalin!</> : <><Copy size={10} /> Copy Private Key</>}
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-gray-700 text-[10px] mt-2">
                MetaMask → ikon akun → Import Account → paste key
              </p>
            </div>

            {/* Link to test pool */}
            <a
              href="/hooks/0x0000000000000000000000000000000000000000?chainId=31337"
              onClick={() => setOpen(false)}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all"
              style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)", color: "#6ee7b7" }}
            >
              <Zap size={11} /> Buka Test Pool → Swap &amp; Add Liquidity
            </a>

            {/* Exit demo */}
            <button
              onClick={() => { switchChain({ chainId: 1 }); setOpen(false); }}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#6b7280" }}
            >
              Exit Demo Mode → Mainnet
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
