"use client";

import { useEffect, useRef } from "react";
import { useAppKitAccount } from "@reown/appkit/react";
import { appKit } from "@/lib/web3-config";

const SESSION_MS = 30 * 60 * 1000;
const STORAGE_KEY = "hookscope_wallet_connected_at";

export function SessionTimeout() {
  const { isConnected } = useAppKitAccount();
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!isConnected) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    let connectedAt = Number(localStorage.getItem(STORAGE_KEY));
    if (!connectedAt) {
      connectedAt = Date.now();
      localStorage.setItem(STORAGE_KEY, String(connectedAt));
    }

    const remaining = SESSION_MS - (Date.now() - connectedAt);
    if (remaining <= 0) {
      localStorage.removeItem(STORAGE_KEY);
      appKit.disconnect();
      return;
    }

    timerRef.current = setTimeout(() => {
      localStorage.removeItem(STORAGE_KEY);
      appKit.disconnect();
    }, remaining);

    return () => clearTimeout(timerRef.current);
  }, [isConnected]);

  return null;
}
