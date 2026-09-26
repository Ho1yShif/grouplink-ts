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

// A scheme and the two slashes that follow it. The test is `://`, not the scheme
// grammar of RFC 3986, because `render.com` in `render.com:8080/x` also matches that
// grammar. The `normalize-url` package and a browser address bar make the same test.
const SCHEME_PREFIX = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//;

/**
 * The URL a card points at, from whatever the Notion cell holds.
 *
 * A cell with no scheme gets `https://`. An `http://` cell becomes `https://`. A
 * `mailto:` cell keeps its scheme. Any other scheme stays as it is, so
 * `isRenderableUrl` still rejects it.
 *
 * A cell that is not a host gets no scheme. `javascript:alert(1)` would become
 * `https://javascript:alert(1)`, which `isHttpUrl` accepts and the HTTP client cannot
 * use. The cell is returned unchanged instead, and the row is skipped.
 */
export function normalizeUrl(value: string): string {
  const cleaned = clean(value);
  if (!cleaned) return "";

  if (cleaned.toLowerCase().startsWith(MAILTO)) return normalizeMailto(cleaned);

  const match = SCHEME_PREFIX.exec(cleaned);
  if (match) {
    const scheme = (match[1] as string).toLowerCase();
    const rest = cleaned.slice(match[0].length);
    return scheme === "http" ? `https://${rest}` : `${scheme}://${rest}`;
  }

  const candidate = `https://${cleaned}`;
  return URL.canParse(candidate) ? candidate : cleaned;
}
