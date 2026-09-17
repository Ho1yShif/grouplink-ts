// grouplink.rebuild — read the people and their links from Notion, enrich them,
// render one page each, commit the pages that changed, deploy, and say so in Slack.
//
// Every `await ctx.run(...)` below is a separate durable run on its own instance,
// with that package's retry policy, tracked in the dashboard. The per-URL stages fan
// out through mapInBatches, so the run opens at most BATCH_SIZE of them at a time.
import { task, type TaskContext } from "@renderinc/sdk/workflows";
import { queryDatabase } from "@render-lab/tasks-notion";
import { extractPageMetadata } from "@render-lab/tasks-scrape";
import { get as kvGet, set as kvSet } from "@render-lab/tasks-render-kv";
import { request } from "@render-lab/tasks-http";
import { commitFiles, getFileContents, listTree } from "@render-lab/tasks-github";
import { triggerDeploy, awaitDeploy } from "@render-lab/tasks-render";
import { postMessage } from "@render-lab/tasks-slack";

import { assertWritable, loadConfig, type RebuildConfig, type RebuildInput } from "./config.js";
import {
  cardDescription,
  faviconUrl,
  groupByPerson,
  skippedRows,
  metaCacheKey,
  pagePath,
  toLinkRows,
  toPersonRows,
  uniqueUrls,
  visibleRows,
  type LinkRow,
  type PersonPage,
  type SkippedRow,
} from "./links.js";
import { renderPage, type LinkCard, type PageModel } from "./render.js";

/** The subset of scrape.extractMetadata we cache and use. */
interface CachedMeta {
  description: string;
}

const EMPTY_META: CachedMeta = { description: "" };

/**
 * Fan-out width for the per-URL stages. Without it a 100-row database opens 100
 * concurrent runs per stage and hits every linked site at once.
 */
const BATCH_SIZE = 10;

/**
 * Statuses that mean the URL resolved but refused an unadorned GET. X answers 403 and
 * LinkedIn answers 999 for a request with no browser fingerprint, so neither is dead.
 */
const REFUSED_STATUSES = new Set([401, 403, 405, 429, 999]);

interface SiteFile {
  path: string;
  content: string;
}

export interface RebuildResult {
  /** People rendered. The root page is a second copy, not another page. */
  pageCount: number;
  /** Distinct card URLs across every page. */
  linkCount: number;
  cacheHits: number;
  /** Link rows read from Notion that render on no page, and why. */
  skipped: SkippedRow[];
  deadLinks: string[];
  committed: boolean;
  /** Paths in the commit. Empty when nothing changed. */
  changedPaths: string[];
  commitSha: string | null;
  deployId: string | null;
  siteUrl: string;
  dryRun: boolean;
}

export const rebuild = task(
  { name: "grouplink.rebuild" },
  async function rebuild(ctx: TaskContext, input: RebuildInput = {}): Promise<RebuildResult> {
    try {
      return await runRebuild(ctx, input);
    } catch (error) {
      // The cron job only dispatches the run, so a failure would otherwise show up
      // nowhere but the dashboard.
      await reportFailure(ctx, error);
      throw error;
    }
  },
);

async function runRebuild(ctx: TaskContext, input: RebuildInput): Promise<RebuildResult> {
  const cfg = loadConfig(input);

  // 1) Parallel fan-out: read both databases. A link's `People` relation holds the
  //    Notion page ids of its People rows, which is how the two join.
  const [linkPages, peoplePages] = await Promise.all([
    ctx.run(queryDatabase, { databaseId: cfg.databaseId, limit: cfg.limit }),
    ctx.run(queryDatabase, { databaseId: cfg.peopleDatabaseId, limit: cfg.limit }),
  ]);

  const people = toPersonRows(peoplePages);
  if (!people.some((person) => person.slug === cfg.defaultSlug)) {
    throw new Error(
      `SITE_DEFAULT_SLUG is "${cfg.defaultSlug}", which matches no Slug in the People database`,
    );
  }
  const pages = groupByPerson(visibleRows(toLinkRows(linkPages)), people);

  // A row you added in Notion that never reaches a page is otherwise invisible.
  const skipped = skippedRows(linkPages, people);
  for (const row of skipped) {
    console.log(`skipped "${row.title}": ${row.reason}`);
  }

  // A link on three pages is one URL to look up, scrape, and health-check.
  const rows = pages.flatMap((page) => page.rows);
  const cardUrls = uniqueUrls(rows);

  // 2) Batched fan-out: look for each card's metadata in Key Value first.
  const metaByUrl = new Map<string, CachedMeta>();
  const cached = await mapInBatches(cardUrls, (url) =>
    ctx.run(kvGet, { key: metaCacheKey(url) }),
  );
  cardUrls.forEach((url, i) => {
    const hit = readCached(cached[i]?.value);
    if (hit) metaByUrl.set(url, hit);
  });

  // 3) Batched fan-out: scrape only the misses.
  const missUrls = cardUrls.filter((url) => !metaByUrl.has(url));
  const scraped = await mapInBatches(missUrls, (url) =>
    ctx.run(extractPageMetadata, { url }),
  );
  const scrapedMeta = missUrls.map(
    (_url, i): CachedMeta => ({ description: cardDescription(scraped[i] ?? {}) }),
  );
  missUrls.forEach((url, i) => metaByUrl.set(url, scrapedMeta[i] ?? EMPTY_META));

  // 4) Batched fan-out: write the fresh metadata back with a TTL.
  await mapInBatches(missUrls, (url, i) =>
    ctx.run(kvSet, {
      key: metaCacheKey(url),
      value: JSON.stringify(scrapedMeta[i] ?? EMPTY_META),
      ttlSeconds: cfg.cacheTtlSeconds,
    }),
  );

  // 5) Batched fan-out: health-check every link. tasks-http has no HEAD method,
  //    so this is a GET whose body we discard.
  const checks = await mapInBatches(cardUrls, (url) =>
    ctx.run(request, { method: "GET" as const, url }),
  );
  const deadLinks = cardUrls
    .map((url, i) => ({ url, check: checks[i] }))
    .filter(({ check }) => unreachable(check))
    .map(({ url, check }) => `${url} (${check?.status ?? "no response"})`);

  // 6) Render one file per person, plus a second copy of the default person's page
  //    at the site root, so `/` and `/<default slug>` serve the same thing.
  const files: SiteFile[] = [];
  for (const page of pages) {
    const content = renderPage(toModel(page, metaByUrl));
    files.push({ path: pagePath(cfg.siteDir, page.person.slug), content });
    if (page.person.slug === cfg.defaultSlug) {
      files.push({ path: pagePath(cfg.siteDir, ""), content });
    }
  }

  const result: RebuildResult = {
    pageCount: pages.length,
    linkCount: cardUrls.length,
    cacheHits: cardUrls.length - missUrls.length,
    skipped,
    deadLinks,
    committed: false,
    changedPaths: [],
    commitSha: null,
    deployId: null,
    siteUrl: cfg.siteUrl,
    dryRun: cfg.dryRun,
  };

  // Dry-run lives here in the caller, not in the packs.
  if (cfg.dryRun) return result;
  assertWritable(cfg);

  // 7) Chained run, then a batched fan-out: compare each page against what the branch
  //    already holds, so a quiet day produces no commit and no deploy. listTree
  //    comes first because getFileContents throws a 404 on a path that doesn't
  //    exist yet, and a new person's page never does.
  const repo = `${cfg.repoOwner}/${cfg.repoName}`;
  const tree = await ctx.run(listTree, { repo, ref: cfg.branch });
  const onBranch = new Set(tree.paths);
  const existing = files.filter((file) => onBranch.has(file.path));
  const currents = await mapInBatches(existing, (file) =>
    ctx.run(getFileContents, { repo, path: file.path, ref: cfg.branch }),
  );
  const currentByPath = new Map(existing.map((file, i) => [file.path, currents[i]?.content ?? ""]));

  const changed = files.filter((file) => {
    const current = currentByPath.get(file.path);
    return current === undefined || current !== file.content;
  });
  result.changedPaths = changed.map((file) => file.path);

  if (changed.length === 0) {
    // A quiet day is not worth a Slack message. A broken link is.
    if (deadLinks.length > 0) {
      await notify(ctx, "grouplink is unchanged, but some links are unreachable.", deadLinks);
    }
    return result;
  }

  // 8) Chained run: every changed page in one commit, so one deploy covers them all.
  const commit = await ctx.run(commitFiles, {
    owner: cfg.repoOwner,
    repo: cfg.repoName,
    branch: cfg.branch,
    message: `chore(site): rebuild ${changed.length} page(s) (${cardUrls.length} links)`,
    files: changed,
  });
  result.committed = true;
  result.commitSha = commit.commitSha;

  // 9) Chained runs: deploy the static site and wait for it to go live.
  const deploy = await ctx.run(triggerDeploy, {
    serviceId: cfg.staticSiteId,
    commitId: commit.commitSha,
  });
  result.deployId = deploy.deployId;
  await ctx.run(awaitDeploy, {
    serviceId: cfg.staticSiteId,
    deployId: deploy.deployId,
  });

  // 10) Chained run: post the outcome.
  await notify(
    ctx,
    `grouplink is live with ${cardUrls.length} links across ${pages.length} pages. ${cfg.siteUrl}`,
    deadLinks,
  );
  return result;
}

/** Never masks the error it is reporting: a failed Slack post is logged and dropped. */
async function reportFailure(ctx: TaskContext, error: unknown): Promise<void> {
  const text = error instanceof Error ? error.message : String(error);
  try {
    await notify(ctx, `grouplink.rebuild failed: ${text}`, []);
  } catch (postError) {
    console.error("could not post the failure to Slack", postError);
  }
}

/** Promise.all in fixed-size batches, in input order. */
async function mapInBatches<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    const batch = items.slice(start, start + BATCH_SIZE);
    results.push(...(await Promise.all(batch.map((item, i) => fn(item, start + i)))));
  }
  return results;
}

function unreachable(check: { ok: boolean; status: number } | undefined): boolean {
  if (!check) return true;
  return !check.ok && !REFUSED_STATUSES.has(check.status);
}

function readCached(value: string | null | undefined): CachedMeta | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && "description" in parsed) {
      return { description: String(parsed.description ?? "") };
    }
  } catch {
    // A malformed cache entry is a miss, not a failure.
  }
  return null;
}

function toModel(page: PersonPage, metaByUrl: Map<string, CachedMeta>): PageModel {
  return {
    name: page.person.name,
    tagline: page.person.tagline,
    cards: page.rows.map((row): LinkCard => toCard(row, metaByUrl.get(row.url))),
  };
}

function toCard(row: LinkRow, meta: CachedMeta | undefined): LinkCard {
  return {
    title: row.title,
    url: row.url,
    description: meta?.description ?? "",
    iconUrl: faviconUrl(row.url),
  };
}

async function notify(ctx: TaskContext, text: string, deadLinks: string[]): Promise<void> {
  const body = deadLinks.length > 0 ? `${text}\nUnreachable: ${deadLinks.join(", ")}` : text;
  await ctx.run(postMessage, { text: body });
}
