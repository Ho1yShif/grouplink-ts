// Shared by scripts/placeholder.ts and scripts/preview.ts: write a snapshot to a
// local Redis, where `node dist/webhook.js` or `pnpm dev:web` serves it.
import { Redis } from "ioredis";
import type { PageModel } from "../src/render.js";
import { buildSnapshot, SITE_KEY } from "../src/snapshot.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Writes to REDIS_URL, or to redis://localhost:6379 when it is unset. Refuses a
 * Redis that is not on this machine, because the key is the live site on a Render
 * Key Value instance.
 */
export async function writeSnapshot(
  pages: Map<string, PageModel>,
  defaultSlug: string,
): Promise<void> {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
    throw new Error(`REDIS_URL must point at a local Redis for a preview, got ${url}`);
  }

  const redis = new Redis(url);
  try {
    await redis.set(SITE_KEY, buildSnapshot(pages, defaultSlug, new Date()));
  } finally {
    redis.disconnect();
  }
  console.log(`wrote ${SITE_KEY} with ${pages.size} page(s) to ${url}`);
  console.log(
    `serve it with: REDIS_URL=${url} WORKFLOW_SLUG=local RENDER_API_KEY=local pnpm dev:web`,
  );
}
