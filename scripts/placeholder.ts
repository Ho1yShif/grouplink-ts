// Regenerates the pages under site/ from seed links, with the descriptions the
// scrape finds in production written out by hand.
// The workflow overwrites these files on its first real run; they exist so the
// static site has something to serve before then, and so the local preview has the
// same shape as production: one page per profile, plus a copy of the default
// profile's page at the root. Run with `pnpm placeholder`.
import type { IconName } from "../src/icons.js";
import { toCard } from "../src/links.js";
import { writePages } from "./write-pages.js";

interface SeedProfile {
  name: string;
  slug: string;
  links: Array<{ title: string; url: string; description: string; icon: IconName }>;
}

const SHARED: SeedProfile["links"] = [
  {
    title: "Funded founder? Apply to the Render startup program",
    url: "https://render.com/startups",
    description:
      "Build and scale your startup's apps and agents on infrastructure developers love, and get up to $100,000 in credits through Render for Startups.",
    icon: "form",
  },
  {
    title: "Render website",
    url: "https://render.com/",
    description:
      "Deploy and scale any app or agent from your first user to your billionth. Build faster on intuitive cloud infrastructure for the modern web.",
    icon: "render",
  },
];

const PROFILES: SeedProfile[] = [
  {
    name: "Shifra",
    slug: "shifra",
    links: [
      ...SHARED,
      {
        title: "Get started with Render Workflows",
        url: "https://render.com/tutorials/render-workflows",
        description:
          "Scaffold a Render Workflow, write your first task, run it locally, and deploy it — in Python or TypeScript.",
        icon: "workflows",
      },
    ],
  },
  {
    name: "Graham",
    slug: "graham",
    links: [
      ...SHARED,
      {
        title: "Render docs",
        url: "https://render.com/docs",
        description:
          "Guides and reference for deploying web services, static sites, workers, cron jobs, Postgres, and Key Value on Render.",
        icon: "info",
      },
    ],
  },
];

const DEFAULT_SLUG = "shifra";
const TAGLINE = "The fastest path to production for full-stack applications and agents";

for (const profile of PROFILES) {
  writePages(
    {
      name: profile.name,
      tagline: TAGLINE,
      cards: profile.links.map((link) => toCard(link, link.description)),
    },
    { siteDir: "site", slug: profile.slug, defaultSlug: DEFAULT_SLUG },
  );
}
