import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { rateLimiter } from "hono/rate-limiter";
import { hooksRouter } from "./routes/hooks.js";
import { searchRouter } from "./routes/search.js";
import { statsRouter } from "./routes/stats.js";
import { prisma } from "./db.js";

const app = new Hono();

// ── Middleware ─────────────────────────────────────────────────────────────
app.use("*", logger());
app.use("*", prettyJSON());
app.use(
  "*",
  cors({
    origin: process.env.CORS_ORIGIN ?? "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

// Rate limit: 100 req/min per IP
app.use(
  "/api/*",
  rateLimiter({
    windowMs: 60_000,
    limit: 100,
    keyGenerator: (c) =>
      c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown",
  })
);

// ── Routes ─────────────────────────────────────────────────────────────────
app.route("/api/hooks", hooksRouter);
app.route("/api/search", searchRouter);
app.route("/api/stats", statsRouter);

// Health check
app.get("/health", async (c) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch {
    return c.json({ status: "degraded", db: "unreachable" }, 503);
  }
});

// 404
app.notFound((c) => c.json({ error: "Not found" }, 404));

// Error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

// ── Start ──────────────────────────────────────────────────────────────────
const port = Number(process.env.API_PORT ?? 3001);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`HookScope API running on http://localhost:${info.port}`);
});
