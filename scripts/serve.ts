// Static dev server for site/, with reload on save. Run with `pnpm serve`.
//
// It serves the files under site/ the way the static site does, including
// /<slug>/ directory indexes. Saving a file under site/ reloads the browser.
// Saving a file under src/ first re-runs `pnpm placeholder`, so an edit to
// src/render.ts shows up without a manual step. That rewrites every page under
// site/ from the seed links, overwriting whatever `pnpm preview` put there.
//
// The rendered page allows its inline style and script by hash, so the reload
// client would be blocked. This server rewrites the Content-Security-Policy
// meta tag on the way out to allow that one script and the event stream. The
// files on disk keep the policy the workflow commits.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { envInt } from "../src/config.js";
import { repoRoot } from "./write-pages.js";

const PORT = envInt("PORT", process.env.PORT, 3000);
const DEBOUNCE_MS = 100;
const RELOAD_PATH = "/__reload";

const siteRoot = resolve(repoRoot, "site");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const RELOAD_SCRIPT = `
new EventSource('${RELOAD_PATH}').addEventListener('message', function () {
  location.reload();
});
`;

const RELOAD_SCRIPT_HASH = `'sha256-${createHash("sha256").update(RELOAD_SCRIPT, "utf8").digest("base64")}'`;

/** Widen the committed policy just enough for the reload client. */
function allowReloadClient(html: string): string {
  return html.replace(
    /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(">)/,
    (_match, open: string, policy: string, close: string) => {
      const widened = policy
        .replace(/script-src /, `script-src ${RELOAD_SCRIPT_HASH} `)
        .concat("; connect-src 'self'");
      return `${open}${widened}${close}`;
    },
  );
}

function injectReloadClient(html: string): string {
  return allowReloadClient(html).replace("</body>", `<script>${RELOAD_SCRIPT}</script>\n</body>`);
}

/** Resolve a URL path to a file inside site/, or null if it escapes or is missing. */
async function resolveFile(urlPath: string): Promise<string | null> {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const candidate = resolve(siteRoot, `.${normalize(decoded)}`);
  if (candidate !== siteRoot && !candidate.startsWith(`${siteRoot}/`)) return null;

  const paths = decoded.endsWith("/")
    ? [join(candidate, "index.html")]
    : [candidate, join(candidate, "index.html")];
  for (const path of paths) {
    const info = await stat(path).catch(() => null);
    if (info?.isFile()) return path;
  }
  return null;
}

const clients = new Set<ServerResponse>();

function reloadClients(): void {
  for (const client of clients) client.write("data: reload\n\n");
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";

  if (url === RELOAD_PATH) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write("retry: 500\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  const path = await resolveFile(url);
  if (!path) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404\n");
    return;
  }

  const type = CONTENT_TYPES[extname(path)] ?? "application/octet-stream";
  const body = await readFile(path);
  const payload =
    extname(path) === ".html" ? Buffer.from(injectReloadClient(body.toString())) : body;
  res.writeHead(200, {
    "content-type": type,
    "content-length": payload.byteLength,
    "cache-control": "no-store",
  });
  res.end(payload);
});

/** Re-render every page under site/ from the seed links. The site watcher reloads. */
let rendering = false;
function renderPlaceholder(): void {
  if (rendering) return;
  rendering = true;
  const child = spawn("npx", ["tsx", "scripts/placeholder.ts"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  child.on("exit", () => {
    rendering = false;
  });
}

function watchTree(dir: string, onChange: () => void): void {
  let timer: NodeJS.Timeout | undefined;
  watch(resolve(repoRoot, dir), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, DEBOUNCE_MS);
  });
}

watchTree("site", reloadClients);
watchTree("src", renderPlaceholder);

server.listen(PORT, () => {
  console.log(`serving site/ on http://localhost:${PORT} — reloading on save`);
});
