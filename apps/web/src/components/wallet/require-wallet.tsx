"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAppKitAccount } from "@reown/appkit/react";

// Every route under (app) requires a connected wallet. If it's ever missing —
// never connected, manually disconnected, or kicked out by SessionTimeout —
// bounce straight back to the landing page instead of rendering a gated
// placeholder in place. Applies uniformly at the layout level so no app route
// can be reached without a wallet.
export function RequireWallet({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { isConnected } = useAppKitAccount();

  useEffect(() => {
    if (!isConnected) router.replace("/");
  }, [isConnected, router]);

  if (!isConnected) return null;
  return <>{children}</>;
}
