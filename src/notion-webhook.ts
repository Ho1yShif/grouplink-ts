// The Notion webhook receiver, minus the HTTP. Handling a request is
// verify → filter → debounce → dispatch, and none of those steps needs a server
// or the Render SDK, so the tests need neither.
import { createHmac, timingSafeEqual } from "node:crypto";

/** A request as the handler sees it: lowercased headers and the unparsed body. */
export interface WebhookRequest {
  headers: Record<string, string>;
  rawBody: string;
}

/** What the caller should answer. `body` is undefined for a 204. */
export interface WebhookResponse {
  status: number;
  body?: unknown;
}

/** Starts a workflow run. The Render SDK dispatcher satisfies this. */
export type Dispatch = (task: string, args: unknown[]) => Promise<{ runId: string }>;

export interface NotionWebhookOptions {
  dispatch: Dispatch;
  /** Subscription verification token. Unset accepts the handshake; see below. */
  secret?: string;
  /** Task to dispatch. */
  task: string;
  /** Milliseconds of quiet before the dispatch fires. */
  debounceMs?: number;
}

/**
 * Event types that mean a page the site renders may have changed. Notion sends
 * many more, including comment and workspace events.
 */
const REBUILD_EVENTS = new Set([
  "page.created",
  "page.deleted",
  "page.undeleted",
  "page.properties_updated",
  "page.content_updated",
  "data_source.content_updated",
  "data_source.schema_updated",
]);

export const DEFAULT_DEBOUNCE_MS = 60_000;

/**
 * Notion signs the raw body with HMAC-SHA256 keyed by the subscription's
 * verification token. Lengths are compared first, because timingSafeEqual throws
 * on buffers of different sizes.
 */
function verifySignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`,
    "utf8",
  );
  const received = Buffer.from(header, "utf8");
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

/** A top-level string field of the parsed body, or "" if it is absent or not a string. */
function stringField(body: unknown, key: string): string {
  if (typeof body !== "object" || body === null) return "";
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

/**
 * Build the handler. One pending timer lives in this closure, so eight edits in
 * one sitting collapse into one run and one health-check pass over every link.
 *
 * There is no filter on database ID. Under Notion API version 2025-09-03 an
 * event's `data.parent.id` is a data source ID rather than the database ID in
 * NOTION_LINKS_DATABASE_ID, so an ID filter would drop every event. The
 * integration is shared with only the two databases, and the debounce absorbs
 * whatever else arrives.
 */
export function createNotionWebhook(options: NotionWebhookOptions) {
  const { dispatch, secret, task, debounceMs = DEFAULT_DEBOUNCE_MS } = options;
  let pending: NodeJS.Timeout | undefined;

  function schedule(): void {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = undefined;
      dispatch(task, [{}]).then(
        ({ runId }) => console.log(`dispatched ${task} (${runId})`),
        (error: unknown) => console.error(`dispatch failed: ${String(error)}`),
      );
    }, debounceMs);
    // A pending rebuild should not hold the process open through a shutdown.
    // Optional call because vitest's fake timers return a plain object.
    pending.unref?.();
  }

  return function handle(req: WebhookRequest): WebhookResponse {
    // Creating a subscription makes Notion POST the verification token once, with
    // no signature and before there is a secret to check it against. So an
    // unsigned body is accepted while the secret is unset, and never after.
    if (secret && !verifySignature(req.rawBody, req.headers["x-notion-signature"], secret)) {
      return { status: 401, body: { error: "bad signature" } };
    }

    let body: unknown;
    try {
      body = JSON.parse(req.rawBody);
    } catch {
      return { status: 400, body: { error: "bad JSON" } };
    }

    const token = stringField(body, "verification_token");
    if (token) {
      console.log(`notion verification_token: ${token}`);
      return { status: 200, body: { ok: true } };
    }

    if (!REBUILD_EVENTS.has(stringField(body, "type"))) {
      return { status: 204 };
    }

    schedule();
    // Not a run ID: the run does not exist yet, and will not for debounceMs. A
    // restart inside that window drops the pending dispatch, and Notion's retries
    // do not cover it, because this answer was already a success.
    return { status: 202, body: { scheduled: true } };
  };
}
