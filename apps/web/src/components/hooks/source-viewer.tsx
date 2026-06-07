"use client";

import { useState, useEffect, useCallback } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  FileCode, ChevronRight, ChevronDown, Copy, Check,
  Download, Search, X, AlertTriangle, ExternalLink, Package,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface SourceFile {
  name: string;
  content: string;
  language: string;
}

interface Props {
  address: string;
  isVerified: boolean;
  chainId?: number;
}

// Build a simple file-tree from flat path list
interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

function buildTree(files: SourceFile[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const f of files) {
    const parts = f.name.split("/");
    let level = root;
    let fullPath = "";

    for (let i = 0; i < parts.length; i++) {
      fullPath += (fullPath ? "/" : "") + parts[i];
      const isLast = i === parts.length - 1;
      let existing = level.find((n) => n.name === parts[i]);
      if (!existing) {
        existing = { name: parts[i], path: fullPath, isDir: !isLast, children: [] };
        level.push(existing);
      }
      level = existing.children;
    }
  }

  // Sort: dirs first, then files alphabetically
  function sortNodes(nodes: TreeNode[]): TreeNode[] {
    return nodes
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((n) => ({ ...n, children: sortNodes(n.children) }));
  }

  return sortNodes(root);
}

function FileTree({
  nodes,
  selected,
  onSelect,
  depth = 0,
}: {
  nodes: TreeNode[];
  selected: string;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <div>
      {nodes.map((node) => (
        <div key={node.path}>
          {node.isDir ? (
            <button
              onClick={() => setOpen((o) => ({ ...o, [node.path]: !o[node.path] }))}
              className="flex items-center gap-1 w-full text-left py-0.5 px-1 hover:bg-white/5 rounded text-[11px] text-gray-500 transition-colors"
              style={{ paddingLeft: 8 + depth * 12 }}
            >
              {open[node.path]
                ? <ChevronDown size={10} className="flex-shrink-0" />
                : <ChevronRight size={10} className="flex-shrink-0" />}
              <Package size={10} className="flex-shrink-0 text-gray-600" />
              <span className="truncate">{node.name}</span>
            </button>
          ) : (
            <button
              onClick={() => onSelect(node.path)}
              className="flex items-center gap-1 w-full text-left py-0.5 px-1 rounded text-[11px] transition-colors"
              style={{
                paddingLeft: 8 + depth * 12,
                background: selected === node.path ? "rgba(59,130,246,0.15)" : "transparent",
                color: selected === node.path ? "#93c5fd" : "#9ca3af",
              }}
            >
              <FileCode size={10} className="flex-shrink-0" />
              <span className="truncate">{node.name}</span>
            </button>
          )}
          {node.isDir && open[node.path] && (
            <FileTree nodes={node.children} selected={selected} onSelect={onSelect} depth={depth + 1} />
          )}
        </div>
      ))}
    </div>
  );
}

export function SourceViewer({ address, isVerified, chainId }: Props) {
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [matchLine, setMatchLine] = useState<number | null>(null);

  useEffect(() => {
    if (!isVerified) { setLoading(false); return; }
    const qs = chainId ? `?chainId=${chainId}` : "";
    fetch(`${API_URL}/api/hooks/${address}/source${qs}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.statusText))
      .then((d: { sourceFiles: SourceFile[] }) => {
        setFiles(d.sourceFiles ?? []);
        // Auto-select first non-lib file, or fallback to first
        const main = d.sourceFiles?.find(
          (f) => !f.name.includes("@") && !f.name.startsWith("lib/") && f.name.endsWith(".sol")
        );
        setSelected(main?.name ?? d.sourceFiles?.[0]?.name ?? "");
      })
      .catch(() => setError("Source code tidak tersedia"))
      .finally(() => setLoading(false));
  }, [address, isVerified, chainId]);

  const currentFile = files.find((f) => f.name === selected);

  const handleCopy = useCallback(() => {
    if (!currentFile?.content) return;
    navigator.clipboard.writeText(currentFile.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [currentFile]);

  const handleDownloadAll = useCallback(() => {
    // Download current file
    if (!currentFile?.content) return;
    const blob = new Blob([currentFile.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = currentFile.name.split("/").pop() ?? "contract.sol";
    a.click();
    URL.revokeObjectURL(url);
  }, [currentFile]);

  const handleSearch = useCallback(() => {
    if (!searchQuery || !currentFile?.content) return;
    const lines = currentFile.content.split("\n");
    const idx = lines.findIndex((l) => l.toLowerCase().includes(searchQuery.toLowerCase()));
    setMatchLine(idx >= 0 ? idx + 1 : null);
  }, [searchQuery, currentFile]);

  if (!isVerified) {
    return (
      <div className="card p-8 text-center">
        <AlertTriangle size={32} className="mx-auto mb-3 text-yellow-600 opacity-60" />
        <p className="text-sm text-gray-500 font-medium">Source Code Belum Terverifikasi</p>
        <p className="text-xs text-gray-700 mt-1">
          Deployer belum submit source code ke Etherscan.
        </p>
        <a
          href={`https://etherscan.io/address/${address}`}
          target="_blank"
          rel="noreferrer"
          className="btn-ghost text-xs mt-4 inline-flex items-center gap-1"
        >
          <ExternalLink size={11} /> Lihat di Etherscan
        </a>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card p-8 text-center">
        <div className="w-6 h-6 border border-blue-500/40 border-t-blue-400 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-xs text-gray-600">Memuat source code…</p>
      </div>
    );
  }

  if (error || !files.length) {
    return (
      <div className="card p-8 text-center">
        <AlertTriangle size={28} className="mx-auto mb-2 text-orange-600" />
        <p className="text-sm text-gray-500">{error ?? "Source code tidak ditemukan"}</p>
      </div>
    );
  }

  const tree = buildTree(files);
  const totalLines = currentFile?.content?.split("\n").length ?? 0;

  return (
    <div className="card overflow-hidden" style={{ minHeight: 480 }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/8"
        style={{ background: "rgba(0,0,0,0.3)" }}>
        <div className="flex items-center gap-2">
          <FileCode size={14} className="text-blue-400" />
          <span className="text-xs font-bold text-gray-300">Source Code</span>
          <span className="text-[10px] text-gray-600 ml-1">{files.length} file{files.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Search */}
          {searchOpen ? (
            <div className="flex items-center gap-1">
              <input
                className="h-6 px-2 rounded text-xs bg-white/8 border border-white/10 text-gray-300 focus:outline-none focus:border-blue-500/40 w-32"
                placeholder="Cari…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); if (e.key === "Escape") setSearchOpen(false); }}
                autoFocus
              />
              {matchLine != null && (
                <span className="text-[10px] text-green-400">→ baris {matchLine}</span>
              )}
              {searchQuery && matchLine === null && (
                <span className="text-[10px] text-red-400">tidak ditemukan</span>
              )}
              <button onClick={() => setSearchOpen(false)} className="text-gray-600 hover:text-gray-400">
                <X size={12} />
              </button>
            </div>
          ) : (
            <button onClick={() => setSearchOpen(true)}
              className="p-1 rounded hover:bg-white/8 text-gray-600 hover:text-gray-400 transition-colors">
              <Search size={12} />
            </button>
          )}
          <button onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] hover:bg-white/8 text-gray-500 hover:text-gray-300 transition-colors">
            {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
            {copied ? "Copied!" : "Copy"}
          </button>
          <button onClick={handleDownloadAll}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] hover:bg-white/8 text-gray-500 hover:text-gray-300 transition-colors">
            <Download size={11} /> Download
          </button>
        </div>
      </div>

      <div className="flex" style={{ height: 520 }}>
        {/* File Tree */}
        <div className="flex-shrink-0 overflow-y-auto border-r border-white/8 py-2"
          style={{ width: 200, background: "rgba(0,0,0,0.2)" }}>
          <FileTree nodes={tree} selected={selected} onSelect={setSelected} />
        </div>

        {/* Code Area */}
        <div className="flex-1 overflow-auto relative">
          {/* File tab */}
          <div className="px-4 py-1.5 border-b border-white/6 text-[10px] font-mono text-gray-500 flex items-center justify-between"
            style={{ background: "rgba(0,0,0,0.15)" }}>
            <span className="truncate">{selected}</span>
            <span className="flex-shrink-0 ml-2 text-gray-700">{totalLines} lines</span>
          </div>

          {currentFile?.content ? (
            <SyntaxHighlighter
              language="solidity"
              style={vscDarkPlus}
              showLineNumbers
              wrapLines
              lineNumberStyle={{
                color: "#374151",
                fontSize: "11px",
                userSelect: "none",
                paddingRight: "16px",
                minWidth: "40px",
              }}
              lineProps={(lineNum) =>
                matchLine === lineNum
                  ? { style: { background: "rgba(234,179,8,0.15)", display: "block" } }
                  : {}
              }
              customStyle={{
                margin: 0,
                borderRadius: 0,
                background: "transparent",
                fontSize: "12px",
                lineHeight: "1.6",
              }}
              codeTagProps={{ style: { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" } }}
            >
              {currentFile.content}
            </SyntaxHighlighter>
          ) : (
            <div className="p-8 text-center text-xs text-gray-600">
              File ini kosong atau tidak memiliki konten
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
