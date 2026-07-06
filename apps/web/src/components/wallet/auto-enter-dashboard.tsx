"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAppKitAccount } from "@reown/appkit/react";

export function AutoEnterDashboard() {
  const router = useRouter();
  const { isConnected } = useAppKitAccount();
  const wasConnected = useRef(isConnected);

  useEffect(() => {
    if (isConnected && !wasConnected.current) {
      router.push("/dashboard");
    }
    wasConnected.current = isConnected;
  }, [isConnected, router]);

  return null;
}
