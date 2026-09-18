// Shared by scripts/placeholder.ts and scripts/preview.ts: render one person's
// page and write it everywhere it belongs under site/.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pagePathsFor } from "../src/links.js";
import { renderPage, type PageModel } from "../src/render.js";

export const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Writes the page to the person's own path, plus the site root when they are the
 * default person. Paths are relative to the repo root, as the workflow commits them.
 */
export function writePages(
  model: PageModel,
  options: { siteDir: string; slug: string; defaultSlug: string },
): void {
  const html = renderPage(model);
  for (const path of pagePathsFor(options.siteDir, options.slug, options.defaultSlug)) {
    const out = resolve(repoRoot, path);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, html);
    console.log(`wrote ${path} (${html.length} bytes)`);
  }
}
