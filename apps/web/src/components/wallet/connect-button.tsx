"use client";

import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { Wallet, LogOut } from "lucide-react";
import { appKit } from "@/lib/web3-config";

function truncate(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

interface ConnectButtonProps {
  variant?: "primary" | "ghost";
  // Scopes the connection check to one chain type — without this, the button
  // reflects whichever wallet namespace is globally "active", which is wrong
  // inside a chain-specific panel (e.g. an EVM Swap panel showing a connected
  // Solana wallet's address as if it were ready to use for an EVM tx).
  namespace?: "eip155" | "solana";
}

export function ConnectButton({ variant = "primary", namespace }: ConnectButtonProps) {
  const { open } = useAppKit();
  const { isConnected, address } = useAppKitAccount(namespace ? { namespace } : undefined);

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => open({ view: "Account" })}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-colors"
          style={{
            background: "rgba(34,197,94,0.1)",
            border: "1px solid rgba(34,197,94,0.3)",
            color: "#4ade80",
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          {truncate(address)}
        </button>
        <button
          onClick={() => appKit.disconnect(namespace)}
          aria-label="Disconnect wallet"
          title="Disconnect wallet"
          className="inline-flex items-center justify-center w-9 h-9 rounded-xl cursor-pointer transition-colors"
          style={{
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.25)",
            color: "#f87171",
          }}
        >
          <LogOut size={14} />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => open({ view: "Connect" })}
      className={variant === "primary" ? "btn-primary cursor-pointer" : "btn-ghost cursor-pointer"}
    >
      <Wallet size={15} />
      Connect Wallet
    </button>
  );
}
