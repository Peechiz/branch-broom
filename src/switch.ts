#!/usr/bin/env bun
import {
  autocomplete,
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  outro,
  select,
  spinner,
} from "@clack/prompts";
import {
  assertRepo,
  baseBranch,
  mergeTargets,
  dirtyPaths,
  listBranches,
  myEmails,
  stashAll,
  switchBranch,
  type Branch,
} from "./git.ts";
import { c } from "./theme.ts";
import { GONE, LEGEND, MERGED, SEARCH_THRESHOLD, UNMERGED, bail, meta, nameColumn, row } from "./ui.ts";

const HELP = `switch - pick a local git branch and check it out

usage: switch [options] [filter]

  filter                 only list branches whose name contains this
  -                      jump straight back to the previous branch

options:
  -m, --mine             only branches you authored (default: every local branch)
      --author <email>   count this email as "me" too (repeatable, implies -m)
      --merged           only branches already merged into the base or a merge target
      --stash            stash uncommitted changes without asking, if in the way
      --dry-run          show the pick, check nothing out
  -v, --verbose          add commit date, sha and ahead-count to each row
  -h, --help             this text

keys: up/down move, enter confirm, esc cancel
      over ${SEARCH_THRESHOLD} branches the list becomes a search box: type to filter
`;

type Opts = {
  mine: boolean;
  authors: string[];
  mergedOnly: boolean;
  stash: boolean;
  dryRun: boolean;
  verbose: boolean;
  filter: string;
  previous: boolean;
};

function parseArgs(argv: string[]): Opts {
  const o: Opts = {
    mine: false,
    authors: [],
    mergedOnly: false,
    stash: false,
    dryRun: false,
    verbose: false,
    filter: "",
    previous: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    switch (a) {
      case "-h":
      case "--help":
        process.stdout.write(HELP);
        process.exit(0);
      case "-":
        o.previous = true;
        break;
      case "-m":
      case "--mine":
        o.mine = true;
        break;
      case "--author":
        o.authors.push(argv[++i] ?? "");
        o.mine = true;
        break;
      case "--merged":
        o.mergedOnly = true;
        break;
      case "--stash":
        o.stash = true;
        break;
      case "--dry-run":
        o.dryRun = true;
        break;
      case "-v":
      case "--verbose":
        o.verbose = true;
        break;
      default:
        if (a.startsWith("-")) throw new Error(`unknown option: ${a}\n\n${HELP}`);
        if (o.filter) throw new Error(`only one filter, got "${o.filter}" and "${a}"\n\n${HELP}`);
        o.filter = a;
    }
  }
  o.authors = o.authors.filter(Boolean);
  return o;
}

/** Short upstream state, e.g. "↑2 ↓1" or "gone". Empty when in sync or untracked. */
function trackSummary(b: Branch): string {
  if (!b.upstream) return "";
  if (b.upstreamGone) return c.yellow("gone");
  const ahead = /ahead (\d+)/.exec(b.track)?.[1];
  const behind = /behind (\d+)/.exec(b.track)?.[1];
  const parts = [ahead ? `↑${ahead}` : "", behind ? `↓${behind}` : ""].filter(Boolean);
  return parts.length ? c.dim(parts.join(" ")) : "";
}

/** `git switch -`, for when you just want to bounce back. */
function jumpBack(): never {
  const r = switchBranch("-");
  if (!r.ok) bail(r.out || "no previous branch to switch to.");
  outro(c.green(`on ${currentBranch()}`));
  process.exit(0);
}

function currentBranch(): string {
  return listBranches(null, [], []).find((b) => b.isCurrent)?.name ?? "(detached)";
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  assertRepo();

  intro(c.title(" switch "));
  if (opts.previous) jumpBack();

  const scan = spinner();
  scan.start("scanning local branches");
  const base = baseBranch();
  const emails = opts.mine ? myEmails(opts.authors) : [];
  let branches = listBranches(base, emails, mergeTargets(base));
  const total = branches.length;

  if (opts.mine) branches = branches.filter((b) => b.minePersonally || b.isCurrent);
  if (opts.mergedOnly) branches = branches.filter((b) => b.mergedInto || b.isCurrent);
  const needle = opts.filter.toLowerCase();
  if (needle) branches = branches.filter((b) => b.name.toLowerCase().includes(needle) || b.isCurrent);

  const shown = branches.filter((b) => !b.isCurrent).length;
  scan.stop(
    `${shown} of ${total} branch${total === 1 ? "" : "es"}  ${c.dim(
      [`base: ${base ?? "none"}`, opts.mine ? emails.join(", ") || "you" : "all authors", needle && `match: ${opts.filter}`]
        .filter(Boolean)
        .join(" · "),
    )}`,
  );

  const candidates = branches.filter((b) => !b.isCurrent);
  if (candidates.length === 0) {
    outro(c.dim(needle ? `no branch matches "${opts.filter}".` : "no other local branch to switch to."));
    return;
  }

  const dirty = dirtyPaths();
  if (dirty.length) {
    log.warn(c.yellow(`${dirty.length} uncommitted change${dirty.length === 1 ? "" : "s"} in the work tree`));
  }

  const width = nameColumn(branches);
  const options = branches.map((b) => {
    const marks = [b.mergedInto ? MERGED : UNMERGED, b.name, b.upstreamGone ? GONE : ""]
      .filter(Boolean)
      .join(" ");
    const name = `${marks}${b.isCurrent ? " (current branch)" : ""}`;
    const tail = [meta(b, opts.verbose), trackSummary(b)].filter(Boolean).join("  ");
    return {
      value: b.name,
      label: row(name, tail, width, b.isCurrent),
      hint: b.isCurrent ? undefined : opts.verbose ? `${b.sha} ${b.subject}` : undefined,
      disabled: b.isCurrent,
    };
  });

  const message = `switch to ${c.dim(`(${candidates.length} branch${candidates.length === 1 ? "" : "es"})   ${LEGEND}`)}`;
  const picked =
    branches.length > SEARCH_THRESHOLD
      ? await autocomplete({ message, options, maxItems: 14, placeholder: "type to filter…" })
      : await select({ message, options, maxItems: 14, initialValue: candidates[0]!.name });

  if (isCancel(picked) || !picked) bail("cancelled - still on the same branch.");
  const target = picked as string;

  // The current branch is a disabled row, but the search box can still land on
  // it. Saying so beats git's "Already on ..." on a command that did nothing.
  if (branches.some((b) => b.isCurrent && b.name === target)) {
    outro(c.dim(`already on ${target}.`));
    return;
  }

  if (opts.dryRun) {
    outro(c.dim(`--dry-run: would switch to ${target}.`));
    return;
  }

  let r = switchBranch(target);

  // git refuses rather than clobber local edits. Stashing is the only way
  // through that doesn't lose them, so offer it instead of just failing.
  if (!r.ok && /would be overwritten|local changes/i.test(r.out)) {
    log.warn(c.yellow(r.out));
    let stash = opts.stash;
    if (!stash) {
      const answer = await confirm({
        message: "stash your changes and switch?",
        initialValue: false,
      });
      stash = !isCancel(answer) && answer === true;
    }
    if (!stash) bail(`still on ${currentBranch()} - commit or stash first.`);
    const s = stashAll(`switch: auto-stash before ${target}`);
    if (!s.ok) bail(`stash failed:\n${s.out}`);
    log.step(c.dim("stashed your changes - restore with: git stash pop"));
    r = switchBranch(target);
  }

  if (!r.ok) bail(`${target}: ${r.out}`);

  const now = branches.find((b) => b.name === target);
  const where = now?.upstream ? c.dim(`  tracking ${now.upstream}`) : "";
  outro(`${c.green(`on ${target}`)}${where}`);
}

main().catch((err) => {
  cancel(c.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
