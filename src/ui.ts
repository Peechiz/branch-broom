/** Row rendering shared by every branch-broom command. */
import { cancel } from "@clack/prompts";
import type { Branch } from "./git.ts";
import { c, stripAnsi } from "./theme.ts";

export const MERGED = "✅"; // white heavy check mark
export const UNMERGED = "\u{1F534}"; // red circle
export const GONE = "\u{1F47B}"; // ghost - remote branch is gone
export const LEGEND = `${MERGED} merged  ${UNMERGED} unmerged  ${GONE} gone`;

/** Above this many branches, swap the plain list for the searchable one. */
export const SEARCH_THRESHOLD = 12;

/** Everything after the branch name; empty unless --verbose. */
export function meta(b: Branch, verbose: boolean): string {
  if (!verbose) return "";
  const ahead = !b.mergedIntoBase && b.aheadOfBase > 0 ? ` ${c.red(`+${b.aheadOfBase}`)}` : "";
  return `${c.dim(b.lastCommitRel)}${ahead}`;
}

/**
 * Pad to a visible column width, always leaving `min` spaces so a long name
 * never butts up against the next column. Bun.stringWidth skips ANSI and
 * counts emoji as the two columns they actually occupy.
 */
export function pad(s: string, width: number, min = 2): string {
  return s + " ".repeat(Math.max(min, width - Bun.stringWidth(s)));
}

/** Width to pad names to, capped so one outlier can't shove every column right. */
export function nameColumn(branches: Branch[]): number {
  return Math.min(40, Math.max(0, ...branches.map((b) => b.name.length)));
}

/** `name  <meta>` with the meta stripped of color on disabled rows. */
export function row(name: string, tail: string, width: number, disabled: boolean): string {
  // Disabled rows get a plain label: clack strikes them through, and our own
  // color resets would cut that styling off mid-line.
  return `${tail ? pad(name, width + 6) : name}${disabled ? stripAnsi(tail) : tail}`;
}

export function bail(message: string): never {
  cancel(message);
  process.exit(1);
}
