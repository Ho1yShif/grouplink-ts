// Config resolution: per-run input overrides, then env, then defaults.
// Same shape as the render-tasks examples — the workflow task reads nothing
// from process.env directly.

export interface RebuildInput {
  databaseId?: string;
  profilesDatabaseId?: string;
  dryRun?: boolean;
  limit?: number;
}

export interface RebuildConfig {
  /** Notion database holding the link rows. */
  databaseId: string;
  /** Notion database holding one row per profile: Name, Slug, Tagline. */
  profilesDatabaseId: string;
  limit: number;
  /** Skips the site write to Key Value and the Slack post. */
  dryRun: boolean;

  /** Slug of the profile the root page shows. */
  defaultSlug: string;

  /** Seconds a scraped metadata record stays in Key Value. */
  cacheTtlSeconds: number;

  /** Public URL of the page, for the Slack message. */
  siteUrl: string;
}

const FALSY = new Set(["false", "0", "no", "off"]);

/**
 * Case-insensitive. DRY_RUN guards the site write and the Slack post, and reading
 * `False` as true would publish a run the operator meant to hold.
 */
function envFlag(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized === "") return fallback;
  return !FALSY.has(normalized);
}

/**
 * A whole number from the environment, or the fallback when the variable is unset.
 * Anything else throws at startup, because `LINKS_LIMIT=-5` asks Notion for a
 * negative page size and `DEBOUNCE_MS=10s` used to parse as 10 milliseconds.
 * Shared with the webhook receiver, which reads its own DEBOUNCE_MS and PORT.
 */
export function envInt(name: string, value: string | undefined, fallback: number): number {
  const raw = value?.trim() ?? "";
  if (raw === "") return fallback;

  const parsed = Number(raw);
  if (!/^\d+$/.test(raw) || parsed < 1 || !Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a whole number of 1 or more, got "${raw}"`);
  }
  return parsed;
}

export function loadConfig(
  input: RebuildInput = {},
  env: NodeJS.ProcessEnv = process.env,
): RebuildConfig {
  const databaseId = input.databaseId ?? env.NOTION_LINKS_DATABASE_ID ?? "";
  if (!databaseId) {
    throw new Error("set NOTION_LINKS_DATABASE_ID, or pass databaseId in the run input");
  }

  const profilesDatabaseId = input.profilesDatabaseId ?? env.NOTION_PROFILES_DATABASE_ID ?? "";
  if (!profilesDatabaseId) {
    throw new Error("set NOTION_PROFILES_DATABASE_ID, or pass profilesDatabaseId in the run input");
  }

  // Required, because an unset value would silently publish a site with no root page.
  const defaultSlug = (env.SITE_DEFAULT_SLUG ?? "").trim().toLowerCase();
  if (!defaultSlug) {
    throw new Error("set SITE_DEFAULT_SLUG to the slug of the profile the root page shows");
  }

  return {
    databaseId,
    profilesDatabaseId,
    limit: input.limit ?? envInt("LINKS_LIMIT", env.LINKS_LIMIT, 100),
    dryRun: input.dryRun ?? envFlag(env.DRY_RUN, false),

    defaultSlug,

    cacheTtlSeconds: envInt("METADATA_TTL_SECONDS", env.METADATA_TTL_SECONDS, 604_800),

    siteUrl: env.SITE_URL ?? "",
  };
}
