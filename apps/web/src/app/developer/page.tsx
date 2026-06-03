"use client";

import { useState } from "react";
import { Code2, Download, Copy, Check } from "lucide-react";
import { CALLBACK_LABELS } from "@/lib/utils";
import { cn } from "@/lib/utils";

export default function DeveloperToolsPage() {
  const [selectedCallbacks, setSelectedCallbacks] = useState<Set<string>>(
    new Set(["beforeSwap", "afterSwap"])
  );
  const [copied, setCopied] = useState(false);

  const toggleCallback = (key: string) => {
    setSelectedCallbacks((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const generateTemplate = () => {
    const callbacks = [...selectedCallbacks];
    const hasBeforeSwap = callbacks.includes("beforeSwap");
    const hasAfterSwap = callbacks.includes("afterSwap");
    const hasBeforeAdd = callbacks.includes("beforeAddLiquidity");
    const hasAfterAdd = callbacks.includes("afterAddLiquidity");
    const hasBeforeRemove = callbacks.includes("beforeRemoveLiquidity");
    const hasAfterRemove = callbacks.includes("afterRemoveLiquidity");
    const hasBeforeInit = callbacks.includes("beforeInitialize");
    const hasAfterInit = callbacks.includes("afterInitialize");

    const addressComment = callbacks.length > 0
      ? `// Hook address last 14 bits must be: ${buildBitmaskComment(callbacks)}`
      : "";

    return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "@uniswap/v4-periphery/src/base/hooks/BaseHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

${addressComment}

contract MyHook is BaseHook {
    constructor(IPoolManager _manager) BaseHook(_manager) {}

    function getHookPermissions()
        public
        pure
        override
        returns (Hooks.Permissions memory)
    {
        return Hooks.Permissions({
            beforeInitialize:                 ${hasBeforeInit},
            afterInitialize:                  ${hasAfterInit},
            beforeAddLiquidity:               ${hasBeforeAdd},
            afterAddLiquidity:                ${hasAfterAdd},
            beforeRemoveLiquidity:            ${hasBeforeRemove},
            afterRemoveLiquidity:             ${hasAfterRemove},
            beforeSwap:                       ${hasBeforeSwap},
            afterSwap:                        ${hasAfterSwap},
            beforeDonate:                     ${callbacks.includes("beforeDonate")},
            afterDonate:                      ${callbacks.includes("afterDonate")},
            beforeSwapReturnsDelta:           ${callbacks.includes("beforeSwapReturnsDelta")},
            afterSwapReturnsDelta:            ${callbacks.includes("afterSwapReturnsDelta")},
            afterAddLiquidityReturnsDelta:    ${callbacks.includes("afterAddLiquidityReturnsDelta")},
            afterRemoveLiquidityReturnsDelta: ${callbacks.includes("afterRemoveLiquidityReturnsDelta")}
        });
    }
${callbacks.includes("beforeInitialize") ? `
    function _beforeInitialize(
        address sender,
        PoolKey calldata key,
        uint160 sqrtPriceX96
    ) internal override returns (bytes4) {
        // TODO: implement beforeInitialize logic
        return BaseHook.beforeInitialize.selector;
    }
` : ""}${callbacks.includes("afterInitialize") ? `
    function _afterInitialize(
        address sender,
        PoolKey calldata key,
        uint160 sqrtPriceX96,
        int24 tick
    ) internal override returns (bytes4) {
        // TODO: implement afterInitialize logic
        return BaseHook.afterInitialize.selector;
    }
` : ""}${callbacks.includes("beforeSwap") ? `
    function _beforeSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata hookData
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        // TODO: implement beforeSwap logic
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
` : ""}${callbacks.includes("afterSwap") ? `
    function _afterSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal override returns (bytes4, int128) {
        // TODO: implement afterSwap logic
        return (BaseHook.afterSwap.selector, 0);
    }
` : ""}${callbacks.includes("beforeAddLiquidity") ? `
    function _beforeAddLiquidity(
        address sender,
        PoolKey calldata key,
        IPoolManager.ModifyLiquidityParams calldata params,
        bytes calldata hookData
    ) internal override returns (bytes4) {
        // TODO: implement beforeAddLiquidity logic
        return BaseHook.beforeAddLiquidity.selector;
    }
` : ""}${callbacks.includes("afterAddLiquidity") ? `
    function _afterAddLiquidity(
        address sender,
        PoolKey calldata key,
        IPoolManager.ModifyLiquidityParams calldata params,
        BalanceDelta delta,
        BalanceDelta feesAccrued,
        bytes calldata hookData
    ) internal override returns (bytes4, BalanceDelta) {
        // TODO: implement afterAddLiquidity logic
        return (BaseHook.afterAddLiquidity.selector, delta);
    }
` : ""}
}`;
  };

  const copyCode = async () => {
    await navigator.clipboard.writeText(generateTemplate());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <Code2 size={28} className="text-blue-400" />
          Developer Tools
        </h1>
        <p className="text-gray-400 mt-2">
          Generate Hook templates, explore ABIs, and integrate with your project
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Callback selector */}
        <div className="card p-6">
          <h2 className="font-semibold text-gray-300 mb-4">Hook Interface Generator</h2>
          <p className="text-sm text-gray-500 mb-4">
            Select the callbacks you need — the template is generated automatically.
          </p>

          <div className="grid grid-cols-2 gap-2 mb-6">
            {Object.entries(CALLBACK_LABELS).map(([key, label]) => (
              <button
                key={key}
                onClick={() => toggleCallback(key)}
                className={cn(
                  "text-left px-3 py-2 rounded-lg text-xs border transition-all",
                  selectedCallbacks.has(key)
                    ? "bg-blue-500/20 border-blue-500/40 text-blue-300"
                    : "bg-white/3 border-white/10 text-gray-500 hover:border-white/20"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="text-xs text-gray-500">
            Selected: {selectedCallbacks.size} callback{selectedCallbacks.size !== 1 ? "s" : ""}
          </div>
        </div>

        {/* Generated code */}
        <div className="card p-6 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-300">Generated Template</h2>
            <div className="flex gap-2">
              <button onClick={copyCode} className="btn-ghost text-xs px-3 py-1.5">
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? "Copied!" : "Copy"}
              </button>
              <button
                onClick={() => {
                  const blob = new Blob([generateTemplate()], { type: "text/plain" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "MyHook.sol";
                  a.click();
                }}
                className="btn-ghost text-xs px-3 py-1.5"
              >
                <Download size={13} />
                .sol
              </button>
            </div>
          </div>

          <pre className="flex-1 overflow-auto text-xs font-mono text-gray-300 bg-black/30 rounded-lg p-4 max-h-[500px]">
            {generateTemplate()}
          </pre>
        </div>
      </div>

      {/* Integration snippets */}
      <div className="card p-6 mt-6">
        <h2 className="font-semibold text-gray-300 mb-4">Integration Snippets</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <CodeSnippet
            title="Fetch hook info (TypeScript)"
            code={`import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({
  chain: mainnet,
  transport: http()
});

// Decode callbacks from address (no RPC needed)
const HOOK_FLAGS_MASK = BigInt(0x3FFF);
const addr = BigInt("0x<hook-address>");
const flags = addr & HOOK_FLAGS_MASK;

const beforeSwap = (flags >> 7n) & 1n === 1n;
const afterSwap  = (flags >> 6n) & 1n === 1n;`}
          />
          <CodeSnippet
            title="HookScope API (REST)"
            code={`// List hooks with filters
const res = await fetch(
  "https://api.hookscope.xyz/api/hooks" +
  "?auditStatus=AUDITED&sortBy=tvl&limit=10"
);
const { data } = await res.json();

// Get hook detail
const hook = await fetch(
  \`https://api.hookscope.xyz/api/hooks/\${address}\`
).then(r => r.json());

console.log(hook.hookScore, hook.callbacks);`}
          />
        </div>
      </div>
    </div>
  );
}

function CodeSnippet({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-black/30 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-400 font-medium">{title}</span>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="text-gray-600 hover:text-gray-300 transition-colors"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre className="text-xs font-mono text-gray-300 overflow-x-auto">{code}</pre>
    </div>
  );
}

function buildBitmaskComment(callbacks: string[]): string {
  const FLAGS: Record<string, number> = {
    beforeInitialize: 13, afterInitialize: 12,
    beforeAddLiquidity: 11, afterAddLiquidity: 10,
    beforeRemoveLiquidity: 9, afterRemoveLiquidity: 8,
    beforeSwap: 7, afterSwap: 6,
    beforeDonate: 5, afterDonate: 4,
    beforeSwapReturnsDelta: 3, afterSwapReturnsDelta: 2,
    afterAddLiquidityReturnsDelta: 1, afterRemoveLiquidityReturnsDelta: 0,
  };
  let mask = 0;
  for (const cb of callbacks) {
    if (FLAGS[cb] !== undefined) mask |= 1 << FLAGS[cb];
  }
  return `0x${mask.toString(16).toUpperCase()} (addr must end in ${mask.toString(2).padStart(14, "0")})`;
}
