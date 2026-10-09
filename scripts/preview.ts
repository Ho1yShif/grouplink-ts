// Build the snapshot from the real Notion databases and write it to a local Redis,
// so a local web service serves the same pages as production. Run with
// `pnpm preview`. This is the read half of grouplink.rebuild: Notion and the
// scrape, with no metadata cache and no health check.
import { localCtx } from "@render-lab/test-utils";
import { extractPageMetadata } from "@render-lab/tasks-scrape";
import { mapInBatches } from "../src/batch.js";
import { loadConfig } from "../src/config.js";
import { cardDescription, fetchableUrls, toPageModel, uniqueUrls } from "../src/links.js";
import { readNotionSite } from "../src/read-notion.js";
import { writeSnapshot } from "./local-site.js";

const ctx = localCtx();
const cfg = loadConfig({ dryRun: true });

const { pages } = await readNotionSite(ctx, cfg);
// Only the http(s) cards are scraped. A mailto: card has no page, and fetch
// refuses the URL, which is what grouplink.rebuild does too.
const cardUrls = fetchableUrls(uniqueUrls(pages.flatMap((page) => page.rows)));

const scraped = await mapInBatches(cardUrls, (url) => ctx.run(extractPageMetadata, { url }));
const descriptions = new Map(cardUrls.map((url, i) => [url, cardDescription(scraped[i] ?? {})]));

await writeSnapshot(
  new Map(
    pages.map((page) => [
      page.profile.slug,
      toPageModel(page, (url) => descriptions.get(url) ?? ""),
    ]),
  ),
  cfg.defaultSlug,
);
