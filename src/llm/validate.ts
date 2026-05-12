// Shared response validator for LlmProvider implementations.
//
// Every provider eventually produces a `{ assignments: [...] }` shape
// (Anthropic via tool_use.input, Gemini via functionCall.args, etc).
// The four invariants from CLAUDE.md "Critical invariants" §5 plus a
// duplicate-tab_id check live here so each provider impl just hands
// raw model output over and gets back a typed result.

import type { ChromeGroupColor } from "../core/types";
import type { ClassificationAssignment } from "./prompts";

const ALLOWED_COLORS: ReadonlySet<string> = new Set<ChromeGroupColor>([
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
]);

export type ValidationOutcome =
  | { ok: true; assignments: ClassificationAssignment[] }
  | { ok: false; reason: string };

export function validateAssignments(
  raw: unknown,
  expectedTabIds: ReadonlySet<number>,
): ValidationOutcome {
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray((raw as { assignments?: unknown }).assignments)
  ) {
    return { ok: false, reason: "missing assignments array" };
  }

  const assignments = (raw as { assignments: unknown[] }).assignments;

  if (assignments.length !== expectedTabIds.size) {
    return {
      ok: false,
      reason: `expected ${expectedTabIds.size} assignments, got ${assignments.length}`,
    };
  }

  const seenTabIds = new Set<number>();
  const groupColors = new Map<string, ChromeGroupColor>();
  const result: ClassificationAssignment[] = [];

  for (const a of assignments) {
    if (!a || typeof a !== "object") {
      return { ok: false, reason: "assignment is not an object" };
    }
    const r = a as Record<string, unknown>;

    if (
      typeof r["tab_id"] !== "number" ||
      typeof r["group_name"] !== "string" ||
      typeof r["color"] !== "string" ||
      typeof r["is_new_group"] !== "boolean"
    ) {
      return { ok: false, reason: "assignment field types" };
    }

    const tab_id = r["tab_id"];
    const group_name = r["group_name"];
    const color = r["color"];
    const is_new_group = r["is_new_group"];

    if (!expectedTabIds.has(tab_id)) {
      return { ok: false, reason: `unknown tab_id ${tab_id}` };
    }
    if (seenTabIds.has(tab_id)) {
      return { ok: false, reason: `duplicate tab_id ${tab_id}` };
    }
    seenTabIds.add(tab_id);

    if (!ALLOWED_COLORS.has(color)) {
      return { ok: false, reason: `invalid color "${color}"` };
    }
    const typedColor = color as ChromeGroupColor;

    const existing = groupColors.get(group_name);
    if (existing && existing !== typedColor) {
      return {
        ok: false,
        reason: `group "${group_name}" assigned both ${existing} and ${typedColor}`,
      };
    }
    groupColors.set(group_name, typedColor);

    result.push({ tab_id, group_name, color: typedColor, is_new_group });
  }

  return { ok: true, assignments: result };
}
