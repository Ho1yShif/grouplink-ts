// Regenerates the pages under site/ from seed links, without scraped descriptions.
// The workflow overwrites these files on its first real run; they exist so the
// static site has something to serve before then, and so the local preview has the
// same shape as production: one page per person, plus a copy of the default
// person's page at the root. Run with `pnpm placeholder`.
import type { IconName } from "../src/icons.js";
import { toCard } from "../src/links.js";
import { writePages } from "./write-pages.js";

interface SeedPerson {
  name: string;
  slug: string;
  links: Array<{ title: string; url: string; icon: IconName }>;
}

const SHARED: SeedPerson["links"] = [
  {
    title: "Funded founder? Apply to the Render startup program",
    url: "https://render.com/startups",
    icon: "form",
  },
  { title: "Website", url: "https://render.com/", icon: "render" },
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
        icon: "workflows",
      },
    ],
  },
  {
    name: "Graham",
    slug: "graham",
    links: [
      ...SHARED,
      { title: "Docs", url: "https://render.com/docs", icon: "info" },
    ],
  },
];

const DEFAULT_SLUG = "shifra";
const TAGLINE = "The fastest path to production for full-stack applications and agents";

for (const person of PEOPLE) {
  writePages(
    {
      name: person.name,
      tagline: TAGLINE,
      cards: person.links.map((link) => toCard(link, "")),
    },
    { siteDir: "site", slug: person.slug, defaultSlug: DEFAULT_SLUG },
  );
}
