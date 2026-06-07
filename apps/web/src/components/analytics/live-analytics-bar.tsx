"use client";

import { useEffect, useState, useCallback } from "react";
import { formatTvl } from "@/lib/utils";
import { Activity, Layers, TrendingUp, Zap } from "lucide-react";

interface GlobalAnalytics {
  totalHooks: number;
  totalPools: number;
  totalTVLUsd: number;
  topHooks?: Array<{ address: string; name: string | null; riskLevel: string; tvlUsd: number }>;
  timestamp: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export function LiveAnalyticsBar() {
  const [data, setData]           = useState<GlobalAnalytics | null>(null);
  const [loading, setLoading]     = useState(true);
  const [pulsing, setPulsing]     = useState(false);
  const [lastUpd, setLastUpd]     = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/analytics/global`, { cache: "no-store" });
      if (!res.ok) return;
      const raw = await res.json() as GlobalAnalytics & { topHooksByTVL?: GlobalAnalytics["topHooks"] };
      setData({ ...raw, topHooks: raw.topHooks ?? raw.topHooksByTVL ?? [] });
      setLastUpd(new Date());
      setPulsing(true);
      setTimeout(() => setPulsing(false), 800);
    } catch { /* non-fatal */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    try {
      es = new EventSource(`${API_URL}/api/analytics/stream`);
      es.addEventListener("analytics", (e) => {
        try {
          const json = JSON.parse(e.data) as GlobalAnalytics;
          setData(json); setLastUpd(new Date());
          setPulsing(true); setTimeout(() => setPulsing(false), 800);
        } catch { /* ignore */ }
      });
      es.onerror = () => { es?.close(); poll = setInterval(fetchData, 30_000); };
    } catch {
      poll = setInterval(fetchData, 30_000);
    }
    return () => { es?.close(); if (poll) clearInterval(poll); };
  }, [fetchData]);

  if (loading) {
    return (
      <div className="w-full py-2.5 px-4"
        style={{ background: "rgba(6,9,16,0.9)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="max-w-7xl mx-auto flex gap-4">
          {[1,2,3].map((i) => <div key={i} className="h-5 w-24 shimmer rounded" />)}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const topHooks = (data.topHooks ?? []).filter((h) => h.tvlUsd > 0).slice(0, 4);

  return (
    <div className="w-full overflow-hidden"
      style={{ background: "rgba(6,9,16,0.95)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 py-2 overflow-x-auto no-scrollbar">

          {/* Live badge */}
          <span className="flex items-center gap-1.5 shrink-0 mr-1">
            <span className={`w-1.5 h-1.5 rounded-full ${pulsing ? "bg-green-300" : "bg-green-500"} transition-colors`}
              style={pulsing ? { boxShadow: "0 0 6px 2px rgba(74,222,128,0.6)" } : {}} />
            <span className="text-[10px] font-bold tracking-widest text-green-500">LIVE</span>
          </span>

          <Divider />

          {/* Metrics */}
          <Metric icon={<Layers size={11} className="text-indigo-400" />}
            label="Hooks" value={data.totalHooks.toLocaleString()} />
          <Divider />
          <Metric icon={<Activity size={11} className="text-blue-400" />}
            label="Pools" value={data.totalPools.toLocaleString()} />
          <Divider />
          <Metric icon={<TrendingUp size={11} className="text-emerald-400" />}
            label="TVL" value={formatTvl(data.totalTVLUsd)} highlight />

          {/* Top hooks ticker */}
          {topHooks.length > 0 && (
            <>
              <Divider />
              <span className="text-[10px] text-gray-600 shrink-0 flex items-center gap-1">
                <Zap size={9} /> Top TVL:
              </span>
              {topHooks.map((hook) => (
                <a key={hook.address} href={`/hooks/${hook.address}`}
                  className="shrink-0 flex items-center gap-1.5 text-[11px] hover:text-white transition-colors group">
                  <span className={
                    hook.riskLevel === "LOW"      ? "text-green-400" :
                    hook.riskLevel === "MEDIUM"   ? "text-yellow-400" :
                    hook.riskLevel === "HIGH"     ? "text-orange-400" : "text-red-400"
                  }>●</span>
                  <span className="text-gray-400 group-hover:text-gray-200 font-mono transition-colors">
                    {hook.name ?? hook.address.slice(0, 6) + "…"}
                  </span>
                  <span className="text-blue-400 font-medium">{formatTvl(hook.tvlUsd)}</span>
                </a>
              ))}
            </>
          )}

          {/* Timestamp */}
          <span className="ml-auto shrink-0 text-[10px] text-gray-700 tabular-nums">
            {lastUpd ? timeAgoShort(lastUpd) : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

function Metric({ icon, label, value, highlight }: {
  icon: React.ReactNode; label: string; value: string; highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 shrink-0 text-[11px]">
      {icon}
      <span className="text-gray-600">{label}</span>
      <span className={highlight ? "text-emerald-400 font-semibold" : "text-gray-300 font-medium"}>{value}</span>
    </div>
  );
}

function Divider() {
  return <span className="shrink-0 text-white/8 select-none mx-0.5">│</span>;
}

function timeAgoShort(d: Date) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 5)  return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}
