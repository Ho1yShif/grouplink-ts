// loadConfig reads only the env it is handed, so each case passes its own.
import { describe, expect, it } from "vitest";
import { envInt, loadConfig } from "../src/config.js";

const ENV = {
  NOTION_LINKS_DATABASE_ID: "db_links",
  NOTION_PROFILES_DATABASE_ID: "db_profiles",
  SITE_DEFAULT_SLUG: "shifra",
};

const load = (extra: Record<string, string> = {}) => loadConfig({}, { ...ENV, ...extra });

describe("loadConfig", () => {
  it("defaults dryRun to false, so a run publishes unless it is held back", () => {
    expect(load().dryRun).toBe(false);
  });

  it("reads DRY_RUN whatever the casing and spacing", () => {
    for (const value of ["false", "False", "FALSE", " off ", "no", "0"]) {
      expect(load({ DRY_RUN: value }).dryRun, value).toBe(false);
    }
    for (const value of ["true", "TRUE", "1", "yes"]) {
      expect(load({ DRY_RUN: value }).dryRun, value).toBe(true);
    }
  });

  it("falls back when DRY_RUN is empty or whitespace", () => {
    expect(load({ DRY_RUN: "" }).dryRun).toBe(false);
    expect(load({ DRY_RUN: "   " }).dryRun).toBe(false);
  });

  it("prefers the run input over the env", () => {
    expect(loadConfig({ dryRun: false }, { ...ENV, DRY_RUN: "true" }).dryRun).toBe(false);
  });

  it("lowercases and trims the default slug", () => {
    expect(load({ SITE_DEFAULT_SLUG: " Shifra " }).defaultSlug).toBe("shifra");
  });

  it("names the variable that is missing", () => {
    expect(() => loadConfig({}, {})).toThrow(/NOTION_LINKS_DATABASE_ID/);
    expect(() => loadConfig({}, { NOTION_LINKS_DATABASE_ID: "x" })).toThrow(
      /NOTION_PROFILES_DATABASE_ID/,
    );
    expect(() => loadConfig({}, { ...ENV, SITE_DEFAULT_SLUG: "" })).toThrow(/SITE_DEFAULT_SLUG/);
  });
});

describe("envInt", () => {
  it("falls back when the variable is unset, empty, or whitespace", () => {
    expect(envInt("LINKS_LIMIT", undefined, 100)).toBe(100);
    expect(envInt("LINKS_LIMIT", "", 100)).toBe(100);
    expect(envInt("LINKS_LIMIT", "  ", 100)).toBe(100);
  });

  it("reads a whole number, with or without surrounding space", () => {
    expect(envInt("LINKS_LIMIT", "25", 100)).toBe(25);
    expect(envInt("LINKS_LIMIT", " 25 ", 100)).toBe(25);
  });

  it("names the variable it rejects", () => {
    expect(() => envInt("LINKS_LIMIT", "-5", 100)).toThrow(/LINKS_LIMIT/);
  });

  it("rejects anything that is not a whole number of 1 or more", () => {
    for (const value of ["-5", "0", "10abc", "1e3", "2.5", "+5", "abc", "9".repeat(20)]) {
      expect(() => envInt("LINKS_LIMIT", value, 100), value).toThrow();
    }
  });
});
