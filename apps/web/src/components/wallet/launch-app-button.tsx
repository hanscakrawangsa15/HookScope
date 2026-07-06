"use client";

import { useRouter } from "next/navigation";
import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { Rocket } from "lucide-react";

export function LaunchAppButton({ className }: { className?: string }) {
  const router = useRouter();
  const { open } = useAppKit();
  const { isConnected } = useAppKitAccount();

  const handleClick = () => {
    if (isConnected) router.push("/dashboard");
    else open({ view: "Connect" });
  };

  return (
    <button onClick={handleClick} className={className ?? "btn-primary cursor-pointer"}>
      <Rocket size={15} />
      Launch App
    </button>
  );
}
