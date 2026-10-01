// The non-page routes of the web service: POST /webhooks/notion, and the routes it
// delegates to the @render-lab/triggers dispatch server.
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNotionWebhook } from "../src/notion-webhook.js";
import { createSiteStore } from "../src/site-store.js";
import { buildApp, createApp, MAX_BODY_BYTES } from "../src/webhook.js";

function receiver() {
  const calls: Array<[string, unknown[]]> = [];
  const dispatch = async (task: string, args: unknown[]) => {
    calls.push([task, args]);
    return { runId: "run-1" };
  };
  const app = createApp({
    workflowSlug: "grouplink",
    handle: createNotionWebhook({ dispatch, task: "grouplink.rebuild" }),
    dispatcher: fromPartial({ start: dispatch }),
    store: createSiteStore({ read: async () => null, rebuild: async () => {} }),
  });
  return { app, calls };
}

function post(app: ReturnType<typeof receiver>["app"], path: string, body: string) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("createApp", () => {
  it("answers the notion route itself", async () => {
    const { app } = receiver();
    const response = await post(
      app,
      "/webhooks/notion",
      JSON.stringify({ verification_token: "from-notion" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("sends no body with a 204", async () => {
    const { app } = receiver();
    const response = await post(
      app,
      "/webhooks/notion",
      JSON.stringify({ type: "comment.created" }),
    );

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
  });

  it("delegates the health check to the dispatch server", async () => {
    const { app } = receiver();
    const response = await app.request("/healthz");

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ok");
  });

  it("delegates an unauthenticated task dispatch", async () => {
    const { app } = receiver();
    const response = await post(app, "/tasks/grouplink.rebuild", "[]");

    expect(response.status).toBe(401);
  });

  it("delegates a get on the notion path", async () => {
    const { app } = receiver();
    const response = await app.request("/webhooks/notion");

    expect(response.status).toBe(404);
  });

  it("answers a HEAD on the health check", async () => {
    const { app } = receiver();
    expect((await app.request("/healthz", { method: "HEAD" })).status).toBe(200);
  });

  it("refuses a notion body over the limit", async () => {
    const { app } = receiver();
    const response = await post(app, "/webhooks/notion", "x".repeat(MAX_BODY_BYTES + 1));
    expect(response.status).toBe(413);
  });

  it("refuses a body over the limit by content-length, without reading it", async () => {
    const { app } = receiver();
    let pulls = 0;
    let sent = 0;
    const chunkSize = 65_536;
    const chunks = Math.ceil((MAX_BODY_BYTES + 1) / chunkSize);
    const body = new ReadableStream({
      pull(controller) {
        pulls += 1;
        if (sent >= chunks) {
          controller.close();
          return;
        }
        sent += 1;
        controller.enqueue(new TextEncoder().encode("x".repeat(chunkSize)));
      },
    });
    const response = await app.request("/webhooks/notion", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(MAX_BODY_BYTES + 1),
      },
      body,
      duplex: "half",
    });

    expect(response.status).toBe(413);
    expect(pulls).toBeLessThanOrEqual(1);
  }, 10_000);

  it("stops reading a streamed body near the limit when content-length is absent", async () => {
    const { app } = receiver();
    let pulls = 0;
    let sent = 0;
    const chunk = new TextEncoder().encode("x".repeat(1024));
    // Bounded well past the limit, so the stream always ends even if something reads
    // the whole thing instead of stopping at the limit.
    const chunks = Math.ceil((MAX_BODY_BYTES + 1) / chunk.length) + 5;
    const body = new ReadableStream({
      pull(controller) {
        pulls += 1;
        if (sent >= chunks) {
          controller.close();
          return;
        }
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const response = await app.request("/webhooks/notion", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    });

    expect(response.status).toBe(413);
    // A couple of pulls past the limit is the stream's own read-ahead buffer.
    expect(pulls).toBeLessThanOrEqual(Math.ceil(MAX_BODY_BYTES / chunk.length) + 2);
  }, 10_000);
});

describe("buildApp", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("names the variables it needs", () => {
    vi.stubEnv("WORKFLOW_SLUG", "");
    vi.stubEnv("REDIS_URL", "");
    expect(() => buildApp()).toThrow(/WORKFLOW_SLUG/);

    vi.stubEnv("WORKFLOW_SLUG", "grouplink");
    expect(() => buildApp()).toThrow(/REDIS_URL/);
    vi.unstubAllEnvs();
  });
});
