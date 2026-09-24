// Which URLs the site accepts, as string tests rather than `new URL`. A leaf
// module: both the Notion reader and the page renderer ask, and neither should
// have to import the other.
//
// `new URL` would answer most of these, but it accepts strings the Python
// implementation rejects — `http:example.com` parses there and not here. The
// two builds commit the same site/index.html, so they agree on the string
// tests instead.

const MAILTO = "mailto:";

// The characters the URL constructor drops before it parses anything: C0
// controls and spaces at either end, tabs and newlines anywhere.
// biome-ignore lint/suspicious/noControlCharactersInRegex: the parser strips these by definition
const EDGES = /^[\u0000- ]+|[\u0000- ]+$/g;
const TAB_AND_NEWLINE = /[\t\n\r]/g;

function clean(value: string): string {
  return value.replace(EDGES, "").replace(TAB_AND_NEWLINE, "");
}

/** True only for an http:// or https:// URL. */
export function isHttpUrl(value: string): boolean {
  const lower = clean(value).toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://");
}

/** True for a mailto: URL with at least one recipient. */
export function isMailtoUrl(value: string): boolean {
  const cleaned = clean(value);
  return cleaned.toLowerCase().startsWith(MAILTO) && cleaned.length > MAILTO.length;
}

/** A mailto: URL with its scheme lowercased, the way the URL constructor writes it. */
export function normalizeMailto(value: string): string {
  return MAILTO + clean(value).slice(MAILTO.length);
}
