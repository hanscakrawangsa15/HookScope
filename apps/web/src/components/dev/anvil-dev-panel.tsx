"use client";

import { useState, useEffect, useCallback } from "react";
import { useChainId } from "wagmi";
import { FlaskConical, Copy, Check, ChevronDown, ChevronUp, Zap, Wallet, Coins, BookOpen } from "lucide-react";

// Well-known Anvil funded accounts — safe to embed, never use these on mainnet.
const ANVIL_ACCOUNTS = [
  {
    label: "Account 0 (deployer)",
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    key: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  },
  {
    label: "Account 1",
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  },
  {
    label: "Account 2",
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    key: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  },
];

const ANVIL_CHAIN = {
  chainId: "0x7A69", // 31337
  chainName: "Anvil Local Fork",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["http://127.0.0.1:8545"],
};

interface TokenAddresses {
  tokenA: string;
  tokenB: string;
  currency0: string;
  currency1: string;
  poolManager: string;
}

export function AnvilDevPanel() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [tokenAddrs, setTokenAddrs] = useState<TokenAddresses | null>(null);
  const [addrError, setAddrError] = useState(false);
  const [switching, setSwitching] = useState(false);
  const chainId = useChainId();
  const isOnAnvil = chainId === 31337;

  const fetchTokens = useCallback(() => {
    setAddrError(false);
    fetch("/api/dev/anvil")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: TokenAddresses) => setTokenAddrs(d))
      .catch(() => { setTokenAddrs(null); setAddrError(true); });
  }, []);

  useEffect(() => {
    if (open) fetchTokens();
  }, [open, fetchTokens]);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const connectAnvil = async () => {
    const eth = (window as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum;
    if (!eth) { alert("Wallet tidak ditemukan. Install MetaMask terlebih dahulu."); return; }
    setSwitching(true);
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ANVIL_CHAIN.chainId }] });
    } catch {
      // Chain not added yet — add it first
      try {
        await eth.request({ method: "wallet_addEthereumChain", params: [ANVIL_CHAIN] });
      } catch (e2) {
        console.error("Failed to add Anvil chain:", e2);
      }
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">

      {/* Panel */}
      {open && (
        <div className="w-80 rounded-2xl text-xs overflow-hidden shadow-2xl"
          style={{ background: "#0d1117", border: "1px solid rgba(34,197,94,0.3)" }}>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3"
            style={{ background: "rgba(34,197,94,0.08)", borderBottom: "1px solid rgba(34,197,94,0.15)" }}>
            <div className="flex items-center gap-2">
              <FlaskConical size={14} className="text-emerald-400" />
              <span className="font-bold text-emerald-300 text-[11px] uppercase tracking-wider">Anvil Dev Tools</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isOnAnvil ? "bg-emerald-400 animate-pulse" : "bg-gray-600"}`} />
              <span className={isOnAnvil ? "text-emerald-400" : "text-gray-500"}>
                {isOnAnvil ? "On Anvil" : `Chain ${chainId}`}
              </span>
            </div>
          </div>

          <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">

            {/* Connect button */}
            <section>
              <div className="flex items-center gap-1.5 mb-2 text-gray-400 font-semibold uppercase tracking-wider" style={{ fontSize: 9 }}>
                <Zap size={10} className="text-yellow-400" /> Network
              </div>
              <button
                onClick={connectAnvil}
                disabled={switching}
                className="w-full rounded-lg px-3 py-2 text-left font-semibold cursor-pointer transition-all"
                style={{
                  background: isOnAnvil ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${isOnAnvil ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.1)"}`,
                  color: isOnAnvil ? "#86efac" : "#9ca3af",
                }}
              >
                {isOnAnvil ? "✅ Terhubung ke Anvil (31337)" : switching ? "Switching…" : "🔗 Hubungkan ke Anvil (31337)"}
              </button>
              {!isOnAnvil && (
                <p className="text-gray-600 mt-1 leading-relaxed" style={{ fontSize: 10 }}>
                  Klik tombol di atas → MetaMask akan tambah dan switch ke chainId 31337 (localhost:8545).
                </p>
              )}
            </section>

            {/* Test Accounts */}
            <section>
              <div className="flex items-center gap-1.5 mb-2 text-gray-400 font-semibold uppercase tracking-wider" style={{ fontSize: 9 }}>
                <Wallet size={10} className="text-blue-400" /> Test Accounts (10.000 ETH each)
              </div>
              <div className="space-y-2">
                {ANVIL_ACCOUNTS.map((acc) => (
                  <div key={acc.address} className="rounded-lg p-2.5 space-y-1.5"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div className="text-gray-400" style={{ fontSize: 9 }}>{acc.label}</div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-gray-300 truncate" style={{ fontSize: 10 }}>
                        {acc.address.slice(0, 20)}…
                      </span>
                      <button onClick={() => copy(acc.address, `addr-${acc.address}`)} className="flex-shrink-0 cursor-pointer text-gray-500 hover:text-gray-300">
                        {copied === `addr-${acc.address}` ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-2"
                      style={{ background: "rgba(168,85,247,0.07)", border: "1px solid rgba(168,85,247,0.15)", borderRadius: 6, padding: "4px 8px" }}>
                      <span className="text-gray-500" style={{ fontSize: 9 }}>Private Key</span>
                      <button
                        onClick={() => copy(acc.key, `key-${acc.address}`)}
                        className="flex items-center gap-1 cursor-pointer text-purple-400 hover:text-purple-300 font-semibold"
                        style={{ fontSize: 10 }}
                      >
                        {copied === `key-${acc.address}` ? (
                          <><Check size={10} className="text-emerald-400" /> Copied!</>
                        ) : (
                          <><Copy size={10} /> Copy Key</>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-gray-700 mt-2 leading-relaxed" style={{ fontSize: 10 }}>
                Copy private key → MetaMask → Import Account → Paste key
              </p>
            </section>

            {/* Test Token Addresses */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-gray-400 font-semibold uppercase tracking-wider" style={{ fontSize: 9 }}>
                  <Coins size={10} className="text-orange-400" /> Test Tokens (setelah pnpm anvil:setup)
                </div>
                <button onClick={fetchTokens} className="text-gray-600 hover:text-gray-400 cursor-pointer" style={{ fontSize: 9 }}>↻ Refresh</button>
              </div>

              {addrError ? (
                <div className="rounded-lg px-3 py-2 text-orange-400" style={{ background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.2)", fontSize: 10 }}>
                  Token belum di-deploy. Jalankan: <code className="font-mono">pnpm anvil:setup</code>
                </div>
              ) : tokenAddrs ? (
                <div className="space-y-1.5">
                  {[
                    { label: "TTKA (18 dec)", value: tokenAddrs.tokenA },
                    { label: "TTKB (6 dec)", value: tokenAddrs.tokenB },
                    { label: "currency0", value: tokenAddrs.currency0 },
                    { label: "currency1", value: tokenAddrs.currency1 },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between gap-2 rounded px-2.5 py-1.5"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <span className="text-gray-500 flex-shrink-0" style={{ fontSize: 9, minWidth: 80 }}>{label}</span>
                      <span className="font-mono text-gray-400 truncate" style={{ fontSize: 10 }}>{value.slice(0, 14)}…</span>
                      <button onClick={() => copy(value, label)} className="flex-shrink-0 cursor-pointer text-gray-600 hover:text-gray-300">
                        {copied === label ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-gray-600 text-center py-2" style={{ fontSize: 10 }}>Loading…</div>
              )}
            </section>

            {/* Pool info */}
            {tokenAddrs && (
              <section>
                <div className="flex items-center gap-1.5 mb-2 text-gray-400 font-semibold uppercase tracking-wider" style={{ fontSize: 9 }}>
                  <BookOpen size={10} className="text-cyan-400" /> Pool Test (fee 0.3%, no hook)
                </div>
                <div className="rounded-lg px-3 py-2 space-y-1 font-mono text-gray-500"
                  style={{ background: "rgba(6,182,212,0.04)", border: "1px solid rgba(6,182,212,0.12)", fontSize: 10 }}>
                  <div>fee: <span className="text-cyan-400">3000</span></div>
                  <div>tickSpacing: <span className="text-cyan-400">60</span></div>
                  <div>hooks: <span className="text-cyan-400">0x000…000</span></div>
                  <div>chainId: <span className="text-cyan-400">31337</span></div>
                </div>
                <p className="text-gray-700 mt-1.5 leading-relaxed" style={{ fontSize: 10 }}>
                  Jalankan <code>pnpm anvil:test</code> untuk inisialisasi pool ini.
                </p>
              </section>
            )}
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-xl px-4 py-2.5 font-semibold cursor-pointer shadow-lg transition-all"
        style={{
          background: open ? "rgba(34,197,94,0.15)" : "#0d1117",
          border: `1px solid ${open ? "rgba(34,197,94,0.4)" : "rgba(34,197,94,0.25)"}`,
          color: "#86efac",
        }}
      >
        <FlaskConical size={14} />
        <span className="text-[11px]">Anvil Dev</span>
        {isOnAnvil && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
        {open ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </button>
    </div>
  );
}
