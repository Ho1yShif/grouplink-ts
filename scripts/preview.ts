// Renders every profile's page from the real Notion databases and writes them into
// site/, so a local static server can serve the same HTML the workflow commits.
// Run with `pnpm preview`.
//
// This is the read half of grouplink.rebuild: Notion and the scrape, no Key Value,
// no GitHub, no deploy. It overwrites the tracked files under site/ — `git checkout
// -- site && git clean -fd site` puts them back.
import { localCtx } from "@render-lab/test-utils";
import { extractPageMetadata } from "@render-lab/tasks-scrape";
import { mapInBatches } from "../src/batch.js";
import { loadConfig } from "../src/config.js";
import { cardDescription, toCard, uniqueUrls } from "../src/links.js";
import { readNotionSite } from "../src/read-notion.js";
import { writePages } from "./write-pages.js";

const ctx = localCtx();
const cfg = loadConfig({ dryRun: true });

const { pages } = await readNotionSite(ctx, cfg);
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
