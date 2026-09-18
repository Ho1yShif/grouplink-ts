// The page's inline <style> block and its one inline script.
//
// The styling follows Render's brand system. Color tokens live in :root with a
// dark override, the prose is set in Roobert, corners are square, hairlines are
// 1px, and purple is used only for links and focus.
//
// render.ts allows both blocks in the Content-Security-Policy by hash, so any
// inline style or script the page needs has to be added here.
import { ICON_NAMES } from "./icons.js";

/*
 * Per-row entrance delays. They are generated rather than set inline, because
 * the policy allows the <style> block by hash and no style attribute at all.
 */
const ROW_STAGGER = Array.from(
  { length: 20 },
  (_, i) => `.card:nth-child(${i + 1}) { animation-delay: ${i * 30}ms; }`,
).join("\n");

/*
 * One mask rule per icon file. Generated into the <style> block because the
 * policy allows that block by hash and no style attribute at all.
 */
const ICON_MASKS = ICON_NAMES.map(
  (name) => `.card__mark--${name} { --mark: url('/assets/link-icons/${name}.png'); }`,
).join("\n");

export const STYLES = `
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
  font-family: var(--font-brand);
  font-weight: 400;
  font-size: 16px;
  line-height: 24px;
  letter-spacing: 0.01em;
  -webkit-font-smoothing: antialiased;
}

.page {
  max-width: 640px;
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
  -webkit-mask: url('/assets/render-logo-white.png') center / contain no-repeat;
  mask: url('/assets/render-logo-white.png') center / contain no-repeat;
}

.links { border-top: 1px solid var(--border); }

.card {
  display: grid;
  grid-template-columns: 32px 1fr;
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

/*
 * The icon files are dark artwork on transparency, so an <img> would disappear
 * against the dark background. Each one is a mask instead, painted with the
 * faint text color. The top margin sits the 20px square on the title's cap line.
 */
.card__mark {
  width: 20px;
  height: 20px;
  margin-top: 3px;
  background-color: var(--text-faint);
  -webkit-mask: var(--mark) center / contain no-repeat;
  mask: var(--mark) center / contain no-repeat;
}
${ICON_MASKS}

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
  font-size: 17.6px;
  line-height: 26.4px;
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
  font-size: 15.4px;
  line-height: 22px;
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
  font-size: 12.1px;
  line-height: 15.4px;
  letter-spacing: 0;
  color: var(--text-faint);
  overflow-wrap: anywhere;
}

.footer {
  font-family: var(--font-mono);
  font-size: 12.1px;
  line-height: 15.4px;
  letter-spacing: 0.02em;
  color: var(--text-faint);
}

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
  margin-top: 28px;
}

.social {
  display: block;
  color: var(--text);
  text-decoration: none;
}
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
  /*
   * Every icon fills its 24x24 viewBox, but the artwork inside leaves a
   * different amount of empty space below it. --nudge is that space, so the
   * drawn bottoms line up across the row.
   */
  transform: translateY(var(--nudge, 0));
}

.social__icon--youtube { --icon: url('/assets/icons/youtube.svg'); --nudge: 3.5px; }
.social__icon--linkedin { --icon: url('/assets/icons/linkedin.svg'); }
.social__icon--x { --icon: url('/assets/icons/x.svg'); }
.social__icon--github { --icon: url('/assets/icons/github.svg'); --nudge: 0.3px; }
.social__icon--discord { --icon: url('/assets/icons/discord.svg'); --nudge: 2.9px; }

@media (max-width: 767px) {
  .page { padding: 48px 16px 40px; gap: 32px; }
  .masthead { margin-bottom: 28px; }
  .socials { margin-top: 20px; }
  .logo { width: 190px; height: 36px; }
  .card { grid-template-columns: 24px 1fr; gap: 12px; padding: 16px 4px; min-height: 44px; }
}

@media (prefers-reduced-motion: reduce) {
  .masthead, .card { animation: none; }
  .card__title { transition: none; }
}
`;

/**
 * A favicon that 404s leaves a broken-image glyph, and no CSS selector matches a
 * failed image. `error` does not bubble, so the listener runs in the capture phase.
 * It adds a class instead of writing el.style, which the policy would have to allow.
 */
export const ICON_FALLBACK_SCRIPT = `
addEventListener('error', function (event) {
  var el = event.target;
  if (el instanceof HTMLImageElement && el.classList.contains('card__icon')) {
    el.classList.add('card__icon--broken');
  }
}, true);
`;
