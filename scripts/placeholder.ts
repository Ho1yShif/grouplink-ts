// Regenerates the pages under site/ from seed links, without scraped descriptions.
// The workflow overwrites these files on its first real run; they exist so the
// static site has something to serve before then, and so the local preview has the
// same shape as production: one page per person, plus a copy of the default
// person's page at the root. Run with `pnpm placeholder`.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { faviconUrl, pagePath } from "../src/links.js";
import { renderPage, type LinkCard, type SocialLink } from "../src/render.js";

interface SeedPerson {
  name: string;
  slug: string;
  links: Array<{ title: string; url: string }>;
}

const SHARED = [
  {
    title: "Funded founder? Apply to the Render startup program",
    url: "https://render.com/startups",
  },
  { title: "Website", url: "https://render.com/" },
];

const PEOPLE: SeedPerson[] = [
  {
    name: "Shifra",
    slug: "shifra",
    links: [
      ...SHARED,
      {
        title: "Tutorial | Get started with Render Workflows",
        url: "https://render.com/tutorials/render-workflows",
      },
    ],
  },
  {
    name: "Graham",
    slug: "graham",
    links: [...SHARED, { title: "Docs", url: "https://render.com/docs" }],
  },
];

// The header is the same on every page, so this list is not per person.
const SOCIALS: SocialLink[] = [
  { label: "YouTube", url: "https://www.youtube.com/@render-inc" },
  { label: "LinkedIn", url: "https://www.linkedin.com/company/renderco" },
  { label: "X", url: "https://x.com/render" },
  { label: "GitHub", url: "https://github.com/render-oss/sdk" },
  { label: "Discord", url: "https://render.com/discord" },
];

const DEFAULT_SLUG = "shifra";
const TAGLINE = "The fastest path to production for full-stack applications and agents";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

for (const person of PEOPLE) {
  const html = renderPage({
    name: person.name,
    tagline: TAGLINE,
    cards: person.links.map(
      (link): LinkCard => ({
        title: link.title,
        url: link.url,
        description: "",
        iconUrl: faviconUrl(link.url),
      }),
    ),
    socials: SOCIALS,
  });

  const paths = [pagePath("site", person.slug)];
  if (person.slug === DEFAULT_SLUG) paths.push(pagePath("site", ""));
  for (const path of paths) {
    const out = resolve(repoRoot, path);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, html);
    console.log(`wrote ${path} (${html.length} bytes)`);
  }
}
