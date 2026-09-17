import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { escapeHtml, renderPage, safeUrl, type PageModel } from "../src/render.js";
import {
  faviconUrl,
  groupByPerson,
  toLinkRows,
  visibleRows,
} from "../src/links.js";
import type { PageDTO } from "@render-lab/tasks-notion";

const model: PageModel = {
  name: "Render",
  tagline: "Cloud application hosting for developers.",
  cards: [
    { title: "First", url: "https://example.com/a", description: "A", iconUrl: "https://example.com/favicon.ico" },
    { title: "Second", url: "https://example.com/b", description: "", iconUrl: "" },
  ],
};

describe("renderPage", () => {
  it("emits every card in model order", () => {
    const html = renderPage(model);
    expect(html.indexOf("First")).toBeLessThan(html.indexOf("Second"));
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain('href="https://x.com/render"');
  });

  it("omits the description paragraph when there is no description", () => {
    expect(renderPage(model).match(/class="card__desc"/g)).toHaveLength(1);
  });

  it("escapes titles and descriptions", () => {
    const html = renderPage({
      ...model,
      cards: [{ title: '<script>alert(1)</script>', url: "https://example.com", description: 'a "b" & c', iconUrl: "" }],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("a &quot;b&quot; &amp; c");
  });

  it("drops a javascript: href", () => {
    const html = renderPage({
      ...model,
      cards: [{ title: "Bad", url: "javascript:alert(1)", description: "", iconUrl: "" }],
    });
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="#"');
  });

  it("keeps the tagline out of the page and on one line in the metadata", () => {
    const html = renderPage({ ...model, tagline: "First half\nsecond half" });
    expect(html).not.toContain('class="tagline"');
    expect(html).toContain('<meta name="description" content="First half second half">');
  });

  it("always renders the same icon row, whatever the model holds", () => {
    expect(renderPage(model)).toContain('class="social__icon social__icon--github"');
  });

  it("declares both color schemes and no bold weight", () => {
    const html = renderPage(model);
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain("prefers-reduced-motion");
    expect(html).not.toMatch(/font-weight:\s*(600|700|800|900|bold)/);
  });
});

describe("content security policy", () => {
  function firstGroup(pattern: RegExp, html: string, what: string): string {
    const group = pattern.exec(html)?.[1];
    if (group === undefined) throw new Error(`expected ${what} in the page`);
    return group;
  }

  function inlineBlock(html: string, tag: "style" | "script"): string {
    return firstGroup(
      new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`),
      html,
      `one inline <${tag}> block`,
    );
  }

  function policy(html: string): string {
    return firstGroup(
      /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/,
      html,
      "a CSP meta tag",
    );
  }

  function sha256(content: string): string {
    return `sha256-${createHash("sha256").update(content, "utf8").digest("base64")}`;
  }

  it("allows the inline style and script blocks it actually emits", () => {
    const html = renderPage(model);
    const csp = policy(html);
    expect(csp).toContain(`style-src '${sha256(inlineBlock(html, "style"))}'`);
    expect(csp).toContain(`script-src '${sha256(inlineBlock(html, "script"))}'`);
  });

  it("allows the site's own images, so the logo renders over http too", () => {
    expect(policy(renderPage(model))).toContain("img-src 'self' https:");
  });

  it("emits no inline event handlers, which no hash can allow", () => {
    expect(renderPage(model)).not.toMatch(/\son[a-z]+=/);
  });
});

describe("escapeHtml / safeUrl", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("passes http and https through and rejects everything else", () => {
    expect(safeUrl("https://render.com/")).toBe("https://render.com/");
    expect(safeUrl("data:text/html,x")).toBe("#");
    expect(safeUrl("not a url")).toBe("#");
  });
});

describe("faviconUrl", () => {
  it("points at the origin root", () => {
    expect(faviconUrl("https://render.com/tutorials/x")).toBe("https://render.com/favicon.ico");
  });
});

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

});

describe("groupByPerson", () => {
  const people = [
    { id: "person-shifra", name: "Shifra", slug: "shifra", tagline: "" },
    { id: "person-alex", name: "Alex", slug: "alex", tagline: "" },
  ];

  const rows = toLinkRows([
    page({ URL: "https://shared.example", People: ["person-shifra"] }, "Shifra only"),
    page({ URL: "https://all.example", Everyone: true }, "Everyone"),
    page(
      { URL: "https://both.example", Everyone: true, People: ["person-shifra"] },
      "Everyone and related",
    ),
    page({ URL: "https://orphan.example" }, "Related to nobody"),
  ]);

  const titlesFor = (slug: string) =>
    groupByPerson(rows, people)
      .find((p) => p.person.slug === slug)
      ?.rows.map((r) => r.title);

  it("puts an Everyone row on every page", () => {
    expect(titlesFor("alex")).toEqual(["Everyone", "Everyone and related"]);
  });

  it("counts a row that is both Everyone and related once", () => {
    expect(titlesFor("shifra")).toEqual([
      "Shifra only",
      "Everyone",
      "Everyone and related",
    ]);
  });

  it("renders a row related to nobody nowhere", () => {
    expect(titlesFor("shifra")).not.toContain("Related to nobody");
    expect(titlesFor("alex")).not.toContain("Related to nobody");
  });
});
