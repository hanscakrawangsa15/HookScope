import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../db.js";
import { cacheGet, cacheSet } from "../cache.js";
import { HookListQuerySchema } from "@hookscope/shared";
import { decodeHookFlags, getActiveCallbackNames } from "@hookscope/shared";

export const hooksRouter = new Hono();

// ── GET /hooks — List with search, filter, sort, pagination ──────────────────
hooksRouter.get("/", zValidator("query", HookListQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const cacheKey = `hooks:list:${JSON.stringify(query)}`;

  const cached = await cacheGet(cacheKey);
  if (cached) return c.json(cached);

  const where: Record<string, unknown> = {};

  if (query.chain) where.chainId = query.chain;
  if (query.auditStatus) where.auditStatus = query.auditStatus;
  if (query.riskLevel) where.riskLevel = query.riskLevel;

  // Callback filter: e.g. "beforeSwap,afterSwap"
  if (query.callbacks) {
    const names = query.callbacks.split(",").map((s) => s.trim());
    for (const name of names) {
      if (isValidCallback(name)) {
        where[name] = true;
      }
    }
  }

  // Text search across name + description (full-text)
  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: "insensitive" } },
      { description: { contains: query.q, mode: "insensitive" } },
      { address: { contains: query.q.toLowerCase() } },
    ];
  }

  const ord = query.order as "asc" | "desc";
  const orderByMap: Record<string, unknown> = {
    tvl:       { analytics: { tvlUsd: ord } },
    newest:    { deployedAt: ord },
    riskScore: { hookScore: ord },
    poolCount: { analytics: { poolCount: ord } },
  };

  const [total, hooks] = await Promise.all([
    prisma.hook.count({ where }),
    prisma.hook.findMany({
      where,
      include: {
        analytics: true,
        securityReport: { select: { score: true, findings: true, criticalCount: true } },
        _count: { select: { pools: true } },
      },
      orderBy: orderByMap[query.sortBy] ?? { deployedAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  const data = hooks.map(mapHookSummary);
  const response = {
    data,
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit),
  };

  await cacheSet(cacheKey, response, 30);
  return c.json(response);
});

// Accepts both EVM (0x hex) and Solana (base58) addresses
const addressSchema = z.string().regex(
  /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/,
  "Must be a valid EVM (0x…) or Solana (base58) address"
);

// ── GET /hooks/:address — Full hook detail ────────────────────────────────────
hooksRouter.get(
  "/:address",
  zValidator(
    "param",
    z.object({ address: addressSchema })
  ),
  zValidator("query", z.object({ chainId: z.coerce.number().optional() })),
  async (c) => {
    const { address } = c.req.valid("param");
    const { chainId } = c.req.valid("query");
    const cacheKey = `hook:${address.toLowerCase()}:${chainId ?? "any"}`;

    const cached = await cacheGet(cacheKey);
    if (cached) return c.json(cached);

    const where: Record<string, unknown> = {
      address: address.toLowerCase(),
    };
    if (chainId) where.chainId = chainId;

    const hook = await prisma.hook.findFirst({
      where,
      include: {
        functions: { orderBy: { name: "asc" } },
        sourceFiles: true,
        securityReport: true,
        securityFlags: { orderBy: { severity: "asc" } },
        auditRecords: { orderBy: { auditDate: "desc" } },
        analytics: true,
        pools: {
          take: 20,
          orderBy: { tvlUsd: "desc" },
        },
      },
    });

    if (!hook) {
      return c.json({ error: "Hook not found" }, 404);
    }

    // Find similar hooks by callback overlap
    const callbacks = decodeHookFlags(hook.address as `0x${string}`);
    const activeCallbacks = getActiveCallbackNames(callbacks);

    const similarHooks = activeCallbacks.length > 0
      ? await prisma.hook.findMany({
          where: {
            id: { not: hook.id },
            chainId: hook.chainId,
            OR: activeCallbacks.slice(0, 3).map((cb) => ({ [cb]: true })),
          },
          include: { analytics: true },
          take: 5,
          orderBy: { hookScore: "desc" },
        })
      : [];

    const response = {
      ...mapHookDetail(hook),
      similarHooks: similarHooks.map(mapHookSummary),
    };

    await cacheSet(cacheKey, response, 60);
    return c.json(response);
  }
);

// ── GET /hooks/:address/source — Source code files ───────────────────────────
hooksRouter.get(
  "/:address/source",
  zValidator("param", z.object({ address: addressSchema })),
  zValidator("query", z.object({ chainId: z.coerce.number().optional() })),
  async (c) => {
    const { address } = c.req.valid("param");
    const { chainId } = c.req.valid("query");

    const hook = await prisma.hook.findFirst({
      where: { address: address.toLowerCase(), ...(chainId ? { chainId } : {}) },
      include: { sourceFiles: true },
    });

    if (!hook) return c.json({ error: "Hook not found" }, 404);
    if (!hook.sourceFiles.length) {
      return c.json({ error: "Source code not verified", isVerified: false }, 404);
    }

    return c.json({
      isVerified: hook.isVerified,
      contractName: hook.name,
      sourceFiles: hook.sourceFiles.map((sf) => ({
        name: sf.fileName,
        content: sf.content,
        language: sf.language,
      })),
    });
  }
);

// ── GET /hooks/:address/security — Security report + flags ───────────────────
hooksRouter.get(
  "/:address/security",
  zValidator("param", z.object({ address: addressSchema })),
  async (c) => {
    const { address } = c.req.valid("param");

    const hook = await prisma.hook.findFirst({
      where: { address: address.toLowerCase() },
      include: {
        securityReport: true,
        securityFlags: { orderBy: { severity: "asc" } },
        auditRecords: true,
      },
    });

    if (!hook) return c.json({ error: "Hook not found" }, 404);

    return c.json({
      hookScore: hook.hookScore,
      riskLevel: hook.riskLevel,
      auditStatus: hook.auditStatus,
      report: hook.securityReport,
      flags: hook.securityFlags,
      auditRecords: hook.auditRecords,
    });
  }
);

// ── GET /hooks/:address/pools — Pools using this hook ────────────────────────
hooksRouter.get(
  "/:address/pools",
  zValidator("param", z.object({ address: z.string() })),
  zValidator(
    "query",
    z.object({
      chainId: z.coerce.number().optional(),
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(20),
    })
  ),
  async (c) => {
    const { address } = c.req.valid("param");
    const { chainId, page, limit } = c.req.valid("query");

    const hook = await prisma.hook.findFirst({
      where: { address: address.toLowerCase(), ...(chainId ? { chainId } : {}) },
    });
    if (!hook) return c.json({ error: "Hook not found" }, 404);

    const [total, pools] = await Promise.all([
      prisma.pool.count({ where: { hookId: hook.id } }),
      prisma.pool.findMany({
        where: { hookId: hook.id },
        orderBy: { tvlUsd: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return c.json({ data: pools, total, page, limit, totalPages: Math.ceil(total / limit) });
  }
);

// ── GET /hooks/compare — Side-by-side comparison ─────────────────────────────
hooksRouter.get(
  "/compare",
  zValidator(
    "query",
    z.object({
      addresses: z.string().transform((s) => s.split(",").slice(0, 4)),
    })
  ),
  async (c) => {
    const { addresses } = c.req.valid("query");

    const hooks = await prisma.hook.findMany({
      where: { address: { in: addresses.map((a) => a.toLowerCase()) } },
      include: {
        functions: true,
        securityReport: true,
        analytics: true,
        securityFlags: true,
      },
    });

    return c.json(hooks.map(mapHookDetail));
  }
);

// ─── Mappers ──────────────────────────────────────────────────────────────────

type HookWithIncludes = Awaited<
  ReturnType<typeof prisma.hook.findFirst>
> & {
  _count?: { pools: number };
  analytics?: { tvlUsd: number; poolCount: number } | null;
  securityReport?: { score: number; findings: number; criticalCount: number } | null;
};

function mapHookSummary(hook: HookWithIncludes) {
  return {
    id: hook!.id,
    address: hook!.address,
    chainId: hook!.chainId,
    name: hook!.name,
    description: hook!.description,
    deployedAt: hook!.deployedAt,
    deployer: hook!.deployer,
    isVerified: hook!.isVerified,
    proxyType: hook!.proxyType,
    callbacks: {
      beforeInitialize: hook!.beforeInitialize,
      afterInitialize: hook!.afterInitialize,
      beforeAddLiquidity: hook!.beforeAddLiquidity,
      afterAddLiquidity: hook!.afterAddLiquidity,
      beforeRemoveLiquidity: hook!.beforeRemoveLiquidity,
      afterRemoveLiquidity: hook!.afterRemoveLiquidity,
      beforeSwap: hook!.beforeSwap,
      afterSwap: hook!.afterSwap,
      beforeDonate: hook!.beforeDonate,
      afterDonate: hook!.afterDonate,
      beforeSwapReturnsDelta: hook!.beforeSwapReturnsDelta,
      afterSwapReturnsDelta: hook!.afterSwapReturnsDelta,
      afterAddLiquidityReturnsDelta: hook!.afterAddLiquidityReturnsDelta,
      afterRemoveLiquidityReturnsDelta: hook!.afterRemoveLiquidityReturnsDelta,
    },
    riskLevel: hook!.riskLevel,
    hookScore: hook!.hookScore,
    auditStatus: hook!.auditStatus,
    tvlUsd: hook!.analytics?.tvlUsd ?? null,
    poolCount: hook!._count?.pools ?? hook!.analytics?.poolCount ?? 0,
  };
}

function mapHookDetail(hook: NonNullable<HookWithIncludes> & {
  functions?: unknown[];
  sourceFiles?: unknown[];
  securityFlags?: unknown[];
  auditRecords?: unknown[];
}) {
  return {
    ...mapHookSummary(hook),
    bytecodeHash: hook.bytecodeHash,
    implementationAddress: hook.implementationAddress,
    functions: hook.functions ?? [],
    sourceFiles: (hook.sourceFiles as Array<{fileName: string; language: string}> | undefined)
      ?.map((sf) => ({ name: sf.fileName, language: sf.language })) ?? [],
    securityFlags: hook.securityFlags ?? [],
    auditRecords: hook.auditRecords ?? [],
    analytics: hook.analytics ?? null,
  };
}

const VALID_CALLBACKS = new Set([
  "beforeInitialize", "afterInitialize",
  "beforeAddLiquidity", "afterAddLiquidity",
  "beforeRemoveLiquidity", "afterRemoveLiquidity",
  "beforeSwap", "afterSwap",
  "beforeDonate", "afterDonate",
  "beforeSwapReturnsDelta", "afterSwapReturnsDelta",
  "afterAddLiquidityReturnsDelta", "afterRemoveLiquidityReturnsDelta",
]);

function isValidCallback(name: string): boolean {
  return VALID_CALLBACKS.has(name);
}
