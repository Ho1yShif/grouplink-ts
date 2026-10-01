// The page routes of the web service: the snapshot in Key Value, rendered per request.
import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import { createNotionWebhook } from "../src/notion-webhook.js";
import { renderPage, type PageModel } from "../src/render.js";
import { createSiteStore } from "../src/site-store.js";
import { buildSnapshot } from "../src/snapshot.js";
import { createApp } from "../src/webhook.js";

const SHIFRA: PageModel = {
  name: "Shifra Williams",
  tagline: "Developer relations at Render.",
  cards: [
    {
      title: "Docs",
      url: "https://render.com/docs",
      description: "Guides",
      iconUrl: "https://render.com/favicon.ico",
      icon: "info",
    },
  ],
};
const ALEX: PageModel = { name: "Alex Rivera", tagline: "Engineer at Render.", cards: [] };

function snapshot(shifra = SHIFRA): string {
  return buildSnapshot(
    new Map([
      ["shifra", shifra],
      ["alex", ALEX],
    ]),
    "shifra",
    new Date("2026-09-30T00:00:00Z"),
  );
}

/** The web service with a fake Key Value read and a fake dispatcher. */
function server(value: string | null = snapshot()) {
  const kv = { value, error: null as Error | null, reads: 0 };
  const calls: Array<[string, unknown[]]> = [];
  const dispatch = async (task: string, args: unknown[]) => {
    calls.push([task, args]);
    return { runId: "run-1" };
  };
  const store = createSiteStore({
    read: async () => {
      kv.reads += 1;
      if (kv.error) throw kv.error;
      return kv.value;
    },
    rebuild: () => dispatch("grouplink.rebuild", [{}]),
  });
  const app = createApp({
    workflowSlug: "grouplink",
    dispatcher: fromPartial({ start: dispatch }),
    handle: createNotionWebhook({ dispatch, task: "grouplink.rebuild" }),
    store,
  });
  return { app, kv, calls };
}

const year = new Date().getFullYear();
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("page routes", () => {
  it("serves the default profile at the root", async () => {
    const response = await server().app.request("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=UTF-8");
    expect(await response.text()).toBe(renderPage(SHIFRA, year));
  });

  it("serves a profile at its slug with or without a trailing slash", async () => {
    const { app } = server();
    expect(await (await app.request("/alex")).text()).toBe(renderPage(ALEX, year));
    expect(await (await app.request("/alex/")).text()).toBe(renderPage(ALEX, year));
    expect(await (await app.request("/shifra")).text()).toBe(await (await app.request("/")).text());
  });

  it("answers an unknown slug with a 404 page", async () => {
    const response = await server().app.request("/nobody");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it.each(["/tasks", "/webhooks", "/assets"])(
    "answers the reserved path %s with a 404",
    async (path) => {
      expect((await server().app.request(path)).status).toBe(404);
    },
  );

  it("reads Key Value on each request", async () => {
    const { app, kv } = server();
    await app.request("/");
    kv.value = snapshot(ALEX);
    expect(await (await app.request("/")).text()).toBe(renderPage(ALEX, year));
    expect(kv.reads).toBe(2);
  });

  it("serves the last good copy when Key Value fails", async () => {
    const { app, kv } = server();
    await app.request("/");
    kv.error = new Error("Key Value is down");
    const response = await app.request("/");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(renderPage(SHIFRA, year));
  });

  it("answers 503 when Key Value fails before any good copy", async () => {
    const { app, kv, calls } = server();
    kv.error = new Error("Key Value is down");
    const response = await app.request("/");
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(calls).toEqual([]);
  });

  it("starts one rebuild and answers 503 while the key is missing", async () => {
    const { app, calls } = server(null);
    expect((await app.request("/")).status).toBe(503);
    expect((await app.request("/alex")).status).toBe(503);
    await tick();
    expect(calls).toEqual([["grouplink.rebuild", [{}]]]);
  });

  it("serves the page once the rebuild writes the key", async () => {
    const { app, kv } = server(null);
    await app.request("/");
    kv.value = snapshot();
    expect((await app.request("/")).status).toBe(200);
  });

  it("sends an ETag and answers 304 when it matches", async () => {
    const { app } = server();
    const first = await app.request("/");
    expect(first.headers.get("cache-control")).toBe("no-cache");
    const etag = first.headers.get("etag") ?? "";
    expect(etag).not.toBe("");

    const second = await app.request("/", { headers: { "if-none-match": etag } });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
  });

  it("changes the ETag when the page changes", async () => {
    const { app, kv } = server();
    const etag = (await app.request("/")).headers.get("etag");
    kv.value = snapshot(ALEX);
    expect((await app.request("/")).headers.get("etag")).not.toBe(etag);
  });

  it.each(["/", "/nobody", "/healthz", "/assets/render-logomark-black.svg"])(
    "sets the security headers on %s",
    async (path) => {
      const response = await server().app.request(path);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    },
  );

  it("serves the assets with their content types", async () => {
    const { app } = server();
    const svg = await app.request("/assets/render-logomark-black.svg");
    expect(svg.status).toBe(200);
    expect(svg.headers.get("content-type")).toMatch(/^image\/svg\+xml/);

    const font = await app.request("/assets/fonts/RoobertVF.woff2");
    expect(font.status).toBe(200);
    expect(font.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

    expect((await app.request("/assets/nothing.png")).status).toBe(404);
    const missingFont = await app.request("/assets/fonts/nothing.woff2");
    expect(missingFont.status).toBe(404);
    expect(missingFont.headers.get("cache-control") ?? "").not.toContain("immutable");
  });

  it("sends an ETag for an asset and answers 304 when it matches", async () => {
    const { app } = server();
    const first = await app.request("/assets/render-logomark-black.svg");
    const etag = first.headers.get("etag") ?? "";
    expect(etag).not.toBe("");

    const second = await app.request("/assets/render-logomark-black.svg", {
      headers: { "if-none-match": etag },
    });
    expect(second.status).toBe(304);
  });

  it("answers a HEAD request", async () => {
    const response = await server().app.request("/alex", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });
});
