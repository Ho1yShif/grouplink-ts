// Write a seed snapshot to a local Redis, from seed links with the descriptions
// the scrape finds in production written out by hand. It lets you run the web
// service locally without Notion. The golden page tests render the same seed
// links. Run with `pnpm placeholder`.
import { pathToFileURL } from "node:url";
import type { IconName } from "../src/icons.js";
import { toCard } from "../src/links.js";
import { writeSnapshot } from "./local-site.js";

export interface SeedProfile {
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

export const PROFILES: SeedProfile[] = [
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

export const DEFAULT_SLUG = "shifra";
export const TAGLINE = "The fastest path to production for full-stack applications and agents";

export async function main(): Promise<void> {
  await writeSnapshot(
    new Map(
      PROFILES.map((profile) => [
        profile.slug,
        {
          name: profile.name,
          tagline: TAGLINE,
          cards: profile.links.map((link) => toCard(link, link.description)),
        },
      ]),
    ),
    DEFAULT_SLUG,
  );
}

// Only write when run as the entry point, so a test can import the seed data.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
