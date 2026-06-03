import Redis from "ioredis";

let redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    redis.on("error", (err) => {
      console.warn("[Redis] Connection error (cache disabled):", err.message);
      redis = null;
    });
  }
  return redis;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const r = getRedis();
    if (!r) return null;
    const raw = await r.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds = 60
): Promise<void> {
  try {
    const r = getRedis();
    if (!r) return;
    await r.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // cache failure is non-fatal
  }
}

export async function cacheDelete(pattern: string): Promise<void> {
  try {
    const r = getRedis();
    if (!r) return;
    const keys = await r.keys(pattern);
    if (keys.length) await r.del(...keys);
  } catch {
    // non-fatal
  }
}
