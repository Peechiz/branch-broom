#!/usr/bin/env bun
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  multiselect,
  autocompleteMultiselect,
  note,
  outro,
  spinner,
} from "@clack/prompts";
import {
  assertRepo,
  baseBranch,
  mergeTargets,
  configProtectRules,
  deleteBranch,
  listBranches,
  myEmails,
  protectMatcher,
  type Branch,
  type ProtectRule,
} from "./git.ts";
import { c } from "./theme.ts";
import { GONE, LEGEND, MERGED, SEARCH_THRESHOLD, UNMERGED, bail, meta, nameColumn, pad, row } from "./ui.ts";

const HELP = `branch-broom - sweep up local git branches you've worked on

usage: broom [options]

options:
  -a, --all              list every local branch, not just ones you authored
  -m, --merged           only branches already merged into the base or a merge target
  -g, --gone             only branches whose upstream is gone
      --author <email>   count this email as "me" too (repeatable)
      --protect <glob>   never offer branches matching this (repeatable)
      --no-protect       ignore every protect rule except the current branch
      --dry-run          show what would be deleted, delete nothing
  -v, --verbose          add commit date, sha and ahead-count to each row
  -y, --yes              skip the final confirmation
  -h, --help             this text

per-repo protected branches live in git config, not in the repo:
  git config --local  broom.protect 'release/*'   # this clone only
  git config --global broom.protect main          # every repo
  git config --add    broom.protect 'hotfix/*'    # another pattern
patterns are globs (Bun.Glob): * stays inside one path segment, ** crosses.

branches merged into a long-lived remote branch count as merged too:
  git config --local --add broom.target 'fb/*'   # origin/fb/... are merge targets

keys: up/down move, space toggle, enter confirm, esc cancel
      over ${SEARCH_THRESHOLD} branches the list becomes a search box: type to filter,
      tab toggles the highlighted branch, enter confirms
`;

type Opts = {
  all: boolean;
  mergedOnly: boolean;
  goneOnly: boolean;
  authors: string[];
  protect: string[];
  noProtect: boolean;
  dryRun: boolean;
  yes: boolean;
  verbose: boolean;
};

function parseArgs(argv: string[]): Opts {
  const o: Opts = {
    all: false,
    mergedOnly: false,
    goneOnly: false,
    authors: [],
    protect: [],
    noProtect: false,
    dryRun: false,
    yes: false,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help":
        process.stdout.write(HELP);
        process.exit(0);
      case "-a":
      case "--all":
        o.all = true;
        break;
      case "-m":
      case "--merged":
        o.mergedOnly = true;
        break;
      case "-g":
      case "--gone":
        o.goneOnly = true;
        break;
      case "--author":
        o.authors.push(argv[++i] ?? "");
        break;
      case "--protect":
        o.protect.push(argv[++i] ?? "");
        break;
      case "--no-protect":
        o.noProtect = true;
        break;
      case "--dry-run":
        o.dryRun = true;
        break;
      case "-y":
      case "--yes":
        o.yes = true;
        break;
      case "-v":
      case "--verbose":
        o.verbose = true;
        break;
      default:
        throw new Error(`unknown option: ${a}\n\n${HELP}`);
    }
  }
  o.authors = o.authors.filter(Boolean);
  o.protect = o.protect.filter(Boolean);
  return o;
}

const DEFAULT_PROTECTED: ProtectRule[] = [
  "main",
  "master",
  "develop",
  "development",
  "trunk",
].map((pattern) => ({ pattern, source: "default" as const }));

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  assertRepo();

  intro(c.title(" branch-broom "));

  const scan = spinner();
  scan.start("scanning local branches");
  const base = baseBranch();
  const emails = opts.all ? [] : myEmails(opts.authors);
  let branches = listBranches(base, emails, mergeTargets(base));
  scan.stop(
    `${branches.length} local branch${branches.length === 1 ? "" : "es"}  ${c.dim(
      `base: ${base ?? "none"} · ${opts.all ? "all authors" : emails.join(", ") || "you"}`,
    )}`,
  );

  const hidden = opts.all ? [] : branches.filter((b) => !b.minePersonally && !b.isCurrent);
  if (!opts.all) branches = branches.filter((b) => b.minePersonally || b.isCurrent);
  if (hidden.length && opts.verbose) {
    log.info(
      c.dim(
        `hidden, authored by someone else (-a shows them):\n${hidden
          .map((b) => `  ${b.name} - ${b.authorEmail}`)
          .join("\n")}`,
      ),
    );
  }
  if (opts.mergedOnly) branches = branches.filter((b) => b.mergedInto || b.isCurrent);
  if (opts.goneOnly) branches = branches.filter((b) => b.upstreamGone || b.isCurrent);

  const rules: ProtectRule[] = opts.noProtect
    ? []
    : [
        ...DEFAULT_PROTECTED,
        ...configProtectRules(),
        ...opts.protect.map((pattern) => ({ pattern, source: "--protect" as const })),
      ];
  const protectedBy = protectMatcher(rules);
  const fromConfig = rules.filter((r) => r.source === "git config");
  if (fromConfig.length && opts.verbose) {
    log.info(c.dim(`protected by git config: ${fromConfig.map((r) => r.pattern).join(", ")}`));
  }
  if (opts.noProtect) log.warn(c.yellow("--no-protect: only the current branch is off limits"));

  const byName = new Map(branches.map((b) => [b.name, b]));
  const selectable = branches.filter((b) => !b.isCurrent && !protectedBy(b.name));

  if (selectable.length === 0) {
    outro(c.dim("no candidate branches - nothing to sweep."));
    return;
  }

  const nameWidth = nameColumn(branches);

  const options = branches.map((b) => {
    const rule = protectedBy(b.name);
    const disabled = b.isCurrent || rule !== null;
    // Say why a row is struck through: the strikethrough alone reads as an error.
    const why = b.isCurrent ? " (current branch)" : rule ? " (protected)" : "";
    const name = `${b.mergedInto ? MERGED : UNMERGED} ${b.name}${b.upstreamGone ? ` ${GONE}` : ""}${why}`;
    const tail = meta(b, opts.verbose);
    return {
      value: b.name,
      label: row(name, tail, nameWidth, disabled),
      // Hints show on the highlighted row. Keep them for the one case where
      // they say something the label cannot: which rule protected the branch.
      // Commit details are noise here, so they wait for --verbose.
      hint: b.isCurrent
        ? undefined
        : rule
          ? `${rule.source}: ${rule.pattern}`
          : opts.verbose
            ? `${b.sha} ${b.subject}`
            : undefined,
      disabled,
    };
  });

  const prompt = branches.length > SEARCH_THRESHOLD ? autocompleteMultiselect : multiselect;
  const picked = await prompt({
    message: `select branches to delete ${c.dim(`(${selectable.length} eligible)   ${LEGEND}`)}`,
    options,
    maxItems: 14,
    required: false,
    ...(branches.length > SEARCH_THRESHOLD ? { placeholder: "type to filter…" } : {}),
  });

  if (isCancel(picked)) bail("cancelled - nothing deleted.");

  const chosen = (picked as string[]).map((n) => byName.get(n)!).filter(Boolean);
  if (chosen.length === 0) {
    outro(c.dim("nothing selected."));
    return;
  }

  note(
    chosen
      .map((b) => {
        const name = `${b.mergedInto ? MERGED : UNMERGED} ${b.name}`;
        return opts.verbose
          ? `${pad(name, nameWidth + 6)}${c.dim(`${b.sha}  ${b.lastCommitRel}`)}`
          : name;
      })
      .join("\n"),
    `${chosen.length} branch${chosen.length === 1 ? "" : "es"} to delete`,
  );

  const unmerged = chosen.filter((b) => !b.mergedInto);
  if (unmerged.length) {
    log.warn(
      c.yellow(
        `not merged into ${base ?? "the base branch"} or a broom.target: ${unmerged.map((b) => b.name).join(", ")}`,
      ),
    );
  }

  if (opts.dryRun) {
    outro(c.dim("--dry-run: nothing deleted."));
    return;
  }

  if (!opts.yes) {
    const ok = await confirm({ message: "delete them?", initialValue: false });
    if (isCancel(ok) || !ok) bail("aborted - nothing deleted.");
  }

  const work = spinner();
  work.start("deleting");
  const deleted: Branch[] = [];
  const refused: Branch[] = [];
  const errors: string[] = [];
  for (const b of chosen) {
    work.message(`deleting ${b.name}`);
    const r = deleteBranch(b.name, false);
    if (r.ok) deleted.push(b);
    else if (/not fully merged/i.test(r.out)) refused.push(b);
    else errors.push(`${b.name}: ${r.out}`);
  }
  work.stop(`deleted ${deleted.length} of ${chosen.length}`);

  if (deleted.length) log.success(deleted.map((b) => c.green(b.name)).join("  "));
  for (const e of errors) log.error(c.red(e));

  if (refused.length) {
    log.warn(
      c.yellow(`git refused (unmerged work): ${refused.map((b) => b.name).join(", ")}`),
    );
    let force = opts.yes;
    if (!force) {
      const answer = await confirm({
        message: `force delete ${refused.length} unmerged branch${refused.length === 1 ? "" : "es"}? commits may be lost`,
        initialValue: false,
      });
      force = !isCancel(answer) && answer === true;
    }
    if (force) {
      for (const b of refused) {
        const r = deleteBranch(b.name, true);
        if (r.ok) {
          deleted.push(b);
          log.step(
            `${c.red("force-deleted")} ${b.name}  ${c.dim(`undo: git branch ${b.name} ${b.sha}`)}`,
          );
        } else {
          log.error(c.red(`${b.name}: ${r.out}`));
        }
      }
    } else {
      log.info(c.dim(`kept ${refused.map((b) => b.name).join(", ")}`));
    }
  }

  outro(
    deleted.length
      ? c.green(`swept ${deleted.length} branch${deleted.length === 1 ? "" : "es"}`)
      : c.dim("nothing deleted."),
  );
}

main().catch((err) => {
  cancel(c.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
