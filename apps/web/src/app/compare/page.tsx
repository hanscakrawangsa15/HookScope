"use client";

import { useState } from "react";
import { api, type HookDetail } from "@/lib/api";
import { RiskBadge } from "@/components/ui/risk-badge";
import { CallbackGrid } from "@/components/ui/callback-grid";
import { shortAddress, chainName, formatTvl, CALLBACK_LABELS, cn } from "@/lib/utils";
import { Plus, X, GitCompare } from "lucide-react";

export default function ComparePage() {
  const [addresses, setAddresses] = useState<string[]>(["", ""]);
  const [hooks, setHooks] = useState<(HookDetail | null)[]>([null, null]);
  const [loading, setLoading] = useState<boolean[]>([false, false]);
  const [errors, setErrors] = useState<(string | null)[]>([null, null]);

  const fetchHook = async (index: number, address: string) => {
    if (!address.match(/^0x[0-9a-fA-F]{40}$/)) {
      setErrors((e) => { const n = [...e]; n[index] = "Invalid address"; return n; });
      return;
    }
    setLoading((l) => { const n = [...l]; n[index] = true; return n; });
    setErrors((e) => { const n = [...e]; n[index] = null; return n; });
    try {
      const hook = await api.hooks.get(address);
      setHooks((h) => { const n = [...h]; n[index] = hook; return n; });
    } catch {
      setErrors((e) => { const n = [...e]; n[index] = "Hook not found"; return n; });
      setHooks((h) => { const n = [...h]; n[index] = null; return n; });
    } finally {
      setLoading((l) => { const n = [...l]; n[index] = false; return n; });
    }
  };

  const addSlot = () => {
    if (addresses.length >= 4) return;
    setAddresses([...addresses, ""]);
    setHooks([...hooks, null]);
    setLoading([...loading, false]);
    setErrors([...errors, null]);
  };

  const removeSlot = (index: number) => {
    setAddresses(addresses.filter((_, i) => i !== index));
    setHooks(hooks.filter((_, i) => i !== index));
    setLoading(loading.filter((_, i) => i !== index));
    setErrors(errors.filter((_, i) => i !== index));
  };

  const allCallbackKeys = Object.keys(CALLBACK_LABELS);
  const loadedHooks = hooks.filter((h): h is HookDetail => h !== null);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <GitCompare size={28} className="text-blue-400" />
          Hook Comparator
        </h1>
        <p className="text-gray-400 mt-2">Compare up to 4 hooks side-by-side</p>
      </div>

      {/* Address inputs */}
      <div className="grid gap-4 mb-8" style={{ gridTemplateColumns: `repeat(${addresses.length}, 1fr)` }}>
        {addresses.map((addr, i) => (
          <div key={i} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 font-semibold">Hook {i + 1}</span>
              {addresses.length > 2 && (
                <button onClick={() => removeSlot(i)} className="text-gray-600 hover:text-red-400">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <input
                className="input flex-1 text-sm"
                placeholder="0x..."
                value={addr}
                onChange={(e) => {
                  const n = [...addresses];
                  n[i] = e.target.value;
                  setAddresses(n);
                }}
                onBlur={() => addr && fetchHook(i, addr)}
              />
            </div>
            {errors[i] && <p className="text-xs text-red-400">{errors[i]}</p>}
            {loading[i] && <p className="text-xs text-gray-500">Loading...</p>}
          </div>
        ))}
      </div>

      {addresses.length < 4 && (
        <button onClick={addSlot} className="btn-ghost text-sm mb-8">
          <Plus size={14} /> Add Hook
        </button>
      )}

      {loadedHooks.length >= 2 && (
        <div className="space-y-6">
          {/* Overview comparison */}
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="p-4 text-left text-gray-500 font-medium w-36">Property</th>
                  {loadedHooks.map((h) => (
                    <th key={h.address} className="p-4 text-left font-medium">
                      <div className="font-mono text-blue-400 text-xs">{shortAddress(h.address)}</div>
                      {h.name && <div className="text-white mt-0.5">{h.name}</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                <CompareRow label="Risk Level">
                  {loadedHooks.map((h) => (
                    <td key={h.address} className="p-4">
                      <RiskBadge level={h.riskLevel} score={h.hookScore} />
                    </td>
                  ))}
                </CompareRow>
                <CompareRow label="Audit Status">
                  {loadedHooks.map((h) => (
                    <td key={h.address} className="p-4 text-xs">{h.auditStatus}</td>
                  ))}
                </CompareRow>
                <CompareRow label="Verified Source">
                  {loadedHooks.map((h) => (
                    <td key={h.address} className="p-4">
                      <span className={h.isVerified ? "text-green-400" : "text-gray-500"}>
                        {h.isVerified ? "✓ Yes" : "✗ No"}
                      </span>
                    </td>
                  ))}
                </CompareRow>
                <CompareRow label="Chain">
                  {loadedHooks.map((h) => (
                    <td key={h.address} className="p-4 text-xs text-gray-300">{chainName(h.chainId)}</td>
                  ))}
                </CompareRow>
                <CompareRow label="Proxy Type">
                  {loadedHooks.map((h) => (
                    <td key={h.address} className="p-4 text-xs text-gray-300">{h.proxyType}</td>
                  ))}
                </CompareRow>
                <CompareRow label="TVL">
                  {loadedHooks.map((h) => (
                    <td key={h.address} className="p-4 text-xs text-gray-300">{formatTvl(h.tvlUsd)}</td>
                  ))}
                </CompareRow>
                <CompareRow label="Pools">
                  {loadedHooks.map((h) => (
                    <td key={h.address} className="p-4 text-xs text-gray-300">{h.poolCount}</td>
                  ))}
                </CompareRow>
              </tbody>
            </table>
          </div>

          {/* Callback comparison */}
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-white/10">
              <h2 className="font-semibold text-gray-300">Callback Matrix</h2>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="p-3 text-left text-gray-500 w-44">Callback</th>
                  {loadedHooks.map((h) => (
                    <th key={h.address} className="p-3 text-center font-mono text-blue-400">
                      {shortAddress(h.address, 4)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {allCallbackKeys.map((key) => {
                  const values = loadedHooks.map((h) => h.callbacks[key] ?? false);
                  const allSame = values.every((v) => v === values[0]);
                  return (
                    <tr key={key} className={!allSame ? "bg-yellow-500/5" : ""}>
                      <td className="p-3 text-gray-400 font-mono">{CALLBACK_LABELS[key]}</td>
                      {values.map((v, i) => (
                        <td key={i} className="p-3 text-center">
                          {v ? (
                            <span className="text-blue-400 font-bold">✓</span>
                          ) : (
                            <span className="text-gray-700">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Security flags comparison */}
          <div className="card p-5">
            <h2 className="font-semibold text-gray-300 mb-4">Security Flags</h2>
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${loadedHooks.length}, 1fr)` }}>
              {loadedHooks.map((h) => (
                <div key={h.address}>
                  <p className="font-mono text-xs text-blue-400 mb-2">{shortAddress(h.address)}</p>
                  {h.securityFlags.length === 0 ? (
                    <p className="text-xs text-gray-500">No flags</p>
                  ) : (
                    <div className="space-y-1">
                      {h.securityFlags.map((f) => (
                        <div key={f.id} className="text-xs p-2 rounded bg-red-500/10 text-red-300">
                          {f.category}: {f.severity}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {loadedHooks.length < 2 && (
        <div className="text-center py-20 text-gray-600">
          <GitCompare size={48} className="mx-auto mb-4 opacity-30" />
          <p>Enter at least 2 hook addresses to compare</p>
        </div>
      )}
    </div>
  );
}

function CompareRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <td className="p-4 text-gray-500 font-medium text-xs">{label}</td>
      {children}
    </tr>
  );
}
