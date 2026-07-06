import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Web3Provider } from "@/components/providers/web3-provider";

export const metadata: Metadata = {
  title: { default: "HookScope", template: "%s | HookScope" },
  description: "Uniswap v4 Hook Transparency Platform — explore, analyze, and compare all deployed hooks",
  keywords: ["Uniswap v4", "hooks", "DeFi", "transparency", "smart contracts"],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <Web3Provider>{children}</Web3Provider>
      </body>
    </html>
  );
}
