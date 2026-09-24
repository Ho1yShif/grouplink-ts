import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { escapeHtml, renderPage, safeUrl, type PageModel } from "../src/render.js";
import { ICON_NAMES } from "../src/icons.js";

const model: PageModel = {
  name: "Render",
  tagline: "Cloud application hosting for developers.",
  cards: [
    {
      title: "First",
      url: "https://example.com/a",
      description: "A",
      iconUrl: "https://example.com/favicon.ico",
      icon: "workflows",
    },
    { title: "Second", url: "https://example.com/b", description: "", iconUrl: "", icon: "arrow" },
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
      cards: [
        {
          title: "<script>alert(1)</script>",
          url: "https://example.com",
          description: 'a "b" & c',
          iconUrl: "",
          icon: "arrow",
        },
      ],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("a &quot;b&quot; &amp; c");
  });

  it("drops a javascript: href", () => {
    const html = renderPage({
      ...model,
      cards: [
        { title: "Bad", url: "javascript:alert(1)", description: "", iconUrl: "", icon: "arrow" },
      ],
    });
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="#"');
  });

  it("renders a mailto: card with the address as its target", () => {
    const html = renderPage({
      ...model,
      cards: [
        {
          title: "Email",
          url: "mailto:shifra@render.com",
          description: "",
          iconUrl: "",
          icon: "email",
        },
      ],
    });
    expect(html).toContain('href="mailto:shifra@render.com"');
    expect(html).toContain('<span class="card__target">mailto:shifra@render.com</span>');
    expect(html).not.toContain('class="card__icon"');
  });

  it("keeps the tagline out of the page and on one line in the metadata", () => {
    const html = renderPage({ ...model, tagline: "First half\nsecond half" });
    expect(html).not.toContain('class="tagline"');
    expect(html).toContain('<meta name="description" content="First half second half">');
  });

  it("always renders the same icon row, whatever the model holds", () => {
    expect(renderPage(model)).toContain('class="social__icon social__icon--github"');
  });

  it("draws each card's icon and no index number", () => {
    const html = renderPage(model);
    expect(html).toContain('class="card__mark card__mark--workflows"');
    expect(html).toContain('class="card__mark card__mark--arrow"');
    expect(html).not.toContain("card__index");
    expect(html).not.toContain(">01<");
  });

  it("declares a mask rule for every icon in the library", () => {
    const html = renderPage(model);
    for (const name of ICON_NAMES) {
      expect(html).toContain(
        `.card__mark--${name} { --mark: url('/assets/link-icons/${name}.png'); }`,
      );
    }
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

  it("passes a mailto: link through", () => {
    expect(safeUrl("mailto:shifra@render.com")).toBe("mailto:shifra@render.com");
    expect(safeUrl("MAILTO:Shifra@Render.com")).toBe("mailto:Shifra@Render.com");
    expect(safeUrl("mailto:a@b.com,c@d.com")).toBe("mailto:a@b.com,c@d.com");
    expect(safeUrl("mailto:")).toBe("#");
  });
});
