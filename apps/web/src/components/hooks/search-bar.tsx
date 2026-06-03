"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { shortAddress, chainName } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  defaultValue?: string;
  className?: string;
}

export function SearchBar({ defaultValue = "", className }: SearchBarProps) {
  const router = useRouter();
  const [query, setQuery] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<
    Array<{ address: string; name: string | null; chainId: number }>
  >([]);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await api.search.suggestions(query);
        setSuggestions(results);
        setOpen(results.length > 0);
      } catch {
        setSuggestions([]);
      }
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
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            placeholder="Search by name, address, or function (e.g. 'swap fee', 'MEV')"
            className={cn("input pl-9 pr-9")}
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); setSuggestions([]); setOpen(false); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </form>

      {open && suggestions.length > 0 && (
        <div className="absolute top-full mt-1 w-full card shadow-xl z-50 py-1">
          {suggestions.map((s) => (
            <button
              key={`${s.address}-${s.chainId}`}
              onClick={() => handleSelect(s.address, s.chainId)}
              className="w-full px-4 py-2.5 text-left hover:bg-white/5 flex items-center justify-between"
            >
              <span className="font-mono text-sm text-blue-400">
                {s.name ?? shortAddress(s.address)}
              </span>
              <span className="text-xs text-gray-500">{chainName(s.chainId)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
