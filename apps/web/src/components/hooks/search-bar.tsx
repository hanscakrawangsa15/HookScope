"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, X, Hash } from "lucide-react";
import { api } from "@/lib/api";
import { shortAddress, chainName, cn } from "@/lib/utils";

interface SearchBarProps {
  defaultValue?: string;
  className?: string;
}

export function SearchBar({ defaultValue = "", className }: SearchBarProps) {
  const router = useRouter();
  const [query, setQuery]             = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<Array<{ address: string; name: string | null; chainId: number }>>([]);
  const [open, setOpen]               = useState(false);
  const [focused, setFocused]         = useState(false);
  const inputRef  = useRef<HTMLInputElement>(null);
  const debounce  = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (query.length < 2) { setSuggestions([]); return; }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try {
        const results = await api.search.suggestions(query);
        setSuggestions(results);
        setOpen(results.length > 0);
      } catch { setSuggestions([]); }
    }, 200);
  }, [query]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setOpen(false);
    router.push(`/?q=${encodeURIComponent(query)}`);
  };

  const handleSelect = (address: string, chainId: number) => {
    setOpen(false);
    router.push(`/hooks/${address}?chain=${chainId}`);
  };

  return (
    <div className={cn("relative", className)}>
      <form onSubmit={handleSubmit}>
        <div className="relative group">
          {/* Glow ring on focus */}
          <div
            className="absolute inset-0 rounded-2xl pointer-events-none transition-all duration-300"
            style={{
              boxShadow: focused ? "0 0 0 2px rgba(59,130,246,0.35), 0 0 32px rgba(59,130,246,0.12)" : "none",
            }}
          />
          <Search
            size={17}
            className="absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-200"
            style={{ color: focused ? "#60a5fa" : "#6b7280" }}
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => { setFocused(true); if (suggestions.length > 0) setOpen(true); }}
            onBlur={() => { setFocused(false); setTimeout(() => setOpen(false), 150); }}
            placeholder="Search hooks by name, address, or callback (e.g. 'beforeSwap', '0xabc...')"
            className="w-full py-3.5 pl-11 pr-10 rounded-2xl text-sm outline-none transition-all duration-200"
            style={{
              background: focused ? "rgba(15,20,35,0.95)" : "rgba(255,255,255,0.04)",
              border: "1px solid " + (focused ? "rgba(59,130,246,0.45)" : "rgba(255,255,255,0.08)"),
              color: "#e2e8f0",
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); setSuggestions([]); setOpen(false); inputRef.current?.focus(); }}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300 transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </form>

      {open && suggestions.length > 0 && (
        <div className="absolute top-full mt-2 w-full z-50 rounded-2xl overflow-hidden py-1.5 shadow-2xl"
          style={{ background: "rgba(10,13,22,0.97)", border: "1px solid rgba(255,255,255,0.09)", backdropFilter: "blur(20px)" }}>
          {suggestions.map((s) => (
            <button
              key={`${s.address}-${s.chainId}`}
              onMouseDown={() => handleSelect(s.address, s.chainId)}
              className="w-full px-4 py-2.5 text-left hover:bg-white/5 flex items-center justify-between gap-3 transition-colors group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Hash size={12} className="text-blue-500 shrink-0" />
                <div className="min-w-0">
                  <span className="block text-sm text-blue-400 group-hover:text-blue-300 font-medium truncate transition-colors">
                    {s.name ?? shortAddress(s.address)}
                  </span>
                  <span className="block text-[11px] text-gray-600 font-mono">{shortAddress(s.address, 8)}</span>
                </div>
              </div>
              <span className="text-[11px] text-gray-600 shrink-0">{chainName(s.chainId)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
