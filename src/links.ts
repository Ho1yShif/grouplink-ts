// Notion rows in, page model out. Pure functions — no network, no ctx.
import type { PageDTO } from "@render-lab/tasks-notion";

export type LinkKind = "link" | "social";

export interface LinkRow {
  title: string;
  url: string;
  visible: boolean;
  kind: LinkKind;
  /** Renders on every person's page, whatever `personIds` holds. */
  everyone: boolean;
  /** Notion page ids of the People rows this link belongs to. */
  personIds: string[];
}

/** One row of the People database. `id` is what a link's relation points at. */
export interface PersonRow {
  id: string;
  name: string;
  slug: string;
  tagline: string;
}

/** A person and the links that relate to them, in the order Notion returned them. */
export interface PersonPage {
  person: PersonRow;
  rows: LinkRow[];
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Notion's queryDatabase hoists the title column to `page.title` and leaves every
 * column in `page.properties`. `page.url` is the Notion page itself, not the link —
 * the link lives in the `URL` property.
 */
export function toLinkRows(pages: PageDTO[]): LinkRow[] {
  const rows: LinkRow[] = [];

  for (const page of pages) {
    const props = page.properties;
    const url = readString(props["URL"]);
    const title = readString(page.title) || readString(props["Title"]);
    if (!url || !title) continue;

    const visible = props["Visible"] !== false;
    const kind = readString(props["Kind"]).toLowerCase() === "social" ? "social" : "link";
    const everyone = props["Everyone"] === true;
    const related = props["People"];
    const personIds = Array.isArray(related) ? related : [];

    rows.push({ title, url, visible, kind, everyone, personIds });
  }

  return rows;
}

/** A link row read from Notion that renders on no page, and the check it failed. */
export interface SkippedRow {
  title: string;
  url: string;
  reason: string;
}

/**
 * Why a row you can see in Notion is missing from the site. Re-reads the raw pages
 * so it can name rows that toLinkRows drops before they become a LinkRow.
 */
export function skippedRows(pages: PageDTO[], people: PersonRow[]): SkippedRow[] {
  const personIds = new Set(people.map((person) => person.id));
  const skipped: SkippedRow[] = [];

  for (const page of pages) {
    const props = page.properties;
    const url = readString(props["URL"]);
    const title = readString(page.title) || readString(props["Title"]);
    const label = title || url || page.id;

    if (!url) {
      skipped.push({ title: label, url, reason: "no URL" });
      continue;
    }
    if (!title) {
      skipped.push({ title: label, url, reason: "no Title" });
      continue;
    }
    if (props["Visible"] === false) {
      skipped.push({ title: label, url, reason: "Visible is unchecked" });
      continue;
    }
    const related = props["People"];
    const ids: string[] = Array.isArray(related) ? related : [];
    if (props["Everyone"] !== true && !ids.some((id) => personIds.has(id))) {
      const reason =
        ids.length === 0
          ? "no People relation and Everyone is unchecked"
          : "its People relation points at no row in the People database";
      skipped.push({ title: label, url, reason });
    }
  }

  return skipped;
}

/**
 * People rows. A row without a name or a slug is skipped, because neither the page
 * heading nor its path can be built without both.
 */
export function toPersonRows(pages: PageDTO[]): PersonRow[] {
  const rows: PersonRow[] = [];

  for (const page of pages) {
    const props = page.properties;
    const name = readString(page.title) || readString(props["Name"]);
    const slug = readString(props["Slug"]).toLowerCase();
    if (!name || !slug) continue;

    rows.push({ id: page.id, name, slug, tagline: readString(props["Tagline"]) });
  }

  return rows;
}

/**
 * One bundle per person. A link related to two people appears in both, and one with
 * `Everyone` checked appears on every page. The two are a union, so a row with both
 * set is redundant rather than contradictory.
 */
export function groupByPerson(rows: LinkRow[], people: PersonRow[]): PersonPage[] {
  return people.map((person) => ({
    person,
    rows: rows.filter((row) => row.everyone || row.personIds.includes(person.id)),
  }));
}

/** Distinct URLs, first-seen order. A link on three pages is fetched once. */
export function uniqueUrls(rows: LinkRow[]): string[] {
  return [...new Set(rows.map((row) => row.url))];
}

/** The default person is the root page; everyone else lives under their slug. */
export function pagePath(siteDir: string, slug: string): string {
  return slug ? `${siteDir}/${slug}/index.html` : `${siteDir}/index.html`;
}

/** Cards render in the order the Notion database returned them. */
export function visibleRows(rows: LinkRow[]): LinkRow[] {
  return rows.filter((row) => row.visible);
}

/** Best-effort icon. The card hides the image when this 404s. */
export function faviconUrl(rawUrl: string): string {
  try {
    return new URL("/favicon.ico", rawUrl).toString();
  } catch {
    return "";
  }
}

/** The card blurb. Empty when the page has no meta description. */
export function cardDescription(meta: { description?: string }): string {
  return readString(meta.description);
}

/** Cache key for one URL's scraped metadata. `v1` lets a shape change invalidate. */
export function metaCacheKey(url: string): string {
  return `gl:meta:v1:${url}`;
}
