// The published site: every profile's page model in one JSON document.
//
// grouplink.rebuild writes it to Key Value under SITE_KEY, and the web service reads
// it on each request and renders it with render.ts. The two deploy separately, so the
// document carries a schema number, and a reader refuses a schema it does not know.
// grouplink-py writes and reads the same document.
import { createHash } from "node:crypto";
import { DEFAULT_ICON, isIconName } from "./icons.js";
import type { LinkCard, PageModel } from "./render.js";

/** One key for the whole site, so a reader never sees half of a rebuild. */
export const SITE_KEY = "grouplink:site";

/** Increase this when the shape changes in a way an older reader cannot read. */
export const SCHEMA = 1;

export interface Snapshot {
  /** sha256 of the pages and the default slug. The build time is not part of it. */
  hash: string;
  builtAt: string;
  defaultSlug: string;
  /** Slug -> page, in Notion's profile order. */
  pages: Map<string, PageModel>;
}

/** The JSON document for one rebuild. `pages` maps each slug to its page. */
export function buildSnapshot(
  pages: Map<string, PageModel>,
  defaultSlug: string,
  builtAt: Date,
): string {
  const content = {
    defaultSlug,
    pages: [...pages].map(([slug, page]) => pageToJson(slug, page)),
  };
  return JSON.stringify({
    schema: SCHEMA,
    hash: createHash("sha256").update(canonicalJson(content), "utf8").digest("hex"),
    // Whole seconds, as grouplink-py writes it.
    builtAt: builtAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
    ...content,
  });
}

/** Throws for anything but a snapshot this build can serve. */
export function parseSnapshot(raw: string): Snapshot {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (error) {
    throw new Error(`snapshot is not JSON: ${String(error)}`);
  }
  if (!isObject(doc)) throw new Error("snapshot is not a JSON object");
  if (doc.schema !== SCHEMA)
    throw new Error(`snapshot schema ${String(doc.schema)} is not ${SCHEMA}`);
  if (!Array.isArray(doc.pages)) throw new Error("snapshot pages is not a list");

  const pages = new Map(doc.pages.map(pageFromJson));
  const defaultSlug = str(doc, "defaultSlug");
  if (!pages.has(defaultSlug)) throw new Error(`snapshot defaultSlug "${defaultSlug}" has no page`);

  return { hash: str(doc, "hash"), builtAt: str(doc, "builtAt"), defaultSlug, pages };
}

/**
 * The JSON Python's `json.dumps(sort_keys=True, separators=(",", ":"))` writes:
 * sorted keys, and every character from U+007F up escaped. The hash is taken
 * over this, so both ports hash the same site to the same value.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${asciiJson(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return asciiJson(value);
}

function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function pageToJson(slug: string, page: PageModel) {
  return {
    slug,
    name: page.name,
    tagline: page.tagline,
    cards: page.cards.map((card) => ({
      title: card.title,
      url: card.url,
      description: card.description,
      iconUrl: card.iconUrl,
      icon: card.icon,
    })),
  };
}

function pageFromJson(page: unknown): [string, PageModel] {
  if (!isObject(page)) throw new Error("snapshot page is not a JSON object");
  if (!Array.isArray(page.cards)) throw new Error("snapshot page cards is not a list");
  return [
    str(page, "slug"),
    { name: str(page, "name"), tagline: str(page, "tagline"), cards: page.cards.map(cardFromJson) },
  ];
}

function cardFromJson(card: unknown): LinkCard {
  if (!isObject(card)) throw new Error("snapshot card is not a JSON object");
  // A Workflow deployed ahead of the web service can name an icon this build does
  // not ship. The card draws the default, as a Notion row with that icon would.
  const icon = str(card, "icon");
  return {
    title: str(card, "title"),
    url: str(card, "url"),
    description: str(card, "description"),
    iconUrl: str(card, "iconUrl"),
    icon: isIconName(icon) ? icon : DEFAULT_ICON,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string") throw new Error(`snapshot field ${key} is not a string`);
  return value;
}
