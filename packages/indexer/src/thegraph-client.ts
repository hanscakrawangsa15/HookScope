/**
 * TheGraph client untuk Uniswap v4 subgraph.
 * Memberikan data TVL, volume, dan pool historis yang tidak bisa
 * didapat dari event indexing saja.
 *
 * Subgraph ID: DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G
 * Free API key: https://thegraph.com/studio
 */

export interface GraphPool {
  id: string;
  hooks: string;
  token0: { id: string; symbol: string; name: string; decimals: string };
  token1: { id: string; symbol: string; name: string; decimals: string };
  feeTier: string;
  totalValueLockedUSD: string;
  volumeUSD: string;
  txCount: string;
  createdAtTimestamp: string;
  createdAtBlockNumber: string;
}

export interface HookTVLSummary {
  hookAddress: string;
  totalValueLockedUSD: number;
  volume24hUSD: number;
  volume7dUSD: number;
  poolCount: number;
  pools: GraphPool[];
}

const POOLS_QUERY = `
  query PoolsByHook($hook: String!, $skip: Int!) {
    pools(
      first: 100
      skip: $skip
      where: { hooks: $hook }
      orderBy: totalValueLockedUSD
      orderDirection: desc
    ) {
      id
      hooks
      token0 { id symbol name decimals }
      token1 { id symbol name decimals }
      feeTier
      totalValueLockedUSD
      volumeUSD
      txCount
      createdAtTimestamp
      createdAtBlockNumber
    }
  }
`;

const ALL_HOOKS_QUERY = `
  query AllHooks($skip: Int!) {
    pools(
      first: 1000
      skip: $skip
      where: { hooks_not: "0x0000000000000000000000000000000000000000" }
      orderBy: createdAtTimestamp
      orderDirection: desc
    ) {
      id
      hooks
      token0 { id symbol name decimals }
      token1 { id symbol name decimals }
      feeTier
      totalValueLockedUSD
      volumeUSD
      txCount
      createdAtTimestamp
      createdAtBlockNumber
    }
  }
`;

export class TheGraphClient {
  private readonly endpoint: string;

  constructor() {
    const apiKey = process.env.GRAPH_API_KEY;
    if (apiKey) {
      this.endpoint = `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G`;
    } else {
      // Fallback: The Graph free tier (rate-limited)
      this.endpoint = `https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v4-mainnet`;
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!process.env.GRAPH_API_KEY) {
      console.warn("[TheGraph] No GRAPH_API_KEY set — TVL data will be unavailable. Get a free key at https://thegraph.com/studio");
      return false;
    }
    try {
      const result = await this.query<{ _meta: { block: { number: number } } }>(
        `{ _meta { block { number } } }`
      );
      return !!result._meta;
    } catch {
      return false;
    }
  }

  /** Fetch all pools with hooks and aggregate TVL per hook address. */
  async getAllHooksWithTVL(): Promise<Map<string, HookTVLSummary>> {
    const allPools: GraphPool[] = [];
    let skip = 0;

    while (true) {
      const data = await this.query<{ pools: GraphPool[] }>(ALL_HOOKS_QUERY, { skip });
      const pools = data.pools ?? [];
      allPools.push(...pools);
      if (pools.length < 1000) break;
      skip += 1000;
      await sleep(200); // respect rate limits
    }

    return this.aggregateByHook(allPools);
  }

  /** Fetch TVL and pool data for a specific hook address. */
  async getHookTVL(hookAddress: string): Promise<HookTVLSummary | null> {
    const allPools: GraphPool[] = [];
    let skip = 0;

    while (true) {
      const data = await this.query<{ pools: GraphPool[] }>(POOLS_QUERY, {
        hook: hookAddress.toLowerCase(),
        skip,
      });
      const pools = data.pools ?? [];
      allPools.push(...pools);
      if (pools.length < 100) break;
      skip += 100;
    }

    if (allPools.length === 0) return null;

    const map = this.aggregateByHook(allPools);
    return map.get(hookAddress.toLowerCase()) ?? null;
  }

  private aggregateByHook(pools: GraphPool[]): Map<string, HookTVLSummary> {
    const byHook = new Map<string, HookTVLSummary>();

    for (const pool of pools) {
      const hook = pool.hooks.toLowerCase();
      if (!byHook.has(hook)) {
        byHook.set(hook, {
          hookAddress: hook,
          totalValueLockedUSD: 0,
          volume24hUSD: 0,
          volume7dUSD: 0,
          poolCount: 0,
          pools: [],
        });
      }
      const summary = byHook.get(hook)!;
      summary.totalValueLockedUSD += parseFloat(pool.totalValueLockedUSD) || 0;
      summary.poolCount++;
      summary.pools.push(pool);
    }

    return byHook;
  }

  private async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      throw new Error(`TheGraph HTTP ${res.status}: ${await res.text()}`);
    }

    const json = await res.json() as { data?: T; errors?: Array<{ message: string }> };

    if (json.errors?.length) {
      throw new Error(`TheGraph query error: ${json.errors[0].message}`);
    }

    return json.data!;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
