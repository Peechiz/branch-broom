import { spawnSync } from "node:child_process";

export type Branch = {
  name: string;
  sha: string;
  subject: string;
  lastCommitISO: string;
  lastCommitRel: string;
  authorEmail: string;
  isCurrent: boolean;
  upstream: string;
  /** Raw `%(upstream:track)`, e.g. "[ahead 2, behind 1]" or "" when in sync. */
  track: string;
  upstreamGone: boolean;
  mergedIntoBase: boolean;
  aheadOfBase: number;
  minePersonally: boolean;
};

export function git(args: string[], cwd = process.cwd()): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${(r.stderr || "").trim()}`);
  }
  return (r.stdout || "").trim();
}

export function gitTry(args: string[], cwd = process.cwd()): { ok: boolean; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    ok: r.status === 0,
    out: ((r.stdout || "") + (r.stderr || "")).trim(),
  };
}

export function assertRepo() {
  const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  if (r.status !== 0 || (r.stdout || "").trim() !== "true") {
    throw new Error("not inside a git work tree");
  }
}

/** Identities that count as "me": git config identity + any extras. */
export function myEmails(extra: string[] = []): string[] {
  const set = new Set<string>();
  for (const key of ["user.email"]) {
    const r = spawnSync("git", ["config", "--get", key], { encoding: "utf8" });
    if (r.status === 0) set.add((r.stdout || "").trim().toLowerCase());
  }
  for (const e of extra) set.add(e.toLowerCase());
  set.delete("");
  return [...set];
}

/** Best guess at the trunk branch, used for merged/ahead calculations. */
export function baseBranch(): string | null {
  const head = gitTry(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (head.ok && head.out) return head.out; // e.g. origin/main
  for (const c of ["origin/main", "origin/master", "main", "master", "develop"]) {
    if (gitTry(["rev-parse", "--verify", "--quiet", c]).ok) return c;
  }
  return null;
}

const SEP = "\x1f";

export function listBranches(base: string | null, emails: string[]): Branch[] {
  const fmt = [
    "%(refname:short)",
    "%(objectname)",
    "%(HEAD)",
    "%(upstream:short)",
    "%(upstream:track)",
    "%(committerdate:iso8601)",
    "%(committerdate:relative)",
    "%(authoremail)",
    "%(contents:subject)",
  ].join(SEP);

  const raw = git(["for-each-ref", "--sort=-committerdate", `--format=${fmt}`, "refs/heads"]);
  if (!raw) return [];

  const mergedSet = new Set(
    base
      ? git(["branch", "--format=%(refname:short)", "--merged", base]).split("\n").filter(Boolean)
      : [],
  );

  return raw.split("\n").map((line) => {
    const f = line.split(SEP);
    const [name, sha, head, upstream, track, iso, rel, authorEmailRaw, subject] = [
      f[0] ?? "", f[1] ?? "", f[2] ?? "", f[3] ?? "", f[4] ?? "", f[5] ?? "", f[6] ?? "", f[7] ?? "", f[8] ?? "",
    ];
    const authorEmail = authorEmailRaw.replace(/^<|>$/g, "").toLowerCase();

    let aheadOfBase = 0;
    if (base) {
      const c = gitTry(["rev-list", "--count", `${base}..${name}`]);
      if (c.ok) aheadOfBase = Number(c.out) || 0;
    }

    return {
      name,
      sha: (sha || "").slice(0, 7),
      subject: subject || "",
      lastCommitISO: iso || "",
      lastCommitRel: rel || "",
      authorEmail,
      isCurrent: head === "*",
      upstream: upstream || "",
      track: track || "",
      upstreamGone: (track || "").includes("gone"),
      mergedIntoBase: mergedSet.has(name),
      aheadOfBase,
      minePersonally: mine(name, base, emails, authorEmail, aheadOfBase),
    };
  });
}

/**
 * "Worked on by me" = I authored the tip, or I authored any commit on this
 * branch but not on the trunk.
 *
 * A branch with nothing ahead of the trunk counts too: its commits are already
 * merged, so there is no unique history left to attribute, and the tip is
 * whatever trunk commit it happens to sit on - often someone else's merge.
 * Those stale pointers are the whole point of the tool, so never hide them.
 */
function mine(
  name: string,
  base: string | null,
  emails: string[],
  tipAuthor: string,
  aheadOfBase: number,
): boolean {
  if (emails.length === 0) return true;
  if (emails.includes(tipAuthor)) return true;
  if (!base) return false;
  if (aheadOfBase === 0) return true;
  const args = ["log", "--max-count=1", "--format=%H", `${base}..${name}`];
  for (const e of emails) args.push(`--author=${e}`);
  const r = gitTry(args);
  return r.ok && r.out.length > 0;
}

export type ProtectRule = {
  pattern: string;
  source: "default" | "git config" | "--protect";
};

/**
 * Protected patterns from `broom.protect` in git config. Multi-valued and
 * layered by git itself: --system, then --global, then this clone's
 * .git/config, so per-repo rules live outside the repo's tree.
 * A single value may also hold a comma/space separated list.
 */
export function configProtectRules(): ProtectRule[] {
  const r = gitTry(["config", "--get-all", "broom.protect"]);
  if (!r.ok || !r.out) return [];
  return r.out
    .split("\n")
    .flatMap((line) => line.split(/[,\s]+/))
    .map((p) => p.trim())
    .filter(Boolean)
    .map((pattern) => ({ pattern, source: "git config" as const }));
}

/** Match a branch name against protect rules; returns the first rule that hits. */
export function protectMatcher(rules: ProtectRule[]): (name: string) => ProtectRule | null {
  const compiled = rules.map((rule) => ({ rule, glob: new Bun.Glob(rule.pattern) }));
  return (name: string) => {
    for (const { rule, glob } of compiled) {
      if (rule.pattern === name || glob.match(name)) return rule;
    }
    return null;
  };
}

export function deleteBranch(name: string, force: boolean): { ok: boolean; out: string } {
  return gitTry(["branch", force ? "-D" : "-d", name]);
}

export function switchBranch(name: string): { ok: boolean; out: string } {
  return gitTry(["switch", name]);
}

/** Paths with uncommitted changes, untracked files included. */
export function dirtyPaths(): string[] {
  const r = gitTry(["status", "--porcelain"]);
  if (!r.ok || !r.out) return [];
  return r.out.split("\n").filter(Boolean);
}

/** Stash everything, untracked included, so a blocked switch can go through. */
export function stashAll(message: string): { ok: boolean; out: string } {
  return gitTry(["stash", "push", "--include-untracked", "-m", message]);
}
