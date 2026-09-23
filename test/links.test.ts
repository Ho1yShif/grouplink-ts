// Notion rows in, page model out. Every function here is pure, so these cases
// pass plain property bags and read the result.
import { describe, expect, it } from "vitest";
import type { PageDTO } from "@render-lab/tasks-notion";
import {
  assertDefaultSlug,
  faviconUrl,
  groupByProfile,
  pagePathsFor,
  skippedRows,
  toCard,
  toIconName,
  toLinkRows,
  unknownIcons,
  visibleRows,
  type ProfileRow,
} from "../src/links.js";

function page(props: Record<string, unknown>, title: string): PageDTO {
  return {
    id: "p",
    url: "https://www.notion.so/p",
    title,
    properties: props as PageDTO["properties"],
    createdTime: "",
    lastEditedTime: "",
  };
}

describe("toLinkRows / visibleRows", () => {
  const pages = [
    page({ URL: "https://b.example", Visible: true }, "B"),
    page({ URL: "https://a.example", Visible: true }, "A"),
    page({ URL: "https://hidden.example", Visible: false }, "Hidden"),
    page({ URL: "https://x.com/render", Visible: true }, "X"),
    page({ URL: "", Visible: true }, "No URL"),
  ];

  it("reads the URL property, not the Notion page URL", () => {
    expect(toLinkRows(pages)[0]?.url).toBe("https://b.example");
  });

  it("skips rows with no URL", () => {
    expect(toLinkRows(pages).map((r) => r.title)).not.toContain("No URL");
  });

  it("keeps the Notion order and drops hidden rows", () => {
    expect(visibleRows(toLinkRows(pages)).map((r) => r.title)).toEqual(["B", "A", "X"]);
  });

  it("reads the Icon column and defaults to arrow", () => {
    const rows = toLinkRows([
      page({ URL: "https://a.example", Icon: "render" }, "A"),
      page({ URL: "https://b.example" }, "B"),
    ]);
    expect(rows.map((row) => row.icon)).toEqual(["render", "arrow"]);
  });
});

describe("groupByProfile", () => {
  const profiles = [
    { id: "profile-shifra", name: "Shifra", slug: "shifra", tagline: "" },
    { id: "profile-alex", name: "Alex", slug: "alex", tagline: "" },
  ];

  const rows = toLinkRows([
    page({ URL: "https://shared.example", Profiles: ["profile-shifra"] }, "Shifra only"),
    page({ URL: "https://all.example", Everyone: true }, "Everyone"),
    page(
      { URL: "https://both.example", Everyone: true, Profiles: ["profile-shifra"] },
      "Everyone and related",
    ),
    page({ URL: "https://orphan.example" }, "Related to nobody"),
  ]);

  const titlesFor = (slug: string) =>
    groupByProfile(rows, profiles)
      .find((p) => p.profile.slug === slug)
      ?.rows.map((r) => r.title);

  it("puts an Everyone row on every page", () => {
    expect(titlesFor("alex")).toEqual(["Everyone", "Everyone and related"]);
  });

  it("counts a row that is both Everyone and related once", () => {
    expect(titlesFor("shifra")).toEqual(["Shifra only", "Everyone", "Everyone and related"]);
  });

  it("renders a row related to nobody nowhere", () => {
    expect(titlesFor("shifra")).not.toContain("Related to nobody");
    expect(titlesFor("alex")).not.toContain("Related to nobody");
  });
});

describe("toIconName", () => {
  it("maps a dropdown option to its filename, case-insensitively", () => {
    expect(toIconName("workflows")).toBe("workflows");
    expect(toIconName("Upload")).toBe("upload");
    expect(toIconName("  form  ")).toBe("form");
  });

  it("falls back to arrow for an empty cell or an unknown option", () => {
    expect(toIconName(null)).toBe("arrow");
    expect(toIconName("")).toBe("arrow");
    expect(toIconName("workflow")).toBe("arrow");
    expect(toIconName(42)).toBe("arrow");
  });
});

describe("unknownIcons", () => {
  it("names every option with no matching file, once each", () => {
    const pages = [
      page({ URL: "https://a.example", Icon: "workflow" }, "A"),
      page({ URL: "https://b.example", Icon: "workflow" }, "B"),
      page({ URL: "https://c.example", Icon: "upload" }, "C"),
      page({ URL: "https://d.example" }, "D"),
    ];
    expect(unknownIcons(pages)).toEqual(["workflow"]);
  });
});

describe("skippedRows", () => {
  const profiles: ProfileRow[] = [
    { id: "profile-shifra", name: "Shifra", slug: "shifra", tagline: "" },
  ];

  it("names the check each row failed", () => {
    const skipped = skippedRows(
      [
        page({ URL: "", Visible: true }, "No URL"),
        page({ URL: "https://a.example", Visible: true }, ""),
        page({ URL: "https://b.example", Visible: false }, "Hidden"),
        page({ URL: "https://c.example" }, "Nobody"),
        page({ URL: "https://d.example", Profiles: ["profile-gone"] }, "Stale relation"),
        page({ URL: "https://e.example", Profiles: ["profile-shifra"] }, "Fine"),
      ],
      profiles,
    );
    expect(skipped.map((row) => [row.title, row.reason])).toEqual([
      ["No URL", "no URL"],
      ["https://a.example", "no Title"],
      ["Hidden", "Visible is unchecked"],
      ["Nobody", "no Profiles relation and Everyone is unchecked"],
      ["Stale relation", "its Profiles relation points at no row in the Profiles database"],
    ]);
  });
});

describe("pagePathsFor", () => {
  it("writes the default profile to the root as well as its slug", () => {
    expect(pagePathsFor("site", "shifra", "shifra")).toEqual([
      "site/shifra/index.html",
      "site/index.html",
    ]);
  });

  it("writes everyone else to their slug only", () => {
    expect(pagePathsFor("site", "alex", "shifra")).toEqual(["site/alex/index.html"]);
  });
});

describe("assertDefaultSlug", () => {
  const profiles: ProfileRow[] = [{ id: "p", name: "Shifra", slug: "shifra", tagline: "" }];

  it("passes when a profile carries the slug", () => {
    expect(() => assertDefaultSlug(profiles, "shifra")).not.toThrow();
  });

  it("names the slug that matches nobody", () => {
    expect(() => assertDefaultSlug(profiles, "nobody")).toThrow(/SITE_DEFAULT_SLUG is "nobody"/);
  });
});

describe("toCard", () => {
  it("carries the description and derives the favicon from the link", () => {
    expect(toCard({ title: "T", url: "https://render.com/docs", icon: "info" }, "D")).toEqual({
      title: "T",
      url: "https://render.com/docs",
      description: "D",
      iconUrl: "https://render.com/favicon.ico",
      icon: "info",
    });
  });
});

describe("faviconUrl", () => {
  it("points at the origin root", () => {
    expect(faviconUrl("https://render.com/tutorials/x")).toBe("https://render.com/favicon.ico");
  });
});
