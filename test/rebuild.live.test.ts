// Tier 2: live integration test. Opt-in only — gated behind RUN_LIVE=1 and real
// secrets, run via `pnpm test:live`. Never gates `pnpm test` (ADR-0010).
//
// Requires every variable in REQUIRED below. Runs in dry-run, so it reads Notion,
// scrapes, caches, and health-checks without committing or deploying anything.
import { localCtx } from "@render-lab/test-utils";
import { describe, expect, it } from "vitest";
import { rebuild } from "../src/rebuild.js";

/** Named here so a missing one fails on its own name, not on a config error. */
const REQUIRED = [
  "NOTION_TOKEN",
  "NOTION_LINKS_DATABASE_ID",
  "NOTION_PEOPLE_DATABASE_ID",
  "SITE_DEFAULT_SLUG",
  "REDIS_URL",
];

function requireEnv(): void {
  for (const name of REQUIRED) {
    expect(process.env[name], `set ${name}`).toBeTruthy();
  }
}

describe.skipIf(!process.env.RUN_LIVE)("grouplink.rebuild (live)", () => {
  it("reads the real Notion database and enriches every link", async () => {
    requireEnv();

    const result = await rebuild.func(localCtx(), { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.committed).toBe(false);
    expect(result.linkCount).toBeGreaterThan(0);
    expect(result.deadLinks, "every link should resolve").toEqual([]);
  }, 120_000);

  it("serves the second run from the Key Value cache", async () => {
    requireEnv();

    await rebuild.func(localCtx(), { dryRun: true });
    const second = await rebuild.func(localCtx(), { dryRun: true });

    expect(second.cacheHits).toBe(second.linkCount);
  }, 120_000);
});
