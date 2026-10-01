// The web service's copy of the site: the last good snapshot, the render cache,
// and the rebuild it starts when the key is missing.
import { describe, expect, it, vi } from "vitest";
import type { PageModel } from "../src/render.js";
import { renderPage } from "../src/render.js";
import { createSiteStore, REBUILD_RETRY_MS } from "../src/site-store.js";
import { buildSnapshot } from "../src/snapshot.js";

const SHIFRA: PageModel = { name: "Shifra Williams", tagline: "DevRel.", cards: [] };
const ALEX: PageModel = { name: "Alex Rivera", tagline: "Engineer.", cards: [] };

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

/** Lets a rebuild that the store started without waiting run to completion. */
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("createSiteStore", () => {
  it("renders a page once per snapshot and year", async () => {
    const store = createSiteStore({ read: async () => snapshot(), rebuild: async () => {} });
    const current = await store.snapshot();
    if (!current) throw new Error("no snapshot");

    expect(store.page(current, "alex", 2026)).toBe(renderPage(ALEX, 2026));
    expect(store.page(current, "alex", 2026)).toBe(store.page(current, "alex", 2026));
    expect(store.page(current, "nobody", 2026)).toBeNull();
  });

  it("serves the last good copy when Key Value fails", async () => {
    const read = vi.fn<() => Promise<string | null>>().mockResolvedValueOnce(snapshot());
    read.mockRejectedValue(new Error("Key Value is down"));
    const store = createSiteStore({ read, rebuild: async () => {} });

    const first = await store.snapshot();
    expect(await store.snapshot()).toBe(first);
  });

  it("serves the last good copy when the value will not parse", async () => {
    const doc = JSON.parse(snapshot());
    doc.schema = 2;
    const values = [snapshot(), JSON.stringify(doc)];
    const store = createSiteStore({
      read: async () => values.shift() ?? null,
      rebuild: async () => {},
    });

    const first = await store.snapshot();
    expect(await store.snapshot()).toBe(first);
  });

  it("starts another rebuild when the key stays missing", async () => {
    // The first run can fail or be a dry run, so the page must not stay at 503.
    let now = 0;
    const rebuild = vi.fn(async () => {});
    const store = createSiteStore({ read: async () => null, rebuild, now: () => now });

    await store.snapshot();
    await tick();
    now = REBUILD_RETRY_MS - 1;
    await store.snapshot();
    await tick();
    expect(rebuild).toHaveBeenCalledTimes(1);

    now = REBUILD_RETRY_MS + 1;
    await store.snapshot();
    await tick();
    expect(rebuild).toHaveBeenCalledTimes(2);
  });

  it("tries again on the next request when the rebuild fails to start", async () => {
    const rebuild = vi.fn<() => Promise<unknown>>().mockRejectedValueOnce(new Error("API down"));
    rebuild.mockResolvedValue({ runId: "run-1" });
    const store = createSiteStore({ read: async () => null, rebuild });

    await store.snapshot();
    await tick();
    await store.snapshot();
    await tick();
    expect(rebuild).toHaveBeenCalledTimes(2);
  });

  it("does not wait for the rebuild to start", async () => {
    // The Render API call can be slow, and a request must not wait on it.
    const store = createSiteStore({
      read: async () => null,
      rebuild: () => new Promise(() => {}),
    });
    expect(await store.snapshot()).toBeNull();
  });

  it("keeps the newer snapshot when an older read finishes last", async () => {
    let releaseSlowRead: (value: string) => void = () => {};
    const reads = [
      new Promise<string>((resolve) => {
        releaseSlowRead = resolve;
      }),
      Promise.resolve(snapshot()),
    ];
    const read = vi.fn(() => reads.shift() ?? Promise.reject(new Error("Key Value is down")));
    const store = createSiteStore({ read, rebuild: async () => {} });

    const slow = store.snapshot();
    const fast = await store.snapshot();
    releaseSlowRead(snapshot(ALEX));
    await slow;

    // The next read fails, so the store answers with its last good copy.
    expect(await store.snapshot()).toBe(fast);
  });
});
