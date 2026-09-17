// The card icon library. A leaf module: both the Notion reader and the page
// renderer name icons, and neither should have to import the other.
//
// An icon name is the filename without .png under site/assets/link-icons.
// Adding an icon takes a file, a name here, and an option in the Notion
// dropdown; no other code names an icon.
export const ICON_NAMES = [
  "arrow",
  "credits",
  "download",
  "form",
  "info",
  "render",
  "upload",
  "workflows",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/** What a row with an empty or unrecognized Icon cell renders. */
export const DEFAULT_ICON: IconName = "arrow";

export function isIconName(value: string): value is IconName {
  return (ICON_NAMES as readonly string[]).includes(value);
}
