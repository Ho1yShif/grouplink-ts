// The web service's copy of the published site.
//
// Reads the snapshot from Key Value on each request and keeps the last good copy in
// memory, so a Key Value outage or a snapshot this build cannot read does not take
// the page down. Renders each page once per snapshot.
import { renderPage } from "./render.js";
import { parseSnapshot, type Snapshot } from "./snapshot.js";

/**
 * Milliseconds before a key that is still missing starts another rebuild. The first
 * run can fail or be a dry run, and nothing else would start one.
 */
export const REBUILD_RETRY_MS = 600_000;

export interface SiteStoreOptions {
  /** The raw snapshot, or null when the key is missing. */
  read: () => Promise<string | null>;
  /** Starts one grouplink.rebuild run. */
  rebuild: () => Promise<unknown>;
  /** Milliseconds. Tests pass a fake clock. */
  now?: () => number;
}

export function createSiteStore({ read, rebuild, now = Date.now }: SiteStoreOptions) {
  let lastGood: Snapshot | null = null;
  // Number of reads started, and the number of the read that set lastGood. A slow
  // read that finishes after a newer one must not replace its result.
  let reads = 0;
  let lastGoodRead = 0;
  // Clock time of the last rebuild this store started. null when there is none.
  let rebuildStartedAt: number | null = null;
  // "<hash>/<slug>/<year>" -> page. Holds one snapshot's pages.
  let rendered = new Map<string, string>();

  /**
   * One run per missing key every REBUILD_RETRY_MS. A new Key Value instance, or a
   * lost key, starts the rebuild that writes it. The request does not wait for the
   * Render API call.
   */
  function startRebuild(): void {
    const time = now();
    if (rebuildStartedAt !== null && time - rebuildStartedAt < REBUILD_RETRY_MS) return;
    rebuildStartedAt = time;
    Promise.resolve()
      .then(rebuild)
      .then(
        () => console.log("the site key is missing, so a rebuild started"),
        (error: unknown) => {
          // Let the next request try again.
          rebuildStartedAt = null;
          console.error(`could not start a rebuild for the missing site key: ${String(error)}`);
        },
      );
  }

  async function snapshot(): Promise<Snapshot | null> {
    reads += 1;
    const readNumber = reads;

    let raw: string | null;
    try {
      raw = await read();
    } catch (error) {
      console.error(`could not read the site from Key Value: ${String(error)}`);
      return lastGood;
    }

    if (raw === null) {
      startRebuild();
      return lastGood;
    }

    let parsed: Snapshot;
    try {
      parsed = parseSnapshot(raw);
    } catch (error) {
      console.error(`could not read the site snapshot: ${String(error)}`);
      return lastGood;
    }

    if (readNumber > lastGoodRead) {
      if (lastGood?.hash !== parsed.hash) rendered = new Map();
      lastGood = parsed;
      lastGoodRead = readNumber;
    }
    rebuildStartedAt = null;
    return parsed;
  }

  function page(current: Snapshot, slug: string, year = new Date().getFullYear()): string | null {
    const model = current.pages.get(slug);
    if (!model) return null;

    const key = `${current.hash}/${slug}/${year}`;
    let html = rendered.get(key);
    if (html === undefined) {
      html = renderPage(model, year);
      rendered.set(key, html);
    }
    return html;
  }

  return { snapshot, page };
}

export type SiteStore = ReturnType<typeof createSiteStore>;
