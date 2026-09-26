import { describe, expect, it } from "vitest";
import { normalizeUrl } from "../src/url.js";

describe("normalizeUrl", () => {
  it.each([
    ["http://render.com/", "https://render.com/"],
    ["HTTP://render.com/", "https://render.com/"],
    ["https://render.com/", "https://render.com/"],
    ["HTTPS://render.com/", "https://render.com/"],
    ["render.com", "https://render.com"],
    ["render.com/careers", "https://render.com/careers"],
    ["render.com:8080/x", "https://render.com:8080/x"],
    ["  render.com  ", "https://render.com"],
    ["ren\tder.com", "https://render.com"],
    ["mailto:shifra@render.com", "mailto:shifra@render.com"],
    ["MAILTO:shifra@render.com", "mailto:shifra@render.com"],
    ["mailto:", "mailto:"],
    ["ftp://example.com/f", "ftp://example.com/f"],
    ["javascript:alert(1)", "javascript:alert(1)"],
    ["", ""],
    ["   ", ""],
  ])("normalizes %o to %o", (cell, expected) => {
    expect(normalizeUrl(cell)).toBe(expected);
  });

  it("upgrades http without touching the rest of the URL", () => {
    expect(normalizeUrl("http://user@render.com:8080/a/b?q=1#f")).toBe(
      "https://user@render.com:8080/a/b?q=1#f",
    );
  });

  it("is idempotent", () => {
    for (const cell of ["render.com", "http://render.com", "mailto:a@b.com", "ftp://x.com"]) {
      const once = normalizeUrl(cell);
      expect(normalizeUrl(once)).toBe(once);
    }
  });
});
