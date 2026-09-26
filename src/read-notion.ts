// Reads both Notion databases and builds each profile's page model. Shared so the
// workflow and the preview script query and order the rows the same way.
import type { TaskContext } from "@renderinc/sdk/workflows";
import { queryDatabase, type PageDTO } from "@render-lab/tasks-notion";

import type { RebuildConfig } from "./config.js";
import {
  assertDefaultSlug,
  groupByProfile,
  LINK_SORTS,
  toLinkRows,
  toProfileRows,
  unnumberedLast,
  visibleRows,
  type ProfilePage,
  type ProfileRow,
} from "./links.js";

/** What one read of the two Notion databases gives the rebuild and the preview. */
export interface NotionSite {
  /** The raw link rows, which the skip report reads. */
  linkPages: PageDTO[];
  profiles: ProfileRow[];
  /** One page per profile. Each page holds its visible rows, in `Order`. */
  pages: ProfilePage[];
}

/**
 * Two runs in parallel. A link's `Profiles` relation holds the Notion page ids of
 * its Profiles rows, which is how the two join. Notion sorts the links by `Order`.
 * The profiles need no sort.
 */
export async function readNotionSite(ctx: TaskContext, cfg: RebuildConfig): Promise<NotionSite> {
  const [linkPages, profilePages] = await Promise.all([
    ctx.run(queryDatabase, { databaseId: cfg.databaseId, sorts: LINK_SORTS, limit: cfg.limit }),
    ctx.run(queryDatabase, { databaseId: cfg.profilesDatabaseId, limit: cfg.limit }),
  ]);

  const profiles = toProfileRows(profilePages);
  assertDefaultSlug(profiles, cfg.defaultSlug);
  const pages = groupByProfile(visibleRows(unnumberedLast(toLinkRows(linkPages))), profiles);

  return { linkPages, profiles, pages };
}
