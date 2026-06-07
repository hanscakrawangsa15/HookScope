/**
 * Threat Intelligence — GoPlus Security API integration.
 *
 * Checks hook addresses for known threats: phishing, address poisoning,
 * sanctions, honeypot schemes, cybercrime, and more.
 *
 * API: https://api.gopluslabs.io (free, no key required for basic use)
 * Run via: pnpm --filter @hookscope/indexer threat-scan
 */

export interface ThreatFlag {
  category: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  description: string;
  source: string;
  dataSources: string[];
}

interface GoPlusAddressResult {
  cybercrime?: string;
  money_laundering?: string;
  number_of_malicious_contracts_created?: string;
  financial_crime?: string;
  darkweb_transactions?: string;
  reinit?: string;
  phishing_activities?: string;
  fake_kyc?: string;
  blackmail_activities?: string;
  sanctioned?: string;
  malicious_mining_activities?: string;
  mixer?: string;
  honeypot_related_address?: string;
  fake_token?: string;
  gas_abuse?: string;
  data_source?: string[];
}

interface GoPlusResponse {
  code: number;
  message: string;
  result?: Record<string, GoPlusAddressResult>;
}

const GOPLUS_BASE = "https://api.gopluslabs.io/api/v1";

// Chain ID mapping: HookScope chainId → GoPlus chain_id
const CHAIN_MAP: Record<number, string> = {
  1: "1",       // Ethereum
  8453: "8453", // Base
  42161: "42161", // Arbitrum
  10: "10",     // Optimism
  137: "137",   // Polygon
  56: "56",     // BSC
};

// Maps GoPlus field names to human-readable threat metadata
const THREAT_MAP: Array<{
  field: keyof Omit<GoPlusAddressResult, "data_source">;
  category: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  description: string;
}> = [
  {
    field: "phishing_activities",
    category: "PHISHING",
    severity: "CRITICAL",
    description:
      "This address has been reported for phishing or address poisoning activity. It may have been used to deceive users into sending funds to a lookalike address. Exercise extreme caution.",
  },
  {
    field: "sanctioned",
    category: "SANCTIONED",
    severity: "CRITICAL",
    description:
      "This address is on a sanctions list (e.g. OFAC). Interacting with this hook may have legal and compliance implications.",
  },
  {
    field: "cybercrime",
    category: "CYBERCRIME",
    severity: "CRITICAL",
    description:
      "This address is associated with cybercrime activity as reported by threat intelligence sources.",
  },
  {
    field: "honeypot_related_address",
    category: "HONEYPOT",
    severity: "CRITICAL",
    description:
      "This address is linked to honeypot schemes designed to trap user funds. Funds sent to pools using this hook may be unrecoverable.",
  },
  {
    field: "financial_crime",
    category: "FINANCIAL_CRIME",
    severity: "HIGH",
    description:
      "This address is associated with financial crime activity.",
  },
  {
    field: "money_laundering",
    category: "MONEY_LAUNDERING",
    severity: "HIGH",
    description:
      "This address has been flagged for money laundering activity by compliance intelligence sources.",
  },
  {
    field: "darkweb_transactions",
    category: "DARKWEB",
    severity: "HIGH",
    description:
      "This address has been linked to dark web marketplace transactions.",
  },
  {
    field: "blackmail_activities",
    category: "BLACKMAIL",
    severity: "HIGH",
    description:
      "This address is associated with blackmail or extortion activities.",
  },
  {
    field: "fake_kyc",
    category: "FAKE_KYC",
    severity: "HIGH",
    description:
      "This address is involved in fake KYC (Know Your Customer) verification schemes.",
  },
  {
    field: "fake_token",
    category: "FAKE_TOKEN",
    severity: "HIGH",
    description:
      "This address is associated with fake or fraudulent token activity.",
  },
  {
    field: "reinit",
    category: "REINIT_ATTACK",
    severity: "HIGH",
    description:
      "This address is associated with reinitialization attack patterns — potentially exploiting proxy upgrade mechanisms.",
  },
  {
    field: "number_of_malicious_contracts_created",
    category: "MALICIOUS_DEPLOYER",
    severity: "HIGH",
    description:
      "The deployer of this contract has previously deployed malicious contracts.",
  },
  {
    field: "mixer",
    category: "MIXER",
    severity: "MEDIUM",
    description:
      "This address is linked to cryptocurrency mixing/tumbling services used to obscure transaction trails.",
  },
  {
    field: "malicious_mining_activities",
    category: "MALICIOUS_MINING",
    severity: "MEDIUM",
    description:
      "This address is associated with malicious mining or MEV extraction activities.",
  },
  {
    field: "gas_abuse",
    category: "GAS_ABUSE",
    severity: "MEDIUM",
    description:
      "This address has been flagged for gas abuse patterns that could affect transaction costs.",
  },
];

export async function checkAddressThreats(
  address: string,
  chainId: number,
): Promise<ThreatFlag[]> {
  const goPlusChain = CHAIN_MAP[chainId];
  if (!goPlusChain) return [];

  const url = `${GOPLUS_BASE}/address_security/${address.toLowerCase()}?chain_id=${goPlusChain}`;

  let data: GoPlusResponse;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    data = (await res.json()) as GoPlusResponse;
  } catch {
    return [];
  }

  if (data.code !== 1 || !data.result) return [];

  // GoPlus returns the result keyed by lowercase address
  const key = Object.keys(data.result)[0];
  if (!key) return [];
  const result = data.result[key];

  const dataSources = result.data_source ?? ["GoPlus"];
  const flags: ThreatFlag[] = [];

  for (const { field, category, severity, description } of THREAT_MAP) {
    const val = result[field];
    // "1" = true, "0" or undefined = false
    // For number_of_malicious_contracts_created, any non-zero value is a flag
    const isActive = field === "number_of_malicious_contracts_created"
      ? typeof val === "string" && parseInt(val, 10) > 0
      : val === "1";

    if (isActive) {
      flags.push({ category, severity, description, source: "goplus", dataSources });
    }
  }

  return flags;
}
