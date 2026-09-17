// The whole page. One function, one string, no framework and no build step —
// grouplink.rebuild commits whatever this returns as site/index.html.
//
// Visual foundations come from Render's brand system: semantic color tokens in
// :root with a dark override, PP Neue Montreal for prose, square corners,
// 1px hairlines, purple reserved for links and focus.
//
// The page carries its own Content-Security-Policy, with the inline style and
// script blocks allowed by hash. Adding either one anywhere but STYLES or
// ICON_FALLBACK_SCRIPT will be blocked by the browser. The policy is a meta tag
// rather than a render.yaml header so the hashes cannot drift from the content
// they cover.
import { createHash } from "node:crypto";

export interface LinkCard {
  /** Display text. Comes from Notion, not from the scrape. */
  title: string;
  /** Final href, exactly as the Notion row gives it. */
  url: string;
  /** Scraped og:title or meta description; may be empty. */
  description: string;
  /** `<origin>/favicon.ico`, hidden on error. */
  iconUrl: string;
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

/*
 * Per-row entrance delays. They are generated rather than set inline, because
 * the policy allows the <style> block by hash and no style attribute at all.
 */
const ROW_STAGGER = Array.from(
  { length: 20 },
  (_, i) => `.card:nth-child(${i + 1}) { animation-delay: ${i * 30}ms; }`,
).join("\n");

const STYLES = `
@font-face {
  font-family: 'Roobert';
  src: url('/assets/fonts/RoobertVF.woff2') format('woff2-variations');
  font-weight: 300 500;
  font-display: swap;
}
@font-face {
  font-family: 'PP Neue Montreal';
  src: url('/assets/fonts/PPNeueMontreal-Variable.woff2') format('woff2-variations');
  font-weight: 300 500;
  font-display: swap;
}
@font-face {
  font-family: 'PP Neue Montreal Mono';
  src: url('/assets/fonts/PPNeueMontrealMono-Medium.woff2') format('woff2');
  font-weight: 500;
  font-display: swap;
}

:root {
  --bg: #ffffff;
  --bg-secondary: #e3e3e3;
  --border: #e3e3e3;
  --text: #0d0d0d;
  --text-secondary: #4d4d4d;
  --text-faint: #6b6b6b;
  --link: #8a05ff;
  --link-hover: #48008c;
  --link-bg: #e7dbff;
  --accent: #8a05ff;
  --accent-strong: #48008c;
  --row-hover: rgba(0, 0, 0, 0.03);

  --font-brand: 'Roobert', 'Manrope', ui-sans-serif, system-ui, sans-serif;
  --font-default: 'PP Neue Montreal', 'Manrope', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'PP Neue Montreal Mono', 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

  --ease: cubic-bezier(0.9, 0.1, 0.1, 0.9);

  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d0d0d;
    --bg-secondary: #141414;
    --border: #272727;
    --text: #ffffff;
    --text-secondary: #c7c7c7;
    --text-faint: #b3b3b3;
    --link: #d1b8ff;
    --link-hover: #e7dbff;
    --link-bg: #48008c;
    --accent: #8a05ff;
    --accent-strong: #c29eff;
    --row-hover: rgba(255, 255, 255, 0.04);
  }
}

*, *::before, *::after { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-default);
  font-weight: 400;
  font-size: 16px;
  line-height: 24px;
  letter-spacing: 0.01em;
  -webkit-font-smoothing: antialiased;
}

.page {
  max-width: 560px;
  margin: 0 auto;
  padding: 96px 32px 64px;
  display: flex;
  flex-direction: column;
  gap: 40px;
}

.masthead {
  animation: row-fade 350ms var(--ease) both;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 16px;
  /* Adds to the .page gap, so the links start further below the socials. */
  margin-bottom: 48px;
}

.name { margin: 0; }

.logo-link {
  display: block;
  color: var(--text);
}
.logo-link:hover { color: var(--link); }
.logo-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }

/*
 * The logo file is solid white, so an <img> would vanish on the light
 * background. It is a mask instead, painted with the text color.
 */
.logo {
  display: block;
  width: 240px;
  height: 46px;
  background-color: currentColor;
  transition: background-color 150ms var(--ease);
  -webkit-mask: url('/assets/render-logo-white.png') center / contain no-repeat;
  mask: url('/assets/render-logo-white.png') center / contain no-repeat;
}

.links { border-top: 1px solid var(--border); }

.card {
  display: grid;
  grid-template-columns: 32px 1fr 16px;
  align-items: start;
  gap: 16px;
  padding: 18px 12px;
  border-bottom: 1px solid var(--border);
  text-decoration: none;
  color: inherit;
  min-height: 56px;
  animation: row-fade 350ms var(--ease) both;
}
${ROW_STAGGER}

.card:hover,
.card:focus-visible { background: var(--row-hover); }
.card:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

.card__index {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: 12px;
  line-height: 24px;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--text-faint);
}

.card__body { display: block; }

/*
 * The signature link hover: a purple underline that wipes in left to right and
 * retreats the way it came. It is a background rather than a border or a
 * pseudo-element, so it follows the title onto a second line. The rest position
 * is the right edge, which is where the wipe retreats to; the jump back is
 * invisible because the underline has no width by then.
 */
.card__title {
  display: inline;
  font-size: 16px;
  line-height: 24px;
  background-image: linear-gradient(var(--link), var(--link));
  background-repeat: no-repeat;
  background-position: right bottom;
  background-size: 0% 1px;
  transition: background-size 200ms var(--ease);
}
.card:hover .card__title,
.card:focus-visible .card__title {
  background-position: left bottom;
  background-size: 100% 1px;
}
.card__desc {
  margin: 4px 0 0;
  font-size: 14px;
  line-height: 20px;
  color: var(--text-faint);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}

.card__icon { width: 14px; height: 14px; display: block; flex: none; }
/* Collapse a favicon that 404s, so the target line closes the gap. */
.card__icon--broken { display: none; }

.card__target {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: 11px;
  line-height: 14px;
  letter-spacing: 0.02em;
  color: var(--text-faint);
  overflow-wrap: anywhere;
}

.card__arrow {
  color: var(--text-faint);
  line-height: 24px;
  transition: transform 150ms var(--ease), color 0s;
}
.card:hover .card__arrow { transform: translateX(2px); }

@keyframes row-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.socials {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 20px;
  /* Adds to the .masthead gap, so the icons clear the logo. */
  margin-top: 8px;
}

.social {
  display: block;
  color: var(--text);
  text-decoration: none;
}
.social:hover { color: var(--link); }
.social:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }

/*
 * The icon files are solid white, so an <img> would vanish on the light
 * background. Each one is a mask instead, painted with the text color.
 */
.social__icon {
  display: block;
  width: 24px;
  height: 24px;
  background-color: currentColor;
  -webkit-mask: var(--icon) center / contain no-repeat;
  mask: var(--icon) center / contain no-repeat;
  transition: background-color 150ms var(--ease);
}

.social__icon--youtube { --icon: url('/assets/icons/youtube.svg'); }
.social__icon--linkedin { --icon: url('/assets/icons/linkedin.svg'); }
.social__icon--x { --icon: url('/assets/icons/x.svg'); }
.social__icon--github { --icon: url('/assets/icons/github.svg'); }
.social__icon--discord { --icon: url('/assets/icons/discord.svg'); }

@media (max-width: 767px) {
  .page { padding: 48px 16px 40px; gap: 32px; }
  .masthead { margin-bottom: 28px; }
  .logo { width: 190px; height: 36px; }
  .card { grid-template-columns: 24px 1fr 16px; gap: 12px; padding: 16px 4px; min-height: 44px; }
}

@media (prefers-reduced-motion: reduce) {
  .masthead, .card { animation: none; }
  .card__title, .card__arrow { transition: none; }
  .logo, .social__icon { transition: none; }
}
`;

/**
 * A favicon that 404s leaves a broken-image glyph, and no CSS selector matches a
 * failed image. `error` does not bubble, so the listener runs in the capture phase.
 * It adds a class instead of writing el.style, which the policy would have to allow.
 */
const ICON_FALLBACK_SCRIPT = `
addEventListener('error', function (event) {
  var el = event.target;
  if (el instanceof HTMLImageElement && el.classList.contains('card__icon')) {
    el.classList.add('card__icon--broken');
  }
}, true);
`;

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

/**
 * What the row shows as its mono metadata line: host without www, plus the path.
 * The path is what tells two rows on the same site apart, so it earns its place.
 * Empty when the URL will not parse.
 */
const MAX_TARGET = 44;

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

function renderCard(card: LinkCard, index: number): string {
  const href = escapeHtml(safeUrl(card.url));
  const title = escapeHtml(card.title);
  const number = String(index + 1).padStart(2, "0");
  const desc = card.description
    ? `<span class="card__desc">${escapeHtml(card.description)}</span>`
    : "";
  const icon = card.iconUrl
    ? `<img class="card__icon" src="${escapeHtml(safeUrl(card.iconUrl))}" alt="" loading="lazy">`
    : "";
  const target = displayTarget(card.url);
  const meta = target
    ? `<span class="card__meta">${icon}<span class="card__target">${escapeHtml(target)}</span></span>`
    : "";
  return `      <a class="card" href="${href}">
        <span class="card__index" aria-hidden="true">${number}</span>
        <span class="card__body">
          <span class="card__title">${title}</span>
          ${desc}
          ${meta}
        </span>
        <span class="card__arrow" aria-hidden="true">&#8594;</span>
      </a>`;
}

/** Where the wordmark in the masthead links. */
const LOGO_HREF = "https://dashboard.render.com/";

/**
 * The masthead's icon row. It is the same on every page and does not come from
 * Notion. Each label needs a matching file under site/assets/icons and a
 * .social__icon--<label> rule in STYLES.
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
  const icon = social.label.trim().toLowerCase();
  const label = escapeHtml(social.label);
  return `        <a class="social" href="${href}" aria-label="${label}"><span class="social__icon social__icon--${icon}"></span></a>`;
}

export function renderPage(model: PageModel): string {
  const taglineText = model.tagline.replace(/\s*\r?\n\s*/g, " ").trim();
  const cards = model.cards.map((card, i) => renderCard(card, i)).join("\n");
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
  </main>
<script>${ICON_FALLBACK_SCRIPT}</script>
</body>
</html>
`;
}
