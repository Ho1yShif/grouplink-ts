// Entry point for grouplink-webhook-ts, the web service that serves the page and
// receives Notion's webhook.
//
// It serves each profile's page from the snapshot grouplink.rebuild writes to Key
// Value, and it is the only thing that starts a rebuild.
//
// @render-lab/triggers can mount webhook adapters, but an adapter's map() result
// is dispatched immediately, so the debounce cannot live inside one. This uses the
// package for the dispatcher and the task route, and handles the rest itself.
//
// createApp builds the app and main starts it. The split lets a test drive the
// routes without a port, a real dispatcher, or a real Key Value instance.
import { fileURLToPath, pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  createDispatchServer,
  renderDispatcher,
  type WorkflowDispatcher,
} from "@render-lab/triggers";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { etag } from "hono/etag";
import { Redis } from "ioredis";
import { envInt } from "./config.js";
import { createNotionWebhook, DEFAULT_DEBOUNCE_MS } from "./notion-webhook.js";
import { createSiteStore, type SiteStore } from "./site-store.js";
import { SITE_KEY } from "./snapshot.js";

/** The same path from src/ under tsx and from dist/ under node. */
const ASSETS_DIR = fileURLToPath(new URL("../link/assets", import.meta.url));

const NOT_FOUND_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  "<title>Not found</title></head>" +
  '<body><p>There is no page here. <a href="/">Go to the links page</a>.</p></body></html>';

/** Largest Notion webhook body the service reads. The same limit as the task route. */
export const MAX_BODY_BYTES = 1_048_576;

/** Seconds a client waits before it asks again while there is no site to serve. */
export const RETRY_AFTER_SECONDS = 60;

export interface AppOptions {
  workflowSlug: string;
  dispatcher: WorkflowDispatcher;
  handle: ReturnType<typeof createNotionWebhook>;
  store: SiteStore;
}

/**
 * POST /tasks/:task comes from @render-lab/triggers. It is how you force a rebuild
 * or run a dry run with custom input from the command line. Passing the dispatcher
 * in means every route starts runs through the same client.
 */
export function createApp({ workflowSlug, dispatcher, handle, store }: AppOptions): Hono {
  const app = new Hono();

  // Security headers on every response, plus a one-year cache on the fonts.
  // Registered first, so it runs for the routes below it.
  app.use(async (c, next) => {
    await next();
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    if (c.res.status === 200 && c.req.path.startsWith("/assets/fonts/")) {
      c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    }
  });

  app.route("/", createDispatchServer({ workflowSlug, dispatcher }));

  app.post(
    "/webhooks/notion",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: "payload too large" }, 413),
    }),
    async (c) => {
      const rawBody = await c.req.text();
      const result = handle({ headers: c.req.header(), rawBody });
      // Built by hand rather than with c.json, because the handler's status is a
      // plain number and Hono's helpers take a literal status union.
      if (result.body === undefined) return new Response(null, { status: result.status });
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { "content-type": "application/json" },
      });
    },
  );

  app.use(
    "/assets/*",
    etag(),
    serveStatic({ root: ASSETS_DIR, rewriteRequestPath: (path) => path.slice("/assets".length) }),
  );

  async function page(c: Context): Promise<Response> {
    const snapshot = await store.snapshot();
    if (!snapshot) {
      return c.text("The page is being built. Try again in a minute.", 503, {
        "Retry-After": String(RETRY_AFTER_SECONDS),
      });
    }

    const html = store.page(snapshot, c.req.param("slug") ?? snapshot.defaultSlug);
    if (html === null) return c.html(NOT_FOUND_HTML, 404);

    // no-cache makes the browser revalidate, which the ETag makes cheap.
    c.header("Cache-Control", "no-cache");
    return c.html(html);
  }

  app.get("/", etag(), page);
  app.get("/:slug", etag(), page);
  app.get("/:slug/", etag(), page);
  app.notFound((c) => c.html(NOT_FOUND_HTML, 404));

  return app;
}

/** The app the service runs, from the environment. Names the variables it needs. */
export function buildApp(): Hono {
  const workflowSlug = process.env.WORKFLOW_SLUG;
  if (!workflowSlug) throw new Error("set WORKFLOW_SLUG to the Workflow service's slug");
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl)
    throw new Error("set REDIS_URL to the grouplink-cache Key Value connection string");

  // Short timeouts, because a request waits on this read. The store serves its last
  // good copy when the read fails.
  const redis = new Redis(redisUrl, {
    connectTimeout: 2_000,
    commandTimeout: 2_000,
    maxRetriesPerRequest: 1,
  });
  // ioredis prints a stack trace for every reconnect attempt if nothing listens
  // for "error". The store already serves the last good copy on a failed read, so
  // one short line is enough here.
  redis.on("error", (error: unknown) => {
    console.error(`Key Value connection error: ${String(error)}`);
  });
  const task = process.env.REBUILD_TASK ?? "grouplink.rebuild";
  const dispatcher = renderDispatcher({ slug: workflowSlug });

  return createApp({
    workflowSlug,
    dispatcher,
    handle: createNotionWebhook({
      dispatch: (name, args) => dispatcher.start(name, args),
      secret: process.env.NOTION_WEBHOOK_SECRET,
      task,
      debounceMs: envInt("DEBOUNCE_MS", process.env.DEBOUNCE_MS, DEFAULT_DEBOUNCE_MS),
    }),
    store: createSiteStore({
      read: () => redis.get(SITE_KEY),
      rebuild: () => dispatcher.start(task, [{}]),
    }),
  });
}

export function main(): void {
  const app = buildApp();
  const port = envInt("PORT", process.env.PORT, 3000);
  serve({ fetch: app.fetch, port });
  console.log(`grouplink-webhook-ts listening on ${port}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
