import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/layout/navbar";

export const metadata: Metadata = {
  title: { default: "HookScope", template: "%s | HookScope" },
  description: "Uniswap v4 Hook Transparency Platform — explore, analyze, and compare all deployed hooks",
  keywords: ["Uniswap v4", "hooks", "DeFi", "transparency", "smart contracts"],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>
        <Navbar />
        <main className="min-h-screen">{children}</main>
        <footer className="border-t border-white/10 py-8 mt-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-gray-500 text-sm">
            <p>HookScope — Uniswap v4 Hook Transparency Platform</p>
            <p className="mt-1">Data sourced from on-chain events. Not financial advice.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
