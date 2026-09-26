// The golden pages. These three files are byte-for-byte copies of the pages this
// build renders from the seed links in scripts/placeholder.ts, and grouplink-py
// keeps the same three under tests/golden/. They guard the four places the two
// ports can drift: the HTML escaping, the URL normalization, the CSP hashes, and
// the whitespace.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { toCard } from "../src/links.js";
import { renderPage } from "../src/render.js";
import { PROFILES, TAGLINE } from "../scripts/placeholder.js";

const GOLDEN = join(import.meta.dirname, "golden");

// The footer year the golden pages were rendered with. Pinned, so the fixtures do
// not go stale on 1 January.
const GOLDEN_YEAR = 2026;

// The fixture each seed profile's page is committed as. The default profile is
// written twice, so index.html and shifra.html hold the same bytes.
const GOLDEN_FIXTURES: Record<string, string[]> = {
  shifra: ["index.html", "shifra.html"],
  graham: ["graham.html"],
};

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${GOLDEN_YEAR}-06-15T00:00:00Z`));
});

afterAll(() => {
  vi.useRealTimers();
});

const cases = PROFILES.flatMap((profile) =>
  (GOLDEN_FIXTURES[profile.slug] ?? []).map((fixture) => [profile.slug, fixture] as const),
);

it.each(cases)("reproduces %s as %s byte for byte", (slug, fixture) => {
  const profile = PROFILES.find((p) => p.slug === slug);
  if (!profile) throw new Error(`no seed profile ${slug}`);

  const html = renderPage({
    name: profile.name,
    tagline: TAGLINE,
    cards: profile.links.map((link) => toCard(link, link.description)),
  });

  expect(html).toBe(readFileSync(join(GOLDEN, fixture), "utf8"));
});
