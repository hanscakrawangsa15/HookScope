import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../db.js";
import { cacheGet, cacheSet } from "../cache.js";

export const searchRouter = new Hono();

// ── GET /search — Global semantic/text search ────────────────────────────────
searchRouter.get(
  "/",
  zValidator(
    "query",
    z.object({
      q: z.string().min(1).max(100),
      limit: z.coerce.number().default(10),
    })
  ),
  async (c) => {
    const { q, limit } = c.req.valid("query");
    const cacheKey = `search:${q.toLowerCase()}:${limit}`;

    const cached = await cacheGet(cacheKey);
    if (cached) return c.json(cached);

    const searchTerm = q.toLowerCase().trim();

    // Multi-strategy search:
    // 1. Exact address match
    // 2. Contract name match
    // 3. Fuzzy description match
    // 4. Callback function name match
    const results = await prisma.hook.findMany({
      where: {
        OR: [
          { address: { contains: searchTerm } },
          { name: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
          // Callback name search: if user searches "swap", find hooks with beforeSwap/afterSwap
          ...(buildCallbackSearch(searchTerm)),
        ],
      },
      include: {
        analytics: true,
        _count: { select: { pools: true } },
      },
      take: limit,
      orderBy: [
        { hookScore: "desc" },
        { deployedAt: "desc" },
      ],
    });

    const response = {
      query: q,
      results: results.map((hook) => ({
        address: hook.address,
        chainId: hook.chainId,
        name: hook.name,
        description: hook.description,
        hookScore: hook.hookScore,
        riskLevel: hook.riskLevel,
        auditStatus: hook.auditStatus,
        poolCount: hook._count.pools,
      })),
    };

    await cacheSet(cacheKey, response, 60);
    return c.json(response);
  }
);

// ── GET /search/suggestions — Autocomplete ───────────────────────────────────
searchRouter.get(
  "/suggestions",
  zValidator("query", z.object({ q: z.string().min(1) })),
  async (c) => {
    const { q } = c.req.valid("query");

    const hooks = await prisma.hook.findMany({
      where: {
        OR: [
          { name: { startsWith: q, mode: "insensitive" } },
          { address: { startsWith: q.toLowerCase() } },
        ],
      },
      select: { address: true, name: true, chainId: true },
      take: 5,
    });

    return c.json(hooks);
  }
);

function buildCallbackSearch(
  term: string
): Array<Record<string, boolean>> {
  const CALLBACK_KEYWORDS: Record<string, string[]> = {
    swap: ["beforeSwap", "afterSwap"],
    liquidity: ["beforeAddLiquidity", "afterAddLiquidity", "beforeRemoveLiquidity", "afterRemoveLiquidity"],
    initialize: ["beforeInitialize", "afterInitialize"],
    donate: ["beforeDonate", "afterDonate"],
    delta: ["beforeSwapReturnsDelta", "afterSwapReturnsDelta", "afterAddLiquidityReturnsDelta"],
    fee: ["beforeSwap"], // dynamic fee hooks use beforeSwap
    mev: ["beforeSwap"],
    kyc: ["beforeAddLiquidity"],
    whitelist: ["beforeAddLiquidity"],
    oracle: ["afterInitialize"],
    yield: ["afterRemoveLiquidity"],
    reward: ["afterAddLiquidity"],
  };

  const matches: Array<Record<string, boolean>> = [];
  for (const [keyword, callbacks] of Object.entries(CALLBACK_KEYWORDS)) {
    if (term.includes(keyword)) {
      for (const cb of callbacks) {
        matches.push({ [cb]: true });
      }
    }
  }
  return matches;
}
