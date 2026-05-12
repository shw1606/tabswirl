// Map Chrome's 9 tab-group colors to Tailwind utility classes for the
// little color dots / accents in the popup.
//
// Ref: https://developer.chrome.com/docs/extensions/reference/api/tabGroups#type-Color

import type { ChromeGroupColor } from "../core/types";

export const COLOR_DOT_CLASS: Record<ChromeGroupColor, string> = {
  grey: "bg-neutral-400",
  blue: "bg-blue-500",
  red: "bg-red-500",
  yellow: "bg-yellow-400",
  green: "bg-emerald-500",
  pink: "bg-pink-400",
  purple: "bg-purple-500",
  cyan: "bg-cyan-500",
  orange: "bg-orange-500",
};
