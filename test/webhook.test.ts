// The receiver app. It owns POST /webhooks/notion and delegates every other route
// to the @render-lab/triggers dispatch server.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNotionWebhook } from "../src/notion-webhook.js";
import { buildReceiver, createReceiver } from "../src/webhook.js";

function receiver() {
  const calls: Array<[string, unknown[]]> = [];
  const dispatch = async (task: string, args: unknown[]) => {
    calls.push([task, args]);
    return { runId: "run-1" };
  };
  const app = createReceiver({
    workflowSlug: "grouplink",
    handle: createNotionWebhook({ dispatch, task: "grouplink.rebuild" }),
    // The dispatch server only ever calls start on this.
    dispatcher: { start: dispatch } as never,
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

describe("createReceiver", () => {
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
});

describe("buildReceiver", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("names the variable it needs", () => {
    vi.stubEnv("WORKFLOW_SLUG", "");
    expect(() => buildReceiver()).toThrow(/WORKFLOW_SLUG/);
  });
});
