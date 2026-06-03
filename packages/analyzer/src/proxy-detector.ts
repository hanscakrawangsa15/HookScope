import { type PublicClient, type Address, keccak256, toHex } from "viem";
import {
  EIP1967_IMPLEMENTATION_SLOT,
  EIP1967_BEACON_SLOT,
  EIP1822_PROXIABLE_SLOT,
  MINIMAL_PROXY_PREFIX,
} from "@hookscope/shared";
import type { ProxyType } from "@hookscope/shared";

export interface ProxyInfo {
  proxyType: ProxyType;
  implementationAddress: Address | null;
}

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

/**
 * Detects if a contract is a proxy and resolves its implementation.
 *
 * Supports:
 * - EIP-1967 (transparent / UUPS proxies — most common in DeFi)
 * - EIP-1822 (original UUPS)
 * - EIP-1167 minimal proxy (clones)
 * - Custom proxy heuristics (checks common storage slots)
 */
export async function detectProxy(
  client: PublicClient,
  address: Address
): Promise<ProxyInfo> {
  const bytecode = await client.getBytecode({ address });

  if (!bytecode || bytecode === "0x") {
    return { proxyType: "NONE", implementationAddress: null };
  }

  // ── EIP-1167 Minimal Proxy ────────────────────────────────────────────────
  // Format: 0x363d3d373d3d3d363d73<20-byte-address>5af43d82803e903d91602b57fd5bf3
  if (bytecode.toLowerCase().startsWith(MINIMAL_PROXY_PREFIX.toLowerCase())) {
    const implHex = bytecode.slice(MINIMAL_PROXY_PREFIX.length, MINIMAL_PROXY_PREFIX.length + 40);
    const impl = `0x${implHex}` as Address;
    return {
      proxyType: "MINIMAL_PROXY",
      implementationAddress: impl === ZERO_ADDR ? null : impl,
    };
  }

  // ── EIP-1967 Implementation Slot ─────────────────────────────────────────
  const eip1967Impl = await readAddressSlot(client, address, EIP1967_IMPLEMENTATION_SLOT);
  if (eip1967Impl && eip1967Impl !== ZERO_ADDR) {
    return { proxyType: "EIP1967", implementationAddress: eip1967Impl };
  }

  // ── EIP-1967 Beacon Slot ─────────────────────────────────────────────────
  const beaconAddr = await readAddressSlot(client, address, EIP1967_BEACON_SLOT);
  if (beaconAddr && beaconAddr !== ZERO_ADDR) {
    // Resolve beacon → implementation via implementation() call
    const beaconImpl = await callImplementation(client, beaconAddr as Address);
    return {
      proxyType: "EIP1967",
      implementationAddress: beaconImpl ?? (beaconAddr as Address),
    };
  }

  // ── EIP-1822 UUPS ────────────────────────────────────────────────────────
  const eip1822Impl = await readAddressSlot(client, address, EIP1822_PROXIABLE_SLOT);
  if (eip1822Impl && eip1822Impl !== ZERO_ADDR) {
    return { proxyType: "EIP1822", implementationAddress: eip1822Impl as Address };
  }

  // ── Custom Proxy Heuristic ────────────────────────────────────────────────
  // Many older proxies store impl at slot keccak256("PROXY_IMPLEMENTATION") etc.
  const customSlots = [
    keccak256(toHex("PROXY_IMPLEMENTATION")),
    keccak256(toHex("implementation")),
    // OpenZeppelin AdminUpgradeabilityProxy
    "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3",
  ] as `0x${string}`[];

  for (const slot of customSlots) {
    const impl = await readAddressSlot(client, address, slot);
    if (impl && impl !== ZERO_ADDR) {
      return { proxyType: "CUSTOM", implementationAddress: impl as Address };
    }
  }

  return { proxyType: "NONE", implementationAddress: null };
}

async function readAddressSlot(
  client: PublicClient,
  address: Address,
  slot: `0x${string}`
): Promise<Address | null> {
  try {
    const raw = await client.getStorageAt({ address, slot });
    if (!raw || raw === "0x" + "0".repeat(64)) return null;
    // Last 20 bytes of the 32-byte slot = address
    const addr = ("0x" + raw.slice(-40)) as Address;
    return addr;
  } catch {
    return null;
  }
}

async function callImplementation(
  client: PublicClient,
  address: Address
): Promise<Address | null> {
  try {
    const result = await client.readContract({
      address,
      abi: [
        {
          name: "implementation",
          type: "function",
          inputs: [],
          outputs: [{ type: "address" }],
          stateMutability: "view",
        },
      ],
      functionName: "implementation",
    });
    return result as Address;
  } catch {
    return null;
  }
}
