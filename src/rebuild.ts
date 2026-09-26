// grouplink.rebuild — read the profiles and their links from Notion, enrich them,
// render one page each, commit the pages that changed, deploy, and say so in Slack.
//
// Every `await ctx.run(...)` below is a separate durable run on its own instance,
// with that package's retry policy, tracked in the dashboard. The per-URL stages fan
// out through mapInBatches, so the run opens at most batch.ts's BATCH_SIZE at a time.
// Each numbered step below has a helper of the same name further down the file.
import { task, type TaskContext } from "@renderinc/sdk/workflows";
import type { PageDTO } from "@render-lab/tasks-notion";
import { extractPageMetadata } from "@render-lab/tasks-scrape";
import { get as kvGet, set as kvSet } from "@render-lab/tasks-render-kv";
import { request } from "@render-lab/tasks-http";
import { commitFiles, getFileContents, listTree } from "@render-lab/tasks-github";
import { triggerDeploy, awaitDeploy } from "@render-lab/tasks-render";
import { postMessage } from "@render-lab/tasks-slack";

import { mapInBatches } from "./batch.js";
import { assertWritable, loadConfig, type RebuildConfig, type RebuildInput } from "./config.js";
import { DEFAULT_ICON } from "./icons.js";
import {
  cardDescription,
  skippedRows,
  metaCacheKey,
  pagePathsFor,
  toCard,
  fetchableUrls,
  uniqueUrls,
  unknownIcons,
  type ProfilePage,
  type ProfileRow,
  type SkippedRow,
} from "./links.js";
import { readNotionSite } from "./read-notion.js";
import { renderPage, type PageModel } from "./render.js";

/** The subset of scrape.extractMetadata we cache and use. */
interface CachedMeta {
  description: string;
}

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
  /** Profiles rendered. The root page is a second copy, not another page. */
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
      // The webhook receiver only dispatches the run, so a failure would otherwise
      // show up nowhere but the dashboard.
      await reportFailure(ctx, error);
      throw error;
    }
  },
);

async function runRebuild(ctx: TaskContext, input: RebuildInput): Promise<RebuildResult> {
  const cfg = loadConfig(input);

  // 1) Parallel fan-out: read both databases.
  const { linkPages, profiles, pages } = await readNotionSite(ctx, cfg);

  const skipped = reportNotionProblems(linkPages, profiles);

  // A link on three pages is one URL to look up, scrape, and health-check. A
  // mailto: card renders from its Notion row alone, so it is a card URL but not
  // a web URL and skips steps 2 and 3.
  const cardUrls = uniqueUrls(pages.flatMap((page) => page.rows));
  const webUrls = fetchableUrls(cardUrls);

  // 2) Batched fan-out: read the cache, scrape the misses, write them back.
  const { metaByUrl, cacheHits } = await resolveMetadata(ctx, webUrls, cfg);

  // 3) Batched fan-out: health-check every link.
  const deadLinks = await findDeadLinks(ctx, webUrls);

  // 4) Render one file per profile, plus a second copy of the default profile's page
  //    at the site root.
  const files = renderFiles(pages, metaByUrl, cfg);

  const result: RebuildResult = {
    pageCount: pages.length,
    linkCount: cardUrls.length,
    cacheHits,
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

  // 5) Chained run, then a batched fan-out: compare each page against what the
  //    branch already holds, so a quiet day produces no commit and no deploy.
  const changed = await changedFiles(ctx, files, cfg);
  result.changedPaths = changed.map((file) => file.path);

  if (changed.length === 0) {
    // A quiet day is not worth a Slack message. A broken link is.
    if (deadLinks.length > 0) {
      await notify(ctx, "grouplink is unchanged, but some links are unreachable.", deadLinks);
    }
    return result;
  }

  // 6) Chained run: every changed page in one commit, so one deploy covers them all.
  const commit = await ctx.run(commitFiles, {
    owner: cfg.repoOwner,
    repo: cfg.repoName,
    branch: cfg.branch,
    message: `chore(site): rebuild ${changed.length} page(s) (${cardUrls.length} links)`,
    files: changed,
  });
  result.committed = true;
  result.commitSha = commit.commitSha;

  // 7) Chained runs: deploy the static site and wait for it to go live.
  const deploy = await ctx.run(triggerDeploy, {
    serviceId: cfg.staticSiteId,
    commitId: commit.commitSha,
  });
  result.deployId = deploy.deployId;
  await ctx.run(awaitDeploy, {
    serviceId: cfg.staticSiteId,
    deployId: deploy.deployId,
  });

  // 8) Chained run: post the outcome.
  await notify(
    ctx,
    `grouplink is live with ${cardUrls.length} links across ${pages.length} pages. ${cfg.siteUrl}`,
    deadLinks,
  );
  return result;
}

/**
 * Logs what you can see in Notion but the site does not show: a row that
 * reaches no page, and an Icon option no file matches. Both are otherwise silent.
 * Returns the skipped rows, which the run reports as part of its result.
 */
function reportNotionProblems(linkPages: PageDTO[], profiles: ProfileRow[]): SkippedRow[] {
  const skipped = skippedRows(linkPages, profiles);
  for (const row of skipped) {
    console.log(`skipped "${row.title}": ${row.reason}`);
  }
  for (const name of unknownIcons(linkPages)) {
    console.log(`unknown Icon "${name}", using ${DEFAULT_ICON}`);
  }
  return skipped;
}

/**
 * Each URL's metadata, from Key Value where it is cached and from the scrape
 * where it is not. Fresh scrapes are written back with a TTL.
 */
async function resolveMetadata(
  ctx: TaskContext,
  cardUrls: string[],
  cfg: RebuildConfig,
): Promise<{ metaByUrl: Map<string, CachedMeta>; cacheHits: number }> {
  const metaByUrl = new Map<string, CachedMeta>();
  const cached = await mapInBatches(cardUrls, (url) => ctx.run(kvGet, { key: metaCacheKey(url) }));
  cardUrls.forEach((url, i) => {
    const hit = readCached(cached[i]?.value);
    if (hit) metaByUrl.set(url, hit);
  });

  const missUrls = cardUrls.filter((url) => !metaByUrl.has(url));
  const scraped = await mapInBatches(missUrls, (url) => ctx.run(extractPageMetadata, { url }));
  const fresh = missUrls.map((url, i): [string, CachedMeta] => [
    url,
    { description: cardDescription(scraped[i] ?? {}) },
  ]);
  for (const [url, meta] of fresh) metaByUrl.set(url, meta);

  await mapInBatches(fresh, ([url, meta]) =>
    ctx.run(kvSet, {
      key: metaCacheKey(url),
      value: JSON.stringify(meta),
      ttlSeconds: cfg.cacheTtlSeconds,
    }),
  );

  return { metaByUrl, cacheHits: cardUrls.length - missUrls.length };
}

/**
 * Every URL that did not answer, with the status it gave. tasks-http has no HEAD
 * method, so this is a GET whose body we discard.
 */
async function findDeadLinks(ctx: TaskContext, cardUrls: string[]): Promise<string[]> {
  const checks = await mapInBatches(cardUrls, (url) =>
    ctx.run(request, { method: "GET" as const, url }),
  );
  return cardUrls
    .map((url, i) => ({ url, check: checks[i] }))
    .filter(({ check }) => unreachable(check))
    .map(({ url, check }) => `${url} (${check?.status ?? "no response"})`);
}

/** One file per profile, plus the default profile's page again at the site root. */
function renderFiles(
  pages: ProfilePage[],
  metaByUrl: Map<string, CachedMeta>,
  cfg: RebuildConfig,
): SiteFile[] {
  return pages.flatMap((page) => {
    const content = renderPage(toModel(page, metaByUrl));
    return pagePathsFor(cfg.siteDir, page.profile.slug, cfg.defaultSlug).map((path) => ({
      path,
      content,
    }));
  });
}

/**
 * The files whose content differs from the branch. listTree comes first because
 * getFileContents throws a 404 on a path that doesn't exist yet, and a new
 * profile's page never does.
 */
async function changedFiles(
  ctx: TaskContext,
  files: SiteFile[],
  cfg: RebuildConfig,
): Promise<SiteFile[]> {
  const repo = `${cfg.repoOwner}/${cfg.repoName}`;
  const tree = await ctx.run(listTree, { repo, ref: cfg.branch });
  const onBranch = new Set(tree.paths);
  const existing = files.filter((file) => onBranch.has(file.path));
  const currents = await mapInBatches(existing, (file) =>
    ctx.run(getFileContents, { repo, path: file.path, ref: cfg.branch }),
  );
  const currentByPath = new Map(existing.map((file, i) => [file.path, currents[i]?.content ?? ""]));

  return files.filter((file) => currentByPath.get(file.path) !== file.content);
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

function toModel(page: ProfilePage, metaByUrl: Map<string, CachedMeta>): PageModel {
  return {
    name: page.profile.name,
    tagline: page.profile.tagline,
    cards: page.rows.map((row) => toCard(row, metaByUrl.get(row.url)?.description ?? "")),
  };
}

async function notify(ctx: TaskContext, text: string, deadLinks: string[]): Promise<void> {
  const body = deadLinks.length > 0 ? `${text}\nUnreachable: ${deadLinks.join(", ")}` : text;
  await ctx.run(postMessage, { text: body });
}
