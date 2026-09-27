// Entry point for grouplink-webhook, the web service Notion posts to. It is the
// only thing that starts a rebuild.
//
// @render-lab/triggers can mount webhook adapters, but an adapter's map() result
// is dispatched immediately, so the debounce cannot live inside one. This uses
// the package for the dispatcher and the rest of the app, and adds one route.
//
// createReceiver builds the app and main starts it. The split is what lets a test
// drive the routes without a port or a real dispatcher.
import { serve } from "@hono/node-server";
import { createDispatchServer, renderDispatcher } from "@render-lab/triggers";
import { pathToFileURL } from "node:url";
import { envInt } from "./config.js";
import { createNotionWebhook, DEFAULT_DEBOUNCE_MS } from "./notion-webhook.js";

type NotionHandler = ReturnType<typeof createNotionWebhook>;
type Dispatcher = ReturnType<typeof renderDispatcher>;
// Named through the package that builds it. Annotating the two factories with the
// Hono type itself would mean importing hono, which is a transitive dependency.
type Receiver = ReturnType<typeof createDispatchServer>;

export interface ReceiverOptions {
  workflowSlug: string;
  handle: NotionHandler;
  dispatcher: Dispatcher;
}

/**
 * The receiver app. GET /healthz and POST /tasks/:task come from the package. The
 * task route is how you force a rebuild or run a dry run with custom input from the
 * command line. Passing the dispatcher in means both routes start runs through the
 * same client.
 */
export function createReceiver({ workflowSlug, handle, dispatcher }: ReceiverOptions): Receiver {
  const app = createDispatchServer({ workflowSlug, dispatcher });

  app.post("/webhooks/notion", async (c) => {
    const rawBody = await c.req.text();
    const result = handle({ headers: c.req.header(), rawBody });
    // Built by hand rather than with c.json, because the handler's status is a
    // plain number and Hono's helpers take a literal status union.
    if (result.body === undefined) return new Response(null, { status: result.status });
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "content-type": "application/json" },
    });
  });

  return app;
}

/** The receiver the service runs, from the environment. Names the variable it needs. */
export function buildReceiver(): Receiver {
  const workflowSlug = process.env.WORKFLOW_SLUG;
  if (!workflowSlug) throw new Error("set WORKFLOW_SLUG to the Workflow service's slug");

  const dispatcher = renderDispatcher({ slug: workflowSlug });
  const handle = createNotionWebhook({
    dispatch: (task, args) => dispatcher.start(task, args),
    secret: process.env.NOTION_WEBHOOK_SECRET,
    task: process.env.REBUILD_TASK ?? "grouplink.rebuild",
    debounceMs: envInt("DEBOUNCE_MS", process.env.DEBOUNCE_MS, DEFAULT_DEBOUNCE_MS),
  });

  return createReceiver({ workflowSlug, handle, dispatcher });
}

export function main(): void {
  const app = buildReceiver();
  const port = envInt("PORT", process.env.PORT, 3000);
  serve({ fetch: app.fetch, port });
  console.log(`webhook receiver listening on ${port}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
