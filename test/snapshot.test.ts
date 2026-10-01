// The snapshot the Workflow writes to Key Value and the web service reads back.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toCard } from "../src/links.js";
import type { PageModel } from "../src/render.js";
import { buildSnapshot, parseSnapshot, SCHEMA } from "../src/snapshot.js";
import { DEFAULT_SLUG, PROFILES, TAGLINE } from "../scripts/placeholder.js";

const BUILT_AT = new Date("2026-09-30T18:00:00Z");

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

function build(
  pages = new Map([
    ["shifra", SHIFRA],
    ["alex", ALEX],
  ]),
  defaultSlug = "shifra",
  builtAt = BUILT_AT,
): string {
  return buildSnapshot(pages, defaultSlug, builtAt);
}

describe("buildSnapshot", () => {
  it("writes the documented shape", () => {
    const doc = JSON.parse(build());
    expect(doc.schema).toBe(SCHEMA);
    expect(SCHEMA).toBe(1);
    expect(doc.builtAt).toBe("2026-09-30T18:00:00Z");
    expect(doc.defaultSlug).toBe("shifra");
    expect(doc.pages[0]).toEqual({ slug: "shifra", ...SHIFRA });
    expect(doc.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes the pages and default slug the same way grouplink-py does", () => {
    const fixture = readFileSync(join(import.meta.dirname, "golden", "snapshot.json"), "utf8");
    const pages = new Map(
      PROFILES.map((profile) => [
        profile.slug,
        {
          name: profile.name,
          tagline: TAGLINE,
          cards: profile.links.map((link) => toCard(link, link.description)),
        },
      ]),
    );
    const ours = parseSnapshot(buildSnapshot(pages, DEFAULT_SLUG, BUILT_AT));
    expect(ours.hash).toBe(parseSnapshot(fixture).hash);
  });

  it("escapes U+007F in the hash input the way grouplink-py does", () => {
    const page: PageModel = { name: "Shifra Williams", tagline: "DEL\u007f here", cards: [] };
    const doc = parseSnapshot(build(new Map([["shifra", page]]), "shifra"));
    // grouplink-py wrote this with build_snapshot for the same page, slug, and
    // built-at time.
    expect(doc.hash).toBe("fd36acb9b3135c0cd1be75f505fb67db69190346440a275bdff70b25645de856");
  });

  it("leaves the build time out of the hash", () => {
    const later = new Date("2027-01-01T00:00:00Z");
    expect(parseSnapshot(build(undefined, undefined, later)).hash).toBe(
      parseSnapshot(build()).hash,
    );
  });

  it("changes the hash with the pages or the default slug", () => {
    const base = parseSnapshot(build()).hash;
    expect(parseSnapshot(build(new Map([["shifra", SHIFRA]]))).hash).not.toBe(base);
    expect(parseSnapshot(build(undefined, "alex")).hash).not.toBe(base);
  });
});

describe("parseSnapshot", () => {
  it("reads back what it wrote, in profile order", () => {
    const snapshot = parseSnapshot(build());
    expect(snapshot.defaultSlug).toBe("shifra");
    expect([...snapshot.pages.keys()]).toEqual(["shifra", "alex"]);
    expect(snapshot.pages.get("shifra")).toEqual(SHIFRA);
    expect(snapshot.pages.get("alex")).toEqual(ALEX);
  });

  it("reads a snapshot grouplink-py wrote", () => {
    const fixture = readFileSync(join(import.meta.dirname, "golden", "snapshot.json"), "utf8");
    const snapshot = parseSnapshot(fixture);
    expect([...snapshot.pages.keys()]).toEqual(["shifra", "graham"]);
    expect(snapshot.pages.get("shifra")?.cards[2]?.description).toContain("—");
  });

  it("refuses a schema it does not know", () => {
    const doc = JSON.parse(build());
    doc.schema = 2;
    expect(() => parseSnapshot(JSON.stringify(doc))).toThrow(/schema/);
  });

  it.each([
    "not json",
    "[]",
    JSON.stringify({ schema: 1 }),
    JSON.stringify({ schema: 1, pages: 3 }),
  ])("refuses %s", (raw) => {
    expect(() => parseSnapshot(raw)).toThrow();
  });

  it("refuses a default slug with no page", () => {
    expect(() => parseSnapshot(build(undefined, "nobody"))).toThrow(/defaultSlug/);
  });

  it("draws the default icon for an icon this build does not ship", () => {
    const doc = JSON.parse(build());
    doc.pages[0].cards[0].icon = "rocket";
    expect(parseSnapshot(JSON.stringify(doc)).pages.get("shifra")?.cards[0]?.icon).toBe("arrow");
  });
});
