// src/llm/prompts.ts
//
// LLM prompts and tool schema for tab classification.
//
// Two modes:
//   1. Initial bulk — classify tabs from scratch (no existing groups)
//   2. Incremental — classify new tabs against existing groups
//
// Output format is forced via Anthropic tool use:
//   - The model can only respond by calling the `classify_tabs` tool.
//   - The tool input is strictly validated against the schema below.
//   - Anything outside the tool call is ignored.
//
// All prompts are in English for model stability; only the *output*
// category names follow the user's language setting.

import type { ChromeGroupColor } from "../core/types";

// ============================================================
// Types
// ============================================================

export interface TabInput {
  id: number;
  title: string;
  domain: string;
}

export interface ExistingGroup {
  name: string;
  color: ChromeGroupColor;
  /** Up to 3 representative tabs to give the model context. */
  sample_tabs: { title: string; domain: string }[];
}

export interface ClassificationAssignment {
  tab_id: number;
  group_name: string;
  color: ChromeGroupColor;
  is_new_group: boolean;
}

/** The exact shape the model returns via the `classify_tabs` tool. */
export interface ClassifyTabsToolInput {
  assignments: ClassificationAssignment[];
}

export type Language = "ko" | "en";

// ============================================================
// Tool schema (Anthropic tool use)
// ============================================================

const ALLOWED_COLORS: readonly ChromeGroupColor[] = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
];

export const CLASSIFY_TABS_TOOL = {
  name: "classify_tabs",
  description:
    "Output the classification of all input tabs into color-coded categories. " +
    "Every input tab MUST appear in `assignments` exactly once.",
  input_schema: {
    type: "object" as const,
    properties: {
      assignments: {
        type: "array",
        description: "One entry per input tab.",
        items: {
          type: "object",
          properties: {
            tab_id: {
              type: "number",
              description: "The id of the tab being assigned (from input).",
            },
            group_name: {
              type: "string",
              description:
                "Short category name (1-2 words, title case). " +
                "When reusing an existing category, this MUST exactly match " +
                "the existing name (case-sensitive).",
            },
            color: {
              type: "string",
              enum: [...ALLOWED_COLORS],
              description:
                "Color for this category. All tabs sharing the same group_name " +
                "MUST be assigned the same color in this response.",
            },
            is_new_group: {
              type: "boolean",
              description:
                "true if group_name is a newly created category, " +
                "false if reusing an existing group from the input context.",
            },
          },
          required: ["tab_id", "group_name", "color", "is_new_group"],
        },
      },
    },
    required: ["assignments"],
  },
} as const;

// ============================================================
// System prompts
// ============================================================

function commonRules(language: Language): string {
  const langName = language === "ko" ? "Korean" : "English";
  return `You are a tab categorizer for a Chrome extension. You group browser tabs into color-coded categories based on their titles and domains.

Output format:
- You MUST respond by calling the \`classify_tabs\` tool exactly once.
- Do not output any text outside the tool call.
- Every input tab must appear in the \`assignments\` array exactly once.

Rules:
1. Use 3-8 categories total across the whole response. Prefer fewer when the tabs are similar.
2. Category names: short (1-2 words), nouns, in Title Case, written in ${langName}.
   Good (English): "Database", "Research", "Frontend", "Shopping", "Communication"
   Good (Korean): "데이터베이스", "리서치", "프론트엔드", "쇼핑"
   Bad: "Things related to databases", "stuff", "tabs1", a full sentence.
3. Tabs in the same category MUST be assigned the same color.
4. Use distinct colors across categories when possible (you have 9 to work with).
5. Allowed colors only: grey, blue, red, yellow, green, pink, purple, cyan, orange.
6. If a tab clearly fits nowhere, put it in a "Misc" category with color "grey".
7. Classify based on the tab's likely *topic*, not just the domain. A GitHub issue about CSS belongs with frontend tabs, not with a generic "GitHub" bucket.`;
}

export function getInitialSystemPrompt(language: Language): string {
  return (
    commonRules(language) +
    `

Mode: INITIAL BULK CLASSIFICATION.
No prior categories exist. Decide a fresh, coherent set of categories that covers all input tabs cleanly. Every assignment in your response will have is_new_group=true.`
  );
}

export function getIncrementalSystemPrompt(language: Language): string {
  return (
    commonRules(language) +
    `

Mode: INCREMENTAL CLASSIFICATION.
Existing categories are already established in this browser window. The user has been using these categories and expects continuity.

You MUST prefer assigning new tabs to existing categories when the topic reasonably matches.
- Only create a new category when no existing one is a sensible fit.
- When reusing an existing category, use its EXACT name (case-sensitive) and the SAME color it currently has (set is_new_group=false).
- When creating a new category, choose a color that does not collide with existing categories if possible (set is_new_group=true).`
  );
}

// ============================================================
// User prompts
// ============================================================

function escapeQuotes(s: string): string {
  return s.replace(/"/g, '\\"');
}

function formatTabList(tabs: TabInput[]): string {
  return tabs
    .map(
      (t, i) =>
        `${i + 1}. id=${t.id} | title="${escapeQuotes(t.title)}" | domain=${t.domain}`,
    )
    .join("\n");
}

export function getInitialUserPrompt(tabs: TabInput[]): string {
  return `Classify the following ${tabs.length} tab(s) into 3-8 categories.

Tabs:
${formatTabList(tabs)}

Call the classify_tabs tool with one assignment per tab.`;
}

export function getIncrementalUserPrompt(
  existingGroups: ExistingGroup[],
  newTabs: TabInput[],
): string {
  const groupsBlock = existingGroups.length
    ? existingGroups
        .map((g) => {
          const samples =
            g.sample_tabs
              .slice(0, 3)
              .map((t) => `${t.title} (${t.domain})`)
              .join("; ") || "(no samples)";
          return `- "${g.name}" (color=${g.color}) — sample tabs: ${samples}`;
        })
        .join("\n")
    : "(no existing groups yet)";

  return `Existing categories in this window:
${groupsBlock}

New tabs to classify:
${formatTabList(newTabs)}

For each new tab, either:
  (a) assign it to an existing category — use the exact name and color, is_new_group=false; or
  (b) create a new category — is_new_group=true.

Strongly prefer (a) when the topic reasonably fits.`;
}

// ============================================================
// Suggested model + sampling parameters
// ============================================================

export const LLM_DEFAULTS = {
  model: "claude-haiku-4-5",
  max_tokens: 2048,
  /**
   * Low temperature for consistent categorization.
   * Slight non-zero to avoid pathological tie-breaking.
   */
  temperature: 0.2,
} as const;
