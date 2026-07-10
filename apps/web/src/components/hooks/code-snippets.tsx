"use client";

import { useState, useCallback } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check, Code2, Terminal } from "lucide-react";
import { chainName } from "@/lib/utils";

interface Props {
  address: string;
  name: string | null;
  chainId: number;
  callbacks: Record<string, boolean>;
  poolCount: number;
  functions: Array<{
    name: string;
    signature: string;
    params: Array<{ name: string; type: string }>;
    stateMutability: string;
    isCallback: boolean;
  }>;
}

const CHAIN_VIEM: Record<number, string> = {
  1: "mainnet",
  8453: "base",
  42161: "arbitrum",
  10: "optimism",
  84532: "baseSepolia",
};

const POOL_MANAGER_ADDR: Record<number, string> = {
  1: "0x000000000004444c5dc75cB358380D2e3dE08A90",
  8453: "0x498581ff718922c3f8e6a244956af099b2652b2b",
  42161: "0x360E68faCcca8cA495c1B759Fd9EEe466db9FB72",
  10: "0x9a13F98Cb987694C9F086b1F5eB990EeA8264Ec3",
};

type Tab = "viem" | "ethers" | "solidity" | "curl";

function buildViemSnippet(p: Props): string {
  const chain = CHAIN_VIEM[p.chainId] ?? "mainnet";
  const poolMgr = POOL_MANAGER_ADDR[p.chainId] ?? "0x000000000004444c5dc75cB358380D2e3dE08A90";
  const hasBeforeSwap = p.callbacks.beforeSwap;
  const hasDynFee = p.callbacks.beforeSwap; // dynamic fee often via beforeSwap
  const hookName = p.name ?? "MyHook";
  const shortName = hookName.replace(/[^a-zA-Z0-9]/g, "");

  return `import { createPublicClient, http, parseEther } from "viem";
import { ${chain} } from "viem/chains";

// ${hookName} — ${chainName(p.chainId)}
// Hook Address: ${p.address}
// Active callbacks: ${Object.entries(p.callbacks).filter(([,v])=>v).map(([k])=>k).join(", ") || "none"}

const client = createPublicClient({
  chain: ${chain},
  transport: http(),
});

// PoolManager on ${chainName(p.chainId)}
const POOL_MANAGER = "${poolMgr}" as const;
const HOOK_ADDRESS = "${p.address}" as const;

// Define Pool Key with this hook
const poolKey = {
  currency0: "0x0000000000000000000000000000000000000000", // token0
  currency1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // token1 (USDC example)
  fee: ${hasDynFee ? "0x800000, // dynamic fee (bit 23 = 1)" : "3000,    // 0.30% static fee"}
  tickSpacing: 60,
  hooks: HOOK_ADDRESS,
} as const;

${hasBeforeSwap ? `// Read hook state (example — replace with actual view functions)
const hookFlags = await client.readContract({
  address: HOOK_ADDRESS,
  abi: [{
    name: "getHookPermissions",
    type: "function",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ name: "permissions", type: "uint256" }],
  }],
  functionName: "getHookPermissions",
});

console.log("Hook flags:", hookFlags.toString(16));` : `// Verify hook is registered for this pool
// (check PoolManager for pools using this hook)
console.log("Hook address:", HOOK_ADDRESS);`}`;
}

function buildEthersSnippet(p: Props): string {
  const hookName = p.name ?? "MyHook";
  return `import { ethers } from "ethers";

// ${hookName} — ${chainName(p.chainId)}
// Hook Address: ${p.address}

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

const HOOK_ADDRESS = "${p.address}";

// Minimal hook ABI (add functions as needed)
const HOOK_ABI = [
  "function getHookPermissions() pure returns (uint256)",
${p.functions
    .filter((f) => !f.isCallback && (f.stateMutability === "view" || f.stateMutability === "pure"))
    .slice(0, 3)
    .map((f) => `  "function ${f.name}(${f.params.map((p) => p.type).join(", ")}) ${f.stateMutability} returns (${f.params.map(()=>"uint256").join(", ") || "uint256"})",`)
    .join("\n")}
];

const hook = new ethers.Contract(HOOK_ADDRESS, HOOK_ABI, provider);

// Example: read hook permissions
const permissions = await hook.getHookPermissions();
console.log("Hook permissions bitmask:", permissions.toString(16));`;
}

function buildSoliditySnippet(p: Props): string {
  const hookName = p.name?.replace(/[^a-zA-Z0-9]/g, "") ?? "HookInterface";
  const activeCallbacks = Object.entries(p.callbacks)
    .filter(([, v]) => v)
    .map(([k]) => k);

  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";

// Interface for ${p.name ?? "hook"} (${p.address})
interface I${hookName} {
${p.functions
    .filter((f) => !f.isCallback)
    .slice(0, 5)
    .map((f) => {
      const params = f.params.map((pp) => `${pp.type} ${pp.name || "param"}`).join(", ");
      return `    function ${f.name}(${params}) external${f.stateMutability === "view" ? " view" : ""};`;
    })
    .join("\n") || "    // No public non-callback functions found"}
}

// Example integration in your contract
contract MyProtocol {
    IPoolManager public immutable poolManager;
    I${hookName} public immutable hook;

    PoolKey private _poolKey;

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
        hook = I${hookName}(${p.address});

        // Setup pool key with this hook
        _poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48),
            fee: ${p.callbacks.beforeSwap ? "0x800000" : "3000"}, // ${p.callbacks.beforeSwap ? "dynamic fee" : "0.30%"}
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
    }

    // Active callbacks: ${activeCallbacks.length > 0 ? activeCallbacks.join(", ") : "none"}
}`;
}

function buildCurlSnippet(p: Props): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
  return `# HookScope API — ${p.name ?? p.address}
# Base URL: ${baseUrl}

# 1. Get hook metadata
curl "${baseUrl}/api/hooks/${p.address}" | jq .

# 2. Get source code (if verified)
curl "${baseUrl}/api/hooks/${p.address}/source" | jq '.sourceFiles[].name'

# 3. Get security report
curl "${baseUrl}/api/hooks/${p.address}/security" | jq '{score:.hookScore, risk:.riskLevel}'

# 4. Get analytics & pool data
curl "${baseUrl}/api/analytics/hook/${p.address}" | jq '{tvl:.analytics.tvlUsd, pools:.analytics.poolCount}'

# 5. Get similar hooks
curl "${baseUrl}/api/hooks/${p.address}/similar" | jq '.[] | {address:.address, name:.name}'`;
}

export function CodeSnippets(props: Props) {
  const [tab, setTab] = useState<Tab>("viem");
  const [copied, setCopied] = useState(false);

  const snippets: Record<Tab, { code: string; lang: string; label: string }> = {
    viem:     { code: buildViemSnippet(props),     lang: "typescript", label: "viem (TypeScript)" },
    ethers:   { code: buildEthersSnippet(props),   lang: "typescript", label: "ethers.js" },
    solidity: { code: buildSoliditySnippet(props), lang: "solidity",   label: "Solidity" },
    curl:     { code: buildCurlSnippet(props),     lang: "bash",       label: "cURL API" },
  };

  const current = snippets[tab];

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(current.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [current.code]);

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/8"
        style={{ background: "rgba(0,0,0,0.2)" }}>
        <div className="flex items-center gap-2">
          <Code2 size={14} className="text-purple-400" />
          <span className="text-xs font-bold text-gray-300">Integration Snippets</span>
        </div>
        <button onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] hover:bg-white/8 text-gray-500 hover:text-gray-300 transition-colors">
          {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/6" style={{ background: "rgba(0,0,0,0.1)" }}>
        {(Object.keys(snippets) as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="flex items-center gap-1.5 px-4 py-2 text-[11px] font-medium transition-colors"
            style={{
              color: tab === t ? "#c084fc" : "#6b7280",
              borderBottom: tab === t ? "2px solid #c084fc" : "2px solid transparent",
            }}>
            <Terminal size={10} />
            {snippets[t].label}
          </button>
        ))}
      </div>

      {/* Code */}
      <div style={{ maxHeight: 400, overflow: "auto" }}>
        <SyntaxHighlighter
          language={current.lang}
          style={vscDarkPlus}
          showLineNumbers
          customStyle={{
            margin: 0,
            borderRadius: 0,
            background: "transparent",
            fontSize: "11.5px",
            lineHeight: "1.6",
          }}
          lineNumberStyle={{ color: "#374151", fontSize: "10px", paddingRight: "16px" }}
          codeTagProps={{ style: { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" } }}
        >
          {current.code}
        </SyntaxHighlighter>
      </div>

      <div className="px-4 py-2 border-t border-white/6 text-[10px] text-gray-700"
        style={{ background: "rgba(0,0,0,0.1)" }}>
        Snippets are auto-generated from hook metadata. Adjust token addresses, fee tiers, and ABI before using in production.
      </div>
    </div>
  );
}
