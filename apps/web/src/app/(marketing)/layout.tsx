import type { ReactNode } from "react";
import Link from "next/link";
import { Hexagon } from "lucide-react";
import { ConnectButton } from "@/components/wallet/connect-button";
import { AutoEnterDashboard } from "@/components/wallet/auto-enter-dashboard";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AutoEnterDashboard />
      <header className="sticky top-0 z-50"
        style={{
          background: "rgba(8,11,18,0.65)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2 font-black text-lg shrink-0 group">
              <div className="relative">
                <Hexagon size={24} className="text-blue-500 group-hover:text-blue-400 transition-colors" fill="rgba(59,130,246,0.15)" />
                <span className="absolute inset-0 flex items-center justify-center text-[9px] font-black text-blue-300">HS</span>
              </div>
              <span className="gradient-text text-xl">HookScope</span>
            </Link>

            <nav className="hidden md:flex items-center gap-6 text-sm text-gray-400">
              <a href="#features" className="hover:text-white transition-colors">Features</a>
              <a href="#how-it-works" className="hover:text-white transition-colors">How it works</a>
              <a href="#chains" className="hover:text-white transition-colors">Chains</a>
            </nav>

            <ConnectButton />
          </div>
        </div>
      </header>

      <main className="relative">{children}</main>

      <footer className="relative py-8" style={{ borderTop: "1px solid rgba(255,255,255,0.05)", background: "rgba(6,9,16,0.7)" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="gradient-text font-bold text-sm">HookScope</span>
            <span className="text-gray-700 text-xs">Uniswap v4 Hook Transparency Platform</span>
          </div>
          <p className="text-gray-700 text-xs">Data sourced on-chain · Not financial advice · Open source</p>
        </div>
      </footer>
    </>
  );
}
