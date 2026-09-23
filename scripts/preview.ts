// Renders every profile's page from the real Notion databases and writes them into
// site/, so a local static server can serve the same HTML the workflow commits.
// Run with `pnpm preview`.
//
// This is the read half of grouplink.rebuild: Notion and the scrape, no Key Value,
// no GitHub, no deploy. It overwrites the tracked files under site/ — `git checkout
// -- site && git clean -fd site` puts them back.
import { localCtx } from "@render-lab/test-utils";
import { queryDatabase } from "@render-lab/tasks-notion";
import { extractPageMetadata } from "@render-lab/tasks-scrape";
import { mapInBatches } from "../src/batch.js";
import { loadConfig } from "../src/config.js";
import {
  assertDefaultSlug,
  cardDescription,
  groupByProfile,
  toCard,
  toLinkRows,
  toProfileRows,
  uniqueUrls,
  visibleRows,
} from "../src/links.js";
import { writePages } from "./write-pages.js";

const ctx = localCtx();
const cfg = loadConfig({ dryRun: true });

const [linkPages, profilePages] = await Promise.all([
  ctx.run(queryDatabase, { databaseId: cfg.databaseId, limit: cfg.limit }),
  ctx.run(queryDatabase, { databaseId: cfg.profilesDatabaseId, limit: cfg.limit }),
]);

const profiles = toProfileRows(profilePages);
assertDefaultSlug(profiles, cfg.defaultSlug);

const pages = groupByProfile(visibleRows(toLinkRows(linkPages)), profiles);
const cardUrls = uniqueUrls(pages.flatMap((page) => page.rows));

const scraped = await mapInBatches(cardUrls, (url) => ctx.run(extractPageMetadata, { url }));
const descriptions = new Map(cardUrls.map((url, i) => [url, cardDescription(scraped[i] ?? {})]));

for (const page of pages) {
  writePages(
    {
      name: page.profile.name,
      tagline: page.profile.tagline,
      cards: page.rows.map((row) => toCard(row, descriptions.get(row.url) ?? "")),
    },
    { siteDir: cfg.siteDir, slug: page.profile.slug, defaultSlug: cfg.defaultSlug },
  );
}
