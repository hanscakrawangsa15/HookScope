import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

// Prisma returns BigInt for block numbers — patch globally so JSON.stringify handles it
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { hooksRouter } from "./routes/hooks.js";
import { searchRouter } from "./routes/search.js";
import { statsRouter } from "./routes/stats.js";
import { analyticsRouter } from "./routes/analytics.js";
import { prisma } from "./db.js";

const app = new Hono();

// ── Simple in-memory rate limiter (100 req/min per IP) ─────────────────────
const rateCounts = new Map<string, { count: number; reset: number }>();
app.use("/api/*", async (c, next) => {
  const ip = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
  const now = Date.now();
  const entry = rateCounts.get(ip);
  if (!entry || entry.reset < now) {
    rateCounts.set(ip, { count: 1, reset: now + 60_000 });
  } else if (entry.count >= 100) {
    return c.json({ error: "Too many requests" }, 429);
  } else {
    entry.count++;
  }
  await next();
});

// ── Middleware ─────────────────────────────────────────────────────────────
app.use("*", logger());
app.use("*", prettyJSON());
// Accept multiple CORS origins: comma-separated list or wildcard
const rawOrigin = process.env.CORS_ORIGIN ?? "*";
const allowedOrigins = rawOrigin === "*" ? "*" : rawOrigin.split(",").map((o) => o.trim());
app.use(
  "*",
  cors({
    origin: (origin) => {
      if (allowedOrigins === "*") return origin;
      if (!origin) return allowedOrigins[0];
      if (allowedOrigins.some((o) => origin === o || origin.endsWith(".vercel.app"))) return origin;
      return allowedOrigins[0];
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

// ── Routes ─────────────────────────────────────────────────────────────────
app.route("/api/hooks", hooksRouter);
app.route("/api/search", searchRouter);
app.route("/api/stats", statsRouter);
app.route("/api/analytics", analyticsRouter);

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
