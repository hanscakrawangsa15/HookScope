import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import { chainName, chainIcon } from "@/lib/utils";
import { Reveal } from "@/components/landing/reveal";
import { CountUp } from "@/components/landing/count-up";
import { LaunchAppButton } from "@/components/wallet/launch-app-button";
import { ConnectButton } from "@/components/wallet/connect-button";
import { Eye, Shield, TrendingUp, Activity, Search, ScanLine, Database, Lock } from "lucide-react";
import type { ReactNode } from "react";

const LandingScene = dynamic(
  () => import("@/components/three/landing-scene").then((m) => ({ default: m.LandingScene })),
  { ssr: false }
);

const AnvilDemoSection = dynamic(
  () => import("@/components/landing/anvil-demo-section").then((m) => ({ default: m.AnvilDemoSection })),
  { ssr: false }
);

const FEATURES = [
  { icon: Eye,        title: "100% On-Chain Discovery", desc: "Every Uniswap v4 hook is found directly from chain data — no reliance on manual submissions or partner lists." },
  { icon: Shield,     title: "Security Scoring",        desc: "Each hook is scored against known risk patterns: unverified bytecode, dangerous callbacks, owner-mutable state." },
  { icon: ScanLine,   title: "Proxy Detection",         desc: "Upgradeable and proxy-pattern hooks are unmasked, surfacing the real implementation behind the address." },
  { icon: TrendingUp, title: "Live TVL & Volume",       desc: "Pool liquidity, swap volume, and LP activity are tracked in real time across every indexed hook." },
  { icon: Activity,   title: "Threat Intelligence",     desc: "Flagged exploits and audit findings are linked back to the exact hook and function they affect." },
  { icon: Database,   title: "Multi-Chain Coverage",    desc: "Ethereum, Arbitrum, Base, Optimism, and the Solana DEX ecosystem — one transparency layer for all of them." },
];

const STEPS = [
  { n: "01", title: "Index",  desc: "Every pool deployment and hook address is captured directly from chain logs." },
  { n: "02", title: "Decode", desc: "Bytecode is decompiled, ABIs reconstructed, and proxy patterns unwound." },
  { n: "03", title: "Score",  desc: "Callbacks, ownership, and known vulnerability patterns are run through the risk model." },
  { n: "04", title: "Track",  desc: "TVL, volume, and LP activity stay live so risk and liquidity are never stale." },
];

const CHAINS: { id: number; desc: string }[] = [
  { id: 1,          desc: "Mainnet Uniswap v4 — the canonical deployment with the deepest aggregate liquidity." },
  { id: 42161,      desc: "An Arbitrum L2 deployment of Uniswap v4, sharing the same hook architecture as mainnet." },
  { id: 8453,       desc: "Coinbase's Base L2 — a Uniswap v4 deployment indexed with the same hook risk model as every other chain." },
  { id: 10,         desc: "An OP Stack L2 deployment of Uniswap v4 — full hook support at lower gas cost." },
  { id: 1399811149, desc: "A separate, non-Uniswap ecosystem — indexed DEX programs (Orca, Raydium, Meteora, and others) rather than v4 hooks." },
];

export default async function LandingPage() {
  const stats = await api.stats.global().catch(() => null);

  return (
    <div className="relative">
      <LandingScene />

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative z-10 min-h-[88vh] flex flex-col items-center justify-center text-center px-6">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-6"
          style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.3)", color: "#93c5fd" }}>
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          Live on-chain data · 5 chains tracked
        </div>

        <h1 className="text-5xl sm:text-7xl font-black mb-5 tracking-tight">
          <span className="text-white">Hook</span>
          <span className="gradient-text">Scope</span>
        </h1>
        <p className="text-gray-300 text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
          Full transparency for <em className="text-white not-italic font-medium">every</em> Uniswap&nbsp;v4 Hook —
          including unverified, proxy, and hidden contracts not shown anywhere else.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 mb-14">
          <LaunchAppButton />
          <ConnectButton variant="ghost" />
          {/* Scroll-to-demo anchor — no JS needed, works via CSS scroll-behavior */}
          <a
            href="#anvil-demo"
            className="btn-ghost text-sm flex items-center gap-2 cursor-pointer"
            style={{ borderColor: "rgba(16,185,129,0.35)", color: "#6ee7b7" }}
          >
            <Search size={14} />
            Coba Anvil Demo ↓
          </a>
        </div>

        {stats && (
          <div className="flex flex-wrap justify-center gap-px rounded-2xl overflow-hidden mx-auto max-w-3xl"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(12px)" }}>
            <StatCell label="Hooks Indexed"   value={stats.totalHooks}     icon={<Database size={15} className="text-blue-400" />} />
            <StatCell label="Pools Tracked"   value={stats.totalPools}     icon={<Activity size={15} className="text-purple-400" />} />
            <StatCell label="Verified Source" value={stats.verifiedHooks}  icon={<Shield size={15} className="text-green-400" />} />
            <StatCell label="Audited"         value={stats.auditedHooks}   icon={<Lock size={15} className="text-yellow-400" />} />
          </div>
        )}
      </section>

      {/* ── Anvil Demo ────────────────────────────────────────────────────── */}
      <AnvilDemoSection />

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <section id="features" className="relative z-10 max-w-6xl mx-auto px-6 py-28">
        <Reveal>
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">Built for transparency, not trust</h2>
            <p className="text-gray-400 max-w-xl mx-auto">Everything HookScope shows is derived from chain data — nothing here depends on a project self-reporting.</p>
          </div>
        </Reveal>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map(({ icon: Icon, title, desc }, i) => (
            <Reveal key={title} delay={i * 60}>
              <div className="card p-6 h-full">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.25)" }}>
                  <Icon size={18} className="text-blue-400" />
                </div>
                <h3 className="text-white font-semibold mb-2">{title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section id="how-it-works" className="relative z-10 max-w-6xl mx-auto px-6 py-28">
        <Reveal>
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">How it works</h2>
            <p className="text-gray-400 max-w-xl mx-auto">A four-stage pipeline runs continuously against every supported chain.</p>
          </div>
        </Reveal>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {STEPS.map((step, i) => (
            <Reveal key={step.n} delay={i * 80}>
              <div className="card p-6 h-full">
                <span className="text-blue-400/50 font-mono text-sm">{step.n}</span>
                <h3 className="text-white font-semibold mt-2 mb-2">{step.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{step.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Chains ────────────────────────────────────────────────────────── */}
      <section id="chains" className="relative z-10 max-w-6xl mx-auto px-6 py-28">
        <Reveal>
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">Five chains, one view</h2>
            <p className="text-gray-400 max-w-xl mx-auto">Coverage spans every major Uniswap v4 deployment plus the Solana DEX ecosystem.</p>
          </div>
        </Reveal>
        <div className="flex flex-wrap justify-center gap-4">
          {CHAINS.map(({ id, desc }, i) => (
            <Reveal key={id} delay={i * 60}>
              <div className="group relative flex items-center gap-2.5 px-5 py-3 rounded-xl card cursor-default">
                <span className="text-lg">{chainIcon(id)}</span>
                <span className="text-white font-medium text-sm">{chainName(id)}</span>
                <div
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 w-56 px-3 py-2.5 rounded-lg text-xs text-gray-300 leading-relaxed opacity-0 translate-y-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-y-0 z-20"
                  style={{ background: "rgba(10,13,22,0.97)", border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(8px)" }}
                >
                  {desc}
                  <span
                    className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 -mt-1"
                    style={{ background: "rgba(10,13,22,0.97)", borderRight: "1px solid rgba(255,255,255,0.1)", borderBottom: "1px solid rgba(255,255,255,0.1)" }}
                  />
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-3xl mx-auto px-6 py-32 text-center">
        <Reveal>
          <Search size={28} className="text-blue-400 mx-auto mb-6" />
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">See every hook for yourself</h2>
          <p className="text-gray-400 mb-9 max-w-md mx-auto">
            Connect a wallet to enter the dashboard and explore live TVL, risk scores, and source code across every indexed hook.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <LaunchAppButton />
            <ConnectButton variant="ghost" />
          </div>
        </Reveal>
      </section>
    </div>
  );
}

function StatCell({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="flex-1 min-w-[120px] flex flex-col items-center py-5 px-3">
      <div className="flex items-center gap-1.5 mb-1.5">{icon}</div>
      <p className="text-2xl font-bold text-white tabular-nums">
        <CountUp value={value} />
      </p>
      <p className="text-[11px] text-gray-500 mt-0.5 text-center">{label}</p>
    </div>
  );
}
