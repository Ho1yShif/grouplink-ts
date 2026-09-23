// Notion rows in, page model out. Pure functions — no network, no ctx.
import type { PageDTO } from "@render-lab/tasks-notion";
import { DEFAULT_ICON, isIconName, type IconName } from "./icons.js";
import type { LinkCard } from "./render.js";

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Notion flattens a select property to the option name, or null when empty. */
function readIconOption(value: unknown): string {
  return readString(value).toLowerCase();
}

/** The icon a link row draws, whatever its Icon cell holds. */
export function toIconName(value: unknown): IconName {
  const name = readIconOption(value);
  return isIconName(name) ? name : DEFAULT_ICON;
}

export interface LinkRow {
  title: string;
  url: string;
  visible: boolean;
  /** Renders on every profile's page, whatever `profileIds` holds. */
  everyone: boolean;
  /** Notion page ids of the Profiles rows this link belongs to. */
  profileIds: string[];
  /** Which file under site/assets/link-icons the card draws. */
  icon: IconName;
}

/** One row of the Profiles database. `id` is what a link's relation points at. */
export interface ProfileRow {
  id: string;
  name: string;
  slug: string;
  tagline: string;
}

/** A profile and the links that relate to it, in the order Notion returned them. */
export interface ProfilePage {
  profile: ProfileRow;
  rows: LinkRow[];
}

/**
 * The link columns of one Notion page. Both the row builder and the skip report
 * read rows through here, so the two cannot disagree about what a column means.
 *
 * Notion's queryDatabase hoists the title column to `page.title` and leaves every
 * column in `page.properties`. `page.url` is the Notion page itself, not the link —
 * the link lives in the `URL` property.
 */
function readLinkRow(page: PageDTO): LinkRow {
  const props = page.properties;
  const related = props["Profiles"];
  return {
    title: readString(page.title) || readString(props["Title"]),
    url: readString(props["URL"]),
    visible: props["Visible"] !== false,
    everyone: props["Everyone"] === true,
    profileIds: Array.isArray(related) ? related : [],
    icon: toIconName(props["Icon"]),
  };
}

/** Every row that has both a title and a URL, in the order Notion returned them. */
export function toLinkRows(pages: PageDTO[]): LinkRow[] {
  return pages.map(readLinkRow).filter((row) => row.url && row.title);
}

/** A link row read from Notion that renders on no page, and the check it failed. */
export interface SkippedRow {
  title: string;
  url: string;
  reason: string;
}

/**
 * Why a row you can see in Notion is missing from the site. Reads every page, so
 * it can name the rows toLinkRows drops as well as the ones no page claims.
 */
export function skippedRows(pages: PageDTO[], profiles: ProfileRow[]): SkippedRow[] {
  const knownIds = new Set(profiles.map((profile) => profile.id));
  const skipped: SkippedRow[] = [];

  for (const page of pages) {
    const row = readLinkRow(page);
    const reason = skipReason(row, knownIds);
    if (reason) skipped.push({ title: row.title || row.url || page.id, url: row.url, reason });
  }

  return skipped;
}

/** Why this row renders nowhere, or "" when it renders. Checks run in read order. */
function skipReason(row: LinkRow, knownIds: ReadonlySet<string>): string {
  if (!row.url) return "no URL";
  if (!row.title) return "no Title";
  if (!row.visible) return "Visible is unchecked";
  if (row.everyone || row.profileIds.some((id) => knownIds.has(id))) return "";
  return row.profileIds.length === 0
    ? "no Profiles relation and Everyone is unchecked"
    : "its Profiles relation points at no row in the Profiles database";
}

/**
 * Icon options Notion holds that no file matches. Those rows render the default,
 * so the value is otherwise invisible. Reads every row, including hidden ones,
 * because an option with no file is a Notion mistake either way. Distinct,
 * first-seen order.
 */
export function unknownIcons(pages: PageDTO[]): string[] {
  const seen = new Set<string>();

  for (const page of pages) {
    const raw = readIconOption(page.properties["Icon"]);
    if (raw && !isIconName(raw)) seen.add(raw);
  }

  return [...seen];
}

/**
 * Profile rows. A row without a name or a slug is skipped, because neither the page
 * heading nor its path can be built without both.
 */
export function toProfileRows(pages: PageDTO[]): ProfileRow[] {
  const rows: ProfileRow[] = [];

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
 * One bundle per profile. A link related to two profiles appears in both, and one with
 * `Everyone` checked appears on every page. The two are a union, so a row with both
 * set is redundant rather than contradictory.
 */
export function groupByProfile(rows: LinkRow[], profiles: ProfileRow[]): ProfilePage[] {
  return profiles.map((profile) => ({
    profile,
    rows: rows.filter((row) => row.everyone || row.profileIds.includes(profile.id)),
  }));
}

/** Distinct URLs, first-seen order. A link on three pages is fetched once. */
export function uniqueUrls(rows: LinkRow[]): string[] {
  return [...new Set(rows.map((row) => row.url))];
}

/** The default profile is the root page; every other profile lives under its slug. */
function pagePath(siteDir: string, slug: string): string {
  return slug ? `${siteDir}/${slug}/index.html` : `${siteDir}/index.html`;
}

/**
 * Every path one profile's page is written to. The default profile gets a second
 * copy at the site root, so `/` and `/<default slug>` serve the same bytes.
 */
export function pagePathsFor(siteDir: string, slug: string, defaultSlug: string): string[] {
  const paths = [pagePath(siteDir, slug)];
  if (slug === defaultSlug) paths.push(pagePath(siteDir, ""));
  return paths;
}

/**
 * A default slug that matches no profile would publish a site with no root page,
 * so every caller that renders pages checks it before it renders anything.
 */
export function assertDefaultSlug(profiles: ProfileRow[], defaultSlug: string): void {
  if (profiles.some((profile) => profile.slug === defaultSlug)) return;
  throw new Error(
    `SITE_DEFAULT_SLUG is "${defaultSlug}", which matches no Slug in the Profiles database`,
  );
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

/**
 * One card, from the Notion row and whatever description the scrape found. Takes
 * the row's fields rather than a LinkRow, so the seed links in scripts/ fit too.
 */
export function toCard(
  row: Pick<LinkRow, "title" | "url" | "icon">,
  description: string,
): LinkCard {
  return {
    title: row.title,
    url: row.url,
    description,
    iconUrl: faviconUrl(row.url),
    icon: row.icon,
  };
}

/** Cache key for one URL's scraped metadata. `v1` lets a shape change invalidate. */
export function metaCacheKey(url: string): string {
  return `gl:meta:v1:${url}`;
}
