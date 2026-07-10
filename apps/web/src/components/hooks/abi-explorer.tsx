"use client";

import { useState, useCallback } from "react";
import { Download, Copy, Check, ChevronDown, ChevronRight, Zap, Eye, ArrowRight } from "lucide-react";

interface AbiItem {
  type: string;
  name?: string;
  inputs?: Array<{ name: string; type: string; internalType?: string }>;
  outputs?: Array<{ name: string; type: string; internalType?: string }>;
  stateMutability?: string;
  anonymous?: boolean;
}

interface Props {
  address: string;
  name: string | null;
  functions: Array<{
    name: string;
    signature: string;
    selector: string;
    params: Array<{ name: string; type: string }>;
    returns: Array<{ name: string; type: string }>;
    visibility: string;
    stateMutability: string;
    natspec: string | null;
    isCallback: boolean;
  }>;
}

const MUTABILITY_COLOR: Record<string, string> = {
  view: "#10b981",
  pure: "#06b6d4",
  nonpayable: "#3b82f6",
  payable: "#f97316",
};

const MUTABILITY_LABEL: Record<string, string> = {
  view: "view",
  pure: "pure",
  nonpayable: "write",
  payable: "payable",
};

function FnRow({ fn, expanded, onToggle }: {
  fn: Props["functions"][0];
  expanded: boolean;
  onToggle: () => void;
}) {
  const color = MUTABILITY_COLOR[fn.stateMutability] ?? "#6b7280";
  const label = MUTABILITY_LABEL[fn.stateMutability] ?? fn.stateMutability;

  return (
    <div className="border-b border-white/5 last:border-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-white/3 transition-colors"
      >
        {expanded
          ? <ChevronDown size={11} className="flex-shrink-0 text-gray-600" />
          : <ChevronRight size={11} className="flex-shrink-0 text-gray-600" />}

        <span className="font-mono text-xs font-semibold text-gray-200">{fn.name}</span>

        {fn.isCallback && (
          <span className="text-[9px] px-1.5 py-0.5 rounded font-bold"
            style={{ background: "rgba(59,130,246,0.15)", color: "#60a5fa" }}>
            CALLBACK
          </span>
        )}

        <span className="text-[9px] px-1.5 py-0.5 rounded font-mono"
          style={{ background: `${color}18`, color }}>
          {label}
        </span>

        {fn.selector && (
          <span className="text-[10px] font-mono text-gray-700 ml-auto">{fn.selector}</span>
        )}
      </button>

      {expanded && (
        <div className="px-8 pb-3 space-y-2">
          {fn.natspec && (
            <p className="text-[11px] text-gray-500 italic border-l-2 border-white/10 pl-2">
              {fn.natspec}
            </p>
          )}

          <div className="font-mono text-[11px] text-gray-400 bg-black/20 rounded px-3 py-2">
            <span className="text-blue-400">function </span>
            <span className="text-yellow-300">{fn.name}</span>
            <span className="text-gray-400">(</span>
            {fn.params.map((p, i) => (
              <span key={i}>
                <span className="text-green-300">{p.type}</span>
                {p.name && <span className="text-gray-300"> {p.name}</span>}
                {i < fn.params.length - 1 && <span className="text-gray-500">, </span>}
              </span>
            ))}
            <span className="text-gray-400">)</span>
            {fn.returns.length > 0 && (
              <>
                <span className="text-gray-600"> returns </span>
                <span className="text-gray-400">(</span>
                {fn.returns.map((r, i) => (
                  <span key={i}>
                    <span className="text-green-300">{r.type}</span>
                    {r.name && <span className="text-gray-400"> {r.name}</span>}
                    {i < fn.returns.length - 1 && <span className="text-gray-500">, </span>}
                  </span>
                ))}
                <span className="text-gray-400">)</span>
              </>
            )}
          </div>

          {fn.params.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-gray-600 uppercase tracking-wider">Parameters</p>
              {fn.params.map((p, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono text-green-400/80 w-20 truncate">{p.type}</span>
                  <ArrowRight size={9} className="text-gray-700" />
                  <span className="text-gray-300">{p.name || `param${i}`}</span>
                </div>
              ))}
            </div>
          )}

          {fn.returns.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-gray-600 uppercase tracking-wider">Returns</p>
              {fn.returns.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono text-blue-400/80 w-20 truncate">{r.type}</span>
                  {r.name && (
                    <>
                      <ArrowRight size={9} className="text-gray-700" />
                      <span className="text-gray-300">{r.name}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AbiExplorer({ address, name, functions }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState<"all" | "callback" | "write" | "read">("all");

  const toggle = (sig: string) =>
    setExpanded((e) => ({ ...e, [sig]: !e[sig] }));

  // Build minimal ABI from functions
  const abi: AbiItem[] = functions.map((fn) => ({
    type: "function",
    name: fn.name,
    inputs: fn.params.map((p) => ({ name: p.name, type: p.type })),
    outputs: fn.returns.map((r) => ({ name: r.name, type: r.type })),
    stateMutability: fn.stateMutability,
  }));

  const handleCopyAbi = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(abi, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [abi]);

  const handleDownloadAbi = useCallback(() => {
    const blob = new Blob([JSON.stringify(abi, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(name ?? address).replace(/\s+/g, "_")}_abi.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [abi, name, address]);

  const filtered = functions.filter((fn) => {
    if (filter === "callback") return fn.isCallback;
    if (filter === "write") return fn.stateMutability === "nonpayable" || fn.stateMutability === "payable";
    if (filter === "read") return fn.stateMutability === "view" || fn.stateMutability === "pure";
    return true;
  });

  if (!functions.length) {
    return (
      <div className="card p-8 text-center">
        <Eye size={28} className="mx-auto mb-2 text-gray-700" />
        <p className="text-sm text-gray-600">ABI not available — source code is not yet verified</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/8"
        style={{ background: "rgba(0,0,0,0.2)" }}>
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-yellow-400" />
          <span className="text-xs font-bold text-gray-300">ABI Explorer</span>
          <span className="text-[10px] text-gray-600">{functions.length} function{functions.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleCopyAbi}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] hover:bg-white/8 text-gray-500 hover:text-gray-300 transition-colors">
            {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
            {copied ? "Copied!" : "Copy ABI"}
          </button>
          <button onClick={handleDownloadAbi}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] hover:bg-white/8 text-gray-500 hover:text-gray-300 transition-colors">
            <Download size={11} /> Download JSON
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-0 border-b border-white/6" style={{ background: "rgba(0,0,0,0.1)" }}>
        {(["all", "callback", "read", "write"] as const).map((tab) => {
          const counts: Record<string, number> = {
            all: functions.length,
            callback: functions.filter((f) => f.isCallback).length,
            read: functions.filter((f) => f.stateMutability === "view" || f.stateMutability === "pure").length,
            write: functions.filter((f) => f.stateMutability === "nonpayable" || f.stateMutability === "payable").length,
          };
          const colors: Record<string, string> = { all: "#6b7280", callback: "#3b82f6", read: "#10b981", write: "#f97316" };
          return (
            <button key={tab} onClick={() => setFilter(tab)}
              className="px-4 py-2 text-[11px] font-medium transition-colors capitalize"
              style={{
                color: filter === tab ? colors[tab] : "#6b7280",
                borderBottom: filter === tab ? `2px solid ${colors[tab]}` : "2px solid transparent",
              }}>
              {tab === "all" ? "All" : tab} ({counts[tab]})
            </button>
          );
        })}
      </div>

      {/* Function list */}
      <div className="overflow-y-auto" style={{ maxHeight: 400 }}>
        {filtered.map((fn) => (
          <FnRow
            key={fn.signature || fn.name}
            fn={fn}
            expanded={!!expanded[fn.signature || fn.name]}
            onToggle={() => toggle(fn.signature || fn.name)}
          />
        ))}
        {!filtered.length && (
          <p className="text-center text-xs text-gray-600 py-8">No functions in this category</p>
        )}
      </div>
    </div>
  );
}
