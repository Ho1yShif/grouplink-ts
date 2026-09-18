// The whole page. One function, one string, no framework and no build step —
// grouplink.rebuild commits whatever this returns as site/index.html. The CSS and
// the one inline script live in styles.ts.
//
// The page carries its own Content-Security-Policy, with the inline style and
// script blocks allowed by hash. Adding either one anywhere but STYLES or
// ICON_FALLBACK_SCRIPT will be blocked by the browser. The policy is a meta tag
// rather than a render.yaml header so the hashes cannot drift from the content
// they cover.
import { createHash } from "node:crypto";
import type { IconName } from "./icons.js";
import { ICON_FALLBACK_SCRIPT, STYLES } from "./styles.js";

export interface LinkCard {
  /** Display text. Comes from Notion, not from the scrape. */
  title: string;
  /** Final href, exactly as the Notion row gives it. */
  url: string;
  /** Scraped og:title or meta description; may be empty. */
  description: string;
  /** `<origin>/favicon.ico`, hidden on error. */
  iconUrl: string;
  /** Which file under site/assets/link-icons the card draws in its left column. */
  icon: IconName;
}

export interface SocialLink {
  label: string;
  url: string;
}

export interface PageModel {
  name: string;
  /** Metadata only. The page does not show it. */
  tagline: string;
  cards: LinkCard[];
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Allow only http(s) hrefs into the document. Anything else — javascript:,
 * data:, a malformed string from Notion — collapses to "#".
 */
export function safeUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "#";
    return parsed.toString();
  } catch {
    return "#";
  }
}

/** CSP source expression for an inline block, so the policy allows it by hash. */
function sha256Source(content: string): string {
  return `'sha256-${createHash("sha256").update(content, "utf8").digest("base64")}'`;
}

const CSP = [
  "default-src 'none'",
  // 'self' covers the logo and any other asset the site ships, so the mark still
  // renders over plain http on localhost. Favicons come from whatever origin the
  // link points at, over TLS only.
  "img-src 'self' https:",
  `style-src ${sha256Source(STYLES)}`,
  `script-src ${sha256Source(ICON_FALLBACK_SCRIPT)}`,
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** Longest metadata line a card draws before it is truncated. */
const MAX_TARGET = 44;

/**
 * What the row shows as its mono metadata line: host without www, plus the path.
 * The path is what tells two rows on the same site apart. Empty when the URL
 * will not parse.
 */
function displayTarget(url: string): string {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  const path = parsed.pathname.replace(/\/$/, "");
  const target = parsed.hostname.replace(/^www\./, "") + path;
  return target.length > MAX_TARGET ? target.slice(0, MAX_TARGET - 1) + "\u2026" : target;
}

function renderCard(card: LinkCard): string {
  const href = escapeHtml(safeUrl(card.url));
  const title = escapeHtml(card.title);
  const desc = card.description
    ? `<span class="card__desc">${escapeHtml(card.description)}</span>`
    : "";
  const favicon = card.iconUrl
    ? `<img class="card__icon" src="${escapeHtml(safeUrl(card.iconUrl))}" alt="" loading="lazy">`
    : "";
  const target = displayTarget(card.url);
  const meta = target
    ? `<span class="card__meta">${favicon}<span class="card__target">${escapeHtml(target)}</span></span>`
    : "";
  return `      <a class="card" href="${href}">
        <span class="card__mark card__mark--${escapeHtml(card.icon)}" aria-hidden="true"></span>
        <span class="card__body">
          <span class="card__title">${title}</span>
          ${desc}
          ${meta}
        </span>
      </a>`;
}

/** Where the wordmark in the masthead links. */
const LOGO_HREF = "https://dashboard.render.com/";

/**
 * The masthead's icon row. It is the same on every page and does not come from
 * Notion. Each label needs a matching file under site/assets/icons and a
 * .social__icon--<label> rule in styles.ts.
 */
export const SOCIALS: SocialLink[] = [
  { label: "YouTube", url: "https://www.youtube.com/@render-inc" },
  { label: "LinkedIn", url: "https://www.linkedin.com/company/renderco" },
  { label: "X", url: "https://x.com/render" },
  { label: "GitHub", url: "https://github.com/render-oss/sdk" },
  { label: "Discord", url: "https://render.com/discord" },
];

function renderSocial(social: SocialLink): string {
  const href = escapeHtml(safeUrl(social.url));
  const icon = escapeHtml(social.label.trim().toLowerCase());
  const label = escapeHtml(social.label);
  return `        <a class="social" href="${href}" aria-label="${label}"><span class="social__icon social__icon--${icon}"></span></a>`;
}

export function renderPage(model: PageModel): string {
  const year = new Date().getFullYear();
  const taglineText = model.tagline.replace(/\s*\r?\n\s*/g, " ").trim();
  const cards = model.cards.map(renderCard).join("\n");
  const socialsBlock = `      <nav class="socials" aria-label="Social">
${SOCIALS.map(renderSocial).join("\n")}
      </nav>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>Render Links</title>
<meta name="description" content="${escapeHtml(taglineText)}">
<meta property="og:title" content="${escapeHtml(model.name)} — links">
<meta property="og:description" content="${escapeHtml(taglineText)}">
<meta property="og:type" content="website">
<link rel="icon" href="/assets/render-logomark-black.svg" media="(prefers-color-scheme: light)">
<link rel="icon" href="/assets/render-logomark-white.svg" media="(prefers-color-scheme: dark)">
<style>${STYLES}</style>
</head>
<body>
  <main class="page">
    <header class="masthead">
      <h1 class="name"><a class="logo-link" href="${LOGO_HREF}" aria-label="${escapeHtml(model.name)}"><span class="logo"></span></a></h1>
${socialsBlock}
    </header>

    <section>
      <div class="links">
${cards}
      </div>
    </section>

    <footer class="footer">&copy; ${year} render.com</footer>
  </main>
<script>${ICON_FALLBACK_SCRIPT}</script>
</body>
</html>
`;
}
