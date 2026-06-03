import { EXPLORER_API_URLS } from "@hookscope/shared";
import type { SourceFile } from "@hookscope/shared";

interface EtherscanSourceResult {
  SourceCode: string;
  ABI: string;
  ContractName: string;
  CompilerVersion: string;
  LicenseType: string;
}

interface EtherscanResponse<T> {
  status: string;
  message: string;
  result: T;
}

export interface SourceCodeResult {
  contractName: string;
  sourceFiles: SourceFile[];
  abi: unknown[];
  compilerVersion: string;
}

/** Fetches verified source code and ABI from Etherscan-compatible APIs. */
export async function fetchVerifiedSource(
  address: string,
  chainId: number,
  apiKey?: string
): Promise<SourceCodeResult | null> {
  const baseUrl = EXPLORER_API_URLS[chainId];
  if (!baseUrl) return null;

  const params = new URLSearchParams({
    module: "contract",
    action: "getsourcecode",
    address,
    ...(apiKey ? { apikey: apiKey } : {}),
  });

  let data: EtherscanResponse<EtherscanSourceResult[]>;
  try {
    const res = await fetch(`${baseUrl}?${params}`);
    data = await res.json() as EtherscanResponse<EtherscanSourceResult[]>;
  } catch (err) {
    console.warn(`Etherscan fetch failed for ${address}:`, err);
    return null;
  }

  if (data.status !== "1" || !data.result?.[0]) return null;

  const result = data.result[0];
  if (!result.SourceCode || result.SourceCode === "") return null;

  const sourceFiles = parseSourceCode(result.SourceCode);
  let abi: unknown[] = [];
  try {
    abi = JSON.parse(result.ABI);
  } catch {
    // ABI might be "Contract source code not verified"
  }

  return {
    contractName: result.ContractName,
    sourceFiles,
    abi,
    compilerVersion: result.CompilerVersion,
  };
}

/**
 * Parses Etherscan source code response, which can be:
 * 1. A single Solidity file (plain string)
 * 2. JSON with multiple files: {"sources": {"File.sol": {"content": "..."}}}
 * 3. Standard JSON input (double-JSON-encoded, starts with "{{")
 */
function parseSourceCode(raw: string): SourceFile[] {
  // Standard JSON input format (starts/ends with extra braces)
  const trimmed = raw.trim();
  if (trimmed.startsWith("{{") && trimmed.endsWith("}}")) {
    try {
      const inner = trimmed.slice(1, -1);
      const parsed = JSON.parse(inner) as {
        sources: Record<string, { content: string }>;
        language?: string;
      };
      return Object.entries(parsed.sources).map(([name, { content }]) => ({
        name,
        content,
        language: "solidity" as const,
      }));
    } catch {
      // fall through
    }
  }

  // Multi-file JSON format
  if (trimmed.startsWith("{") && trimmed.includes('"sources"')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        sources: Record<string, { content: string }>;
        language?: string;
      };
      if (parsed.sources) {
        return Object.entries(parsed.sources).map(([name, { content }]) => ({
          name,
          content,
          language: "solidity" as const,
        }));
      }
    } catch {
      // fall through
    }
  }

  // Single file
  return [{ name: "Contract.sol", content: raw, language: "solidity" }];
}

/** Fetches creation tx info to get deployer address. */
export async function fetchDeployerInfo(
  address: string,
  chainId: number,
  apiKey?: string
): Promise<{ deployer: string; txHash: string } | null> {
  const baseUrl = EXPLORER_API_URLS[chainId];
  if (!baseUrl) return null;

  const params = new URLSearchParams({
    module: "contract",
    action: "getcontractcreation",
    contractaddresses: address,
    ...(apiKey ? { apikey: apiKey } : {}),
  });

  try {
    const res = await fetch(`${baseUrl}?${params}`);
    const data = await res.json() as EtherscanResponse<
      Array<{ contractCreator: string; txHash: string }>
    >;
    if (data.status !== "1" || !data.result?.[0]) return null;
    return {
      deployer: data.result[0].contractCreator,
      txHash: data.result[0].txHash,
    };
  } catch {
    return null;
  }
}
