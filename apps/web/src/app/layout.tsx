import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Navbar } from "@/components/layout/navbar";
import { LiveAnalyticsBar } from "@/components/analytics/live-analytics-bar";

export const metadata: Metadata = {
  title: { default: "HookScope", template: "%s | HookScope" },
  description: "Uniswap v4 Hook Transparency Platform — explore, analyze, and compare all deployed hooks",
  keywords: ["Uniswap v4", "hooks", "DeFi", "transparency", "smart contracts"],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <Navbar />
        <LiveAnalyticsBar />
        <main className="min-h-screen">{children}</main>
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
      </body>
    </html>
  );
}
