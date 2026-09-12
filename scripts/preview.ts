// Renders every person's page from the real Notion databases and writes them into
// site/, so a local static server can serve the same HTML the workflow commits.
// Run with `pnpm preview`.
//
// This is the read half of grouplink.rebuild: Notion and the scrape, no Key Value,
// no GitHub, no deploy. It overwrites the tracked files under site/ — `git checkout
// -- site && git clean -fd site` puts them back.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localCtx } from "@render-lab/test-utils";
import { queryDatabase } from "@render-lab/tasks-notion";
import { extractPageMetadata } from "@render-lab/tasks-scrape";
import { loadConfig } from "../src/config.js";
import {
  cardDescription,
  faviconUrl,
  groupByPerson,
  pagePath,
  toLinkRows,
  toPersonRows,
  uniqueUrls,
  visibleRows,
} from "../src/links.js";
import { renderPage, type LinkCard, type SocialLink } from "../src/render.js";

const BATCH_SIZE = 10;

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const ctx = localCtx();
const cfg = loadConfig({ dryRun: true });

const [linkPages, peoplePages] = await Promise.all([
  ctx.run(queryDatabase, { databaseId: cfg.databaseId, limit: cfg.limit }),
  ctx.run(queryDatabase, { databaseId: cfg.peopleDatabaseId, limit: cfg.limit }),
]);

const people = toPersonRows(peoplePages);
if (!people.some((person) => person.slug === cfg.defaultSlug)) {
  throw new Error(
    `SITE_DEFAULT_SLUG is "${cfg.defaultSlug}", which matches no Slug in People`,
  );
}

const pages = groupByPerson(visibleRows(toLinkRows(linkPages)), people);
const rows = pages.flatMap((page) => page.rows);
const cardUrls = uniqueUrls(rows.filter((row) => row.kind === "link"));

const descriptions = new Map<string, string>();
for (let start = 0; start < cardUrls.length; start += BATCH_SIZE) {
  const batch = cardUrls.slice(start, start + BATCH_SIZE);
  const scraped = await Promise.all(
    batch.map((url) => ctx.run(extractPageMetadata, { url })),
  );
  batch.forEach((url, i) => descriptions.set(url, cardDescription(scraped[i] ?? {})));
}

// The same socials on every page, taken from the root person's rows.
const socials: SocialLink[] = (
  pages.find((page) => page.person.slug === cfg.defaultSlug)?.rows ?? []
)
  .filter((row) => row.kind === "social")
  .map((row) => ({ label: row.title, url: row.url }));

for (const page of pages) {
  const html = renderPage({
    name: page.person.name,
    tagline: page.person.tagline,
    cards: page.rows
      .filter((row) => row.kind === "link")
      .map((row): LinkCard => ({
        title: row.title,
        url: row.url,
        description: descriptions.get(row.url) ?? "",
        iconUrl: faviconUrl(row.url),
      })),
    socials,
  });

  const paths = [pagePath(cfg.siteDir, page.person.slug)];
  if (page.person.slug === cfg.defaultSlug) paths.push(pagePath(cfg.siteDir, ""));
  for (const path of paths) {
    const out = resolve(repoRoot, path);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, html);
    console.log(`wrote ${path}`);
  }
}
