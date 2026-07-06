import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { Navbar } from "@/components/layout/navbar";
import { LiveAnalyticsBar } from "@/components/analytics/live-analytics-bar";
import { RequireWallet } from "@/components/wallet/require-wallet";

// Dev-only floating panel — zero bundle impact in production (dead-code
// eliminated by Next.js since the condition is evaluated at build time).
const AnvilDevPanel = process.env.NODE_ENV === "development"
  ? dynamic(() => import("@/components/dev/anvil-dev-panel").then((m) => ({ default: m.AnvilDevPanel })), { ssr: false })
  : null;

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireWallet>
      <Navbar />
      <LiveAnalyticsBar />
      <main className="min-h-screen">{children}</main>
      {AnvilDevPanel && <AnvilDevPanel />}
      <footer className="mt-20 py-10"
        style={{ borderTop: "1px solid rgba(255,255,255,0.05)", background: "rgba(6,9,16,0.6)" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="gradient-text font-bold text-sm">HookScope</span>
              <span className="text-gray-700 text-xs">Uniswap v4 Hook Transparency Platform</span>
            </div>
            <p className="text-gray-700 text-xs">
              Data sourced on-chain · Not financial advice · Open source
            </p>
          </div>
        </div>
      </footer>
    </RequireWallet>
  );
}
