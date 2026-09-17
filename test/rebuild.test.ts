// Tier 1: composition test. Drives the real grouplink.rebuild task, routing every
// chained ctx.run to the owning package's *Impl with a fake injected at the vendor
// port. No network, no secrets — but the pack code, the DTO mapping, and the
// composition in src/rebuild.ts are all real.
import { describe, expect, it, vi } from "vitest";
import type { TaskContext } from "@renderinc/sdk/workflows";

import { queryDatabaseImpl } from "@render-lab/tasks-notion";
import { extractPageMetadataImpl } from "@render-lab/tasks-scrape";
import { getImpl as kvGetImpl, setImpl as kvSetImpl } from "@render-lab/tasks-render-kv";
import { requestImpl } from "@render-lab/tasks-http";
import { commitFilesImpl, getFileContentsImpl, listTreeImpl } from "@render-lab/tasks-github";
import { triggerDeployImpl, awaitDeployImpl } from "@render-lab/tasks-render";
import { postMessageImpl } from "@render-lab/tasks-slack";

import { rebuild } from "../src/rebuild.js";

const ENV = {
  NOTION_LINKS_DATABASE_ID: "db_links",
  NOTION_PEOPLE_DATABASE_ID: "db_people",
  SITE_DEFAULT_SLUG: "shifra",
  GITHUB_REPO_OWNER: "acme",
  GITHUB_REPO_NAME: "grouplink",
  RENDER_STATIC_SITE_ID: "srv-1",
  SITE_URL: "https://grouplink.onrender.com",
};

function withEnv<T>(extra: Record<string, string>, fn: () => T): T {
  const saved = { ...process.env };
  Object.assign(process.env, ENV, extra);
  try {
    return fn();
  } finally {
    process.env = saved;
  }
}

const titleProp = (text: string) => ({ type: "title", title: [{ plain_text: text }] });

const SHIFRA = "person-shifra";
const ALEX = "person-alex";

/** Everything about a link row that most cases leave at its default. */
interface RawPageOptions {
  visible?: boolean;
  /** Notion page ids of the People rows the link relates to. */
  people?: string[];
  everyone?: boolean;
  /** The Icon select option. null is an empty cell. */
  icon?: string | null;
}

function rawPage(
  title: string,
  url: string,
  /** Only makes the Notion page id unique. */
  n: number,
  {
    visible = true,
    people = [SHIFRA],
    everyone = false,
    icon = null,
  }: RawPageOptions = {},
) {
  return {
    id: `p-${n}`,
    url: `https://www.notion.so/p-${n}`,
    created_time: "2026-01-01T00:00:00.000Z",
    last_edited_time: "2026-01-01T00:00:00.000Z",
    properties: {
      Title: titleProp(title),
      URL: { type: "url", url },
      Visible: { type: "checkbox", checkbox: visible },
      Everyone: { type: "checkbox", checkbox: everyone },
      People: { type: "relation", relation: people.map((id) => ({ id })) },
      Icon: { type: "select", select: icon === null ? null : { name: icon } },
    },
  };
}

function rawPerson(id: string, name: string, slug: string, tagline: string) {
  return {
    id,
    url: `https://www.notion.so/${id}`,
    created_time: "2026-01-01T00:00:00.000Z",
    last_edited_time: "2026-01-01T00:00:00.000Z",
    properties: {
      Name: titleProp(name),
      Slug: { type: "rich_text", rich_text: [{ plain_text: slug }] },
      Tagline: { type: "rich_text", rich_text: [{ plain_text: tagline }] },
    },
  };
}

const LINK_PAGES = [
  // Shared by both people, so it must be scraped and checked exactly once.
  rawPage("Discord", "https://discord.com/invite/x", 1, { people: [SHIFRA, ALEX] }),
  rawPage("Startups", "https://render.com/startups", 2),
  rawPage("Hidden", "https://render.com/secret", 3, { visible: false }),
  rawPage("Alex only", "https://example.com/alex", 4, { people: [ALEX] }),
];

const PEOPLE_PAGES = [
  rawPerson(SHIFRA, "Shifra Williams", "shifra", "Developer relations at Render."),
  rawPerson(ALEX, "Alex Rivera", "alex", "Engineer at Render."),
];

interface Fakes {
  /** URL -> cached JSON, for kv.get. */
  cache?: Record<string, string>;
  /** URL -> status, for http.request. Defaults to 200. */
  statuses?: Record<string, number>;
  /** Path -> contents already on the branch. Its keys are the default tree. */
  current?: Record<string, string>;
  /** Paths github.listTree reports, when they differ from `current`'s keys. */
  onBranch?: string[];
  /** Raw link rows, when a case needs more or fewer than LINK_PAGES. */
  links?: ReturnType<typeof rawPage>[];
}

function harness(fakes: Fakes = {}) {
  let inFlight = 0;
  let peakInFlight = 0;
  const scrapeFetch = vi.fn(async (url: string) => {
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    await Promise.resolve();
    inFlight -= 1;
    return {
      url,
      status: 200,
      ok: true,
      contentType: "text/html",
      body: `<html><head><title>T</title><meta name="description" content="desc for ${url}"></head></html>`,
    };
  });
  const kvSet = vi.fn(async (_k: string, _v: string, _ttl?: number) => {});
  const createBlob = vi.fn(async () => ({ sha: "blob1" }));
  const createTree = vi.fn(async () => ({ sha: "tree1" }));
  const createCommit = vi.fn(async () => ({ sha: "commit1" }));
  const updateRef = vi.fn(async () => {});
  const slackPost = vi.fn(async () => ({ ok: true as const }));
  const triggerDeployPort = vi.fn(async () => ({
    id: "dep-1",
    serviceId: "srv-1",
    status: "created",
    commitId: "commit1",
    createdAt: "",
    finishedAt: null,
  }));

  const kv = {
    get: async (key: string) => fakes.cache?.[key.replace("gl:meta:v1:", "")] ?? null,
    set: kvSet,
  };

  const routes: Record<string, (args: unknown) => Promise<unknown>> = {
    "notion.queryDatabase": (a) => {
      const { databaseId } = a as { databaseId: string };
      const rows = databaseId === "db_people" ? PEOPLE_PAGES : (fakes.links ?? LINK_PAGES);
      return queryDatabaseImpl(ctx, a as never, {
        notion: { queryDatabase: async () => rows } as never,
      });
    },
    "scrape.extractMetadata": (a) =>
      extractPageMetadataImpl(ctx, a as never, { scrape: { fetch: scrapeFetch } as never }),
    "kv.get": (a) => kvGetImpl(ctx, a as never, { kv } as never),
    "kv.set": (a) => kvSetImpl(ctx, a as never, { kv } as never),
    "http.request": (a) => {
      const url = (a as { url: string }).url;
      const status = fakes.statuses?.[url] ?? 200;
      return requestImpl(ctx, a as never, {
        http: {
          fetch: async () => ({
            status,
            ok: status < 400,
            headers: new Map<string, string>() as never,
            text: async () => "",
          }),
        } as never,
      });
    },
    "github.listTree": (a) =>
      listTreeImpl(ctx, a as never, {
        github: {
          listTree: async () => ({
            paths: fakes.onBranch ?? Object.keys(fakes.current ?? {}),
            truncated: false,
          }),
        } as never,
      }),
    "github.getFileContents": (a) => {
      const path = (a as { path: string }).path;
      return getFileContentsImpl(ctx, a as never, {
        github: {
          getFileContents: async () => ({
            path,
            content: fakes.current?.[path] ?? "<html>stale</html>",
            sha: "sha1",
            encoding: "utf-8",
          }),
        } as never,
      });
    },
    "github.commitFiles": (a) =>
      commitFilesImpl(ctx, a as never, {
        github: {
          getRef: async () => ({ sha: "head1", treeSha: "tree0" }),
          createBlob,
          createTree,
          createCommit,
          updateRef,
        } as never,
      }),
    "render.triggerDeploy": (a) =>
      triggerDeployImpl(ctx, a as never, { render: { triggerDeploy: triggerDeployPort } as never }),
    "render.awaitDeploy": (a) =>
      awaitDeployImpl(ctx, a as never, {
        render: {
          getDeploy: async () => ({
            id: "dep-1",
            serviceId: "srv-1",
            status: "live",
            commitId: "commit1",
            createdAt: "",
            finishedAt: "",
          }),
        } as never,
      }),
    "slack.postMessage": (a) =>
      postMessageImpl(ctx, a as never, { slack: { post: slackPost } as never }),
  };

  const ctx: TaskContext = {
    run: async (taskDef: { name?: string }, ...args: unknown[]) => {
      const route = routes[taskDef?.name ?? ""];
      if (!route) throw new Error(`no fake for ctx.run("${taskDef?.name}")`);
      return route(args[0]);
    },
  } as TaskContext;

  /** Path -> HTML handed to github.commitFiles on the last run. */
  const committed = (): Record<string, string> => {
    const { tree = [] } = (createTree.mock.calls[0]?.[2] ?? {}) as {
      tree?: Array<{ path: string }>;
    };
    const blobs = createBlob.mock.calls.map(
      (call) => (call[2] as { content: string }).content,
    );
    return Object.fromEntries(tree.map((entry, i) => [entry.path, blobs[i] ?? ""]));
  };

  /** The root page's HTML. */
  const committedHtml = (): string => committed()["site/index.html"] ?? "";

  return {
    ctx,
    scrapeFetch,
    peak: () => peakInFlight,
    kvSet,
    createBlob,
    createTree,
    createCommit,
    slackPost,
    triggerDeployPort,
    committed,
    committedHtml,
  };
}

describe("grouplink.rebuild", () => {
  it("renders every visible link in Notion order, and no hidden one", async () => {
    const h = harness();
    const result = await withEnv({ DRY_RUN: "false" }, () => rebuild.func(h.ctx, {}));

    expect(result.pageCount).toBe(2);
    expect(result.linkCount).toBe(3);

    const html = h.committedHtml();
    expect(html.indexOf("Discord")).toBeLessThan(html.indexOf("Startups"));
    expect(html).not.toContain("Hidden");
    expect(html).not.toContain("render.com/secret");
  });

  it("renders the icon the Notion row names, and arrow for the rest", async () => {
    const h = harness({
      links: [
        rawPage("Workflows", "https://render.com/workflows", 1, { icon: "workflows" }),
        rawPage("Docs", "https://render.com/docs", 2),
      ],
    });
    const result = await withEnv({ DRY_RUN: "false" }, () => rebuild.func(h.ctx, {}));

    expect(result.committed).toBe(true);
    const html = h.committedHtml();
    // The bare class name is in the stylesheet on every page, so match the span.
    expect(html).toContain('class="card__mark card__mark--workflows"');
    expect(html).toContain('class="card__mark card__mark--arrow"');
  });

  it("puts a person's links in their own file and nobody else's", async () => {
    const h = harness();
    await withEnv({ DRY_RUN: "false" }, () => rebuild.func(h.ctx, {}));
    const files = h.committed();

    expect(files["site/shifra/index.html"]).toContain("Startups");
    expect(files["site/shifra/index.html"]).not.toContain("Alex only");
    expect(files["site/alex/index.html"]).toContain("Alex only");
    expect(files["site/alex/index.html"]).not.toContain("Startups");
    // The shared link is on both.
    expect(files["site/shifra/index.html"]).toContain("Discord");
    expect(files["site/alex/index.html"]).toContain("Discord");
  });

  it("puts an Everyone link on every page, related to nobody", async () => {
    const h = harness({
      links: [
        ...LINK_PAGES,
        rawPage("Careers", "https://render.com/careers", 5, { people: [], everyone: true }),
      ],
    });
    await withEnv({ DRY_RUN: "false" }, () => rebuild.func(h.ctx, {}));
    const files = h.committed();

    expect(files["site/shifra/index.html"]).toContain("Careers");
    expect(files["site/alex/index.html"]).toContain("Careers");
  });

  it("scrapes an Everyone link once, not once per page", async () => {
    const h = harness({
      links: [
        ...LINK_PAGES,
        rawPage("Careers", "https://render.com/careers", 5, { people: [], everyone: true }),
      ],
    });
    await withEnv({ DRY_RUN: "false" }, () => rebuild.func(h.ctx, {}));

    const careers = h.scrapeFetch.mock.calls.filter(
      ([url]) => url === "https://render.com/careers",
    );
    expect(careers).toHaveLength(1);
  });

  it("gives each page its own name and tagline from the People database", async () => {
    const h = harness();
    await withEnv({ DRY_RUN: "false" }, () => rebuild.func(h.ctx, {}));
    const files = h.committed();

    expect(files["site/shifra/index.html"]).toContain("Developer relations at Render.");
    expect(files["site/alex/index.html"]).toContain("Alex Rivera");
    expect(files["site/alex/index.html"]).not.toContain("Shifra Williams");
  });

  it("reports why a row renders on no page", async () => {
    const h = harness({
      links: [
        ...LINK_PAGES,
        rawPage("Orphan", "https://example.com/orphan", 20, { people: [] }),
        rawPage("No URL", "", 21),
      ],
    });
    const result = await withEnv({ DRY_RUN: "false" }, () => rebuild.func(h.ctx, {}));

    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Hidden", reason: "Visible is unchecked" }),
        expect.objectContaining({
          title: "Orphan",
          reason: "no People relation and Everyone is unchecked",
        }),
        expect.objectContaining({ title: "No URL", reason: "no URL" }),
      ]),
    );
  });

  it("serves the default person at the root, byte for byte", async () => {
    const h = harness();
    await withEnv({ DRY_RUN: "false" }, () => rebuild.func(h.ctx, {}));
    const files = h.committed();

    expect(files["site/index.html"]).toBe(files["site/shifra/index.html"]);
  });

  it("refuses to run when SITE_DEFAULT_SLUG matches nobody", async () => {
    const h = harness();
    await expect(
      withEnv({ DRY_RUN: "false", SITE_DEFAULT_SLUG: "nobody" }, () =>
        rebuild.func(h.ctx, {}),
      ),
    ).rejects.toThrow(/matches no Slug/);
  });

  it("checks and scrapes a shared link once, not once per page", async () => {
    const h = harness();
    await withEnv({ DRY_RUN: "false" }, () => rebuild.func(h.ctx, {}));

    const scraped = h.scrapeFetch.mock.calls.map((call) => call[0]);
    expect(scraped.filter((url) => url === "https://discord.com/invite/x")).toHaveLength(1);
    expect(scraped).toHaveLength(3);
  });

  it("references assets from the site root so they resolve under /<slug>/", async () => {
    const h = harness();
    await withEnv({ DRY_RUN: "false" }, () => rebuild.func(h.ctx, {}));

    const html = h.committed()["site/alex/index.html"] ?? "";
    expect(html).toContain('href="/assets/render-logomark-black.svg"');
    expect(html).toContain("url('/assets/render-logo-white.png')");
    expect(html).toContain("url('/assets/icons/github.svg')");
    expect(html).toContain("url('/assets/fonts/RoobertVF.woff2')");
    expect(html).not.toMatch(/["'(]assets\//);
  });

  it("carries the scraped description onto the card", async () => {
    const h = harness();
    await withEnv({ DRY_RUN: "false" }, () => rebuild.func(h.ctx, {}));
    expect(h.committedHtml()).toContain("desc for https://discord.com/invite/x");
  });

  it("links to the Notion URL untouched, with no tracking parameters", async () => {
    const h = harness();
    await withEnv({ DRY_RUN: "false" }, () => rebuild.func(h.ctx, {}));
    const html = h.committedHtml();
    expect(html).toContain('href="https://render.com/startups"');
    expect(html).toContain('href="https://discord.com/invite/x"');
    expect(html).not.toContain("utm_");
  });

  it("skips the scrape for a URL already in Key Value", async () => {
    const h = harness({
      cache: { "https://discord.com/invite/x": JSON.stringify({ description: "cached blurb" }) },
    });
    const result = await withEnv({ DRY_RUN: "false" }, () => rebuild.func(h.ctx, {}));

    expect(result.cacheHits).toBe(1);
    expect(h.scrapeFetch).toHaveBeenCalledTimes(2);
    expect(h.committedHtml()).toContain("cached blurb");
  });

  it("caches every fresh scrape with a TTL", async () => {
    const h = harness();
    await withEnv({ DRY_RUN: "false" }, () => rebuild.func(h.ctx, {}));
    expect(h.kvSet).toHaveBeenCalledTimes(3);
    expect(h.kvSet.mock.calls[0]?.[2]).toBe(86_400);
  });

  it("reports unreachable links", async () => {
    const h = harness({ statuses: { "https://render.com/startups": 404 } });
    const result = await withEnv({ DRY_RUN: "false" }, () => rebuild.func(h.ctx, {}));
    expect(result.deadLinks).toEqual(["https://render.com/startups (404)"]);
  });

  it("commits every page once, deploys, and posts on a real run", async () => {
    const h = harness();
    const result = await withEnv({ DRY_RUN: "false" }, () => rebuild.func(h.ctx, {}));

    expect(result.committed).toBe(true);
    expect(result.changedPaths).toEqual([
      "site/shifra/index.html",
      "site/index.html",
      "site/alex/index.html",
    ]);
    expect(result.commitSha).toBe("commit1");
    expect(result.deployId).toBe("dep-1");
    expect(h.createCommit).toHaveBeenCalledTimes(1);
    expect(h.triggerDeployPort).toHaveBeenCalledTimes(1);
    expect(h.slackPost).toHaveBeenCalledTimes(1);
  });

  it("leaves an unchanged page out of the commit", async () => {
    const first = harness();
    await withEnv({ DRY_RUN: "false" }, () => rebuild.func(first.ctx, {}));
    const rendered = first.committed();

    // Alex's page is already on the branch and unchanged; Shifra's is stale.
    const second = harness({
      current: {
        "site/alex/index.html": rendered["site/alex/index.html"] ?? "",
        "site/shifra/index.html": "<html>old</html>",
        "site/index.html": "<html>old</html>",
      },
    });
    const result = await withEnv({ DRY_RUN: "false" }, () => rebuild.func(second.ctx, {}));

    expect(result.changedPaths).toEqual(["site/shifra/index.html", "site/index.html"]);
    expect(Object.keys(second.committed())).not.toContain("site/alex/index.html");
  });

  it("skips the commit when nothing changed", async () => {
    const first = harness();
    await withEnv({ DRY_RUN: "false" }, () => rebuild.func(first.ctx, {}));

    const second = harness({ current: first.committed() });
    const result = await withEnv({ DRY_RUN: "false" }, () => rebuild.func(second.ctx, {}));

    expect(result.committed).toBe(false);
    expect(result.changedPaths).toEqual([]);
    expect(second.createCommit).not.toHaveBeenCalled();
    expect(second.triggerDeployPort).not.toHaveBeenCalled();
  });

  it("commits a brand-new person's page, which is not on the branch yet", async () => {
    const first = harness();
    await withEnv({ DRY_RUN: "false" }, () => rebuild.func(first.ctx, {}));
    const rendered = first.committed();

    // Everything is current except alex, whose file has never been committed.
    const second = harness({
      current: {
        "site/shifra/index.html": rendered["site/shifra/index.html"] ?? "",
        "site/index.html": rendered["site/index.html"] ?? "",
      },
    });
    const result = await withEnv({ DRY_RUN: "false" }, () => rebuild.func(second.ctx, {}));

    expect(result.changedPaths).toEqual(["site/alex/index.html"]);
  });

  it("scrapes in batches instead of opening one run per link", async () => {
    const links = Array.from({ length: 25 }, (_, i) =>
      rawPage(`Link ${i}`, `https://example.com/${i}`, i),
    );
    const h = harness({ links });
    const result = await withEnv({ DRY_RUN: "false" }, () => rebuild.func(h.ctx, {}));

    expect(result.linkCount).toBe(25);
    expect(h.scrapeFetch).toHaveBeenCalledTimes(25);
    expect(h.peak()).toBeLessThanOrEqual(10);
  });

  it("does not call a link dead when the site refuses a bot GET", async () => {
    const h = harness({ statuses: { "https://x.com/render": 403 } });
    const result = await withEnv({ DRY_RUN: "false" }, () => rebuild.func(h.ctx, {}));
    expect(result.deadLinks).toEqual([]);
  });

  it("posts the failure to Slack before it rethrows", async () => {
    const h = harness();
    await expect(
      withEnv({ DRY_RUN: "false", SITE_DEFAULT_SLUG: "nobody" }, () =>
        rebuild.func(h.ctx, {}),
      ),
    ).rejects.toThrow(/matches no Slug/);

    expect(h.slackPost).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.slackPost.mock.calls[0])).toContain("grouplink.rebuild failed");
  });

  it("writes nothing on a dry run", async () => {
    const h = harness();
    const result = await withEnv({ DRY_RUN: "true" }, () => rebuild.func(h.ctx, {}));

    expect(result.dryRun).toBe(true);
    expect(result.committed).toBe(false);
    expect(result.linkCount).toBe(3);
    expect(h.createCommit).not.toHaveBeenCalled();
    expect(h.slackPost).not.toHaveBeenCalled();
  });
});
