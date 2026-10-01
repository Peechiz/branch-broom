# branch-broom

Two interactive pickers over your local git branches, sharing one list renderer:

- **`broom`** - cleanup. Lists only branches you authored (not everything on the remote), lets you multi-select, and deletes them.
- **`switch`** - navigation. Lists your local branches and checks out the one you pick.

## Setup on a new machine

Needs [Bun](https://bun.sh) 1.4+

```bash
// clone the repo somewhere, cd in
bun install
bun link                                     # puts `broom` on your PATH
```

`bun link` symlinks `~/.bun/bin/broom` and `~/.bun/bin/switch` at `src/cli.ts` and `src/switch.ts`, so they run from source and pick up edits with no rebuild step. That directory is already on your PATH if you installed Bun the normal way; if `broom` isn't found, add `export PATH="$HOME/.bun/bin:$PATH"` to your shell profile.

Check it:

```bash
broom --help
cd ~/some/git/repo && broom --dry-run        # lists branches, deletes nothing
switch --dry-run                             # lists branches, checks out nothing
```

**Prefer standalone binaries?** `bun run build` compiles `./broom` and `./switch`, self-contained executables with Bun and the deps baked in — copy them anywhere on your PATH and the checkout stops mattering. Both are gitignored, so a fresh clone always builds its own.

**Uninstall:** `bun unlink` in the checkout, or `rm ~/.bun/bin/broom ~/.bun/bin/switch`.

**Name clash?** `switch` is a common word. `type switch` tells you if something already owns it; rename the bin in `package.json` (say to `sw`) and re-run `bun link` if so.

### Bring your protect rules along

Protect rules live in git config (see [Protected branches](#protected-branches)), so they don't travel with this repo. On the new machine:

```bash
git config --global --add broom.protect main            # global default
cd ~/path/to/some/repo
git config --local --add broom.protect DEVELOP          # per-clone rule
```

Copy your current ones with `git config --global --get-all broom.protect` on the old machine.

## Run broom

```
broom              # in any git repo
broom --dry-run    # see the list, delete nothing
broom -v           # add dates, shas and ahead-counts
```

Or without installing: `bun run /path/to/branch-broom/src/cli.ts`

## Run switch

```
switch             # pick a branch, check it out
switch feat        # only list branches whose name contains "feat"
switch -           # straight back to the previous branch, no prompt
switch -v          # add dates, shas and ahead/behind counts
```

Unlike `broom`, `switch` lists **every** local branch by default - checking out someone else's branch is normal, deleting it isn't. `-m/--mine` narrows it to branches you authored. Protect rules don't apply either; nothing here is destructive.

If uncommitted changes would be clobbered by the checkout, git refuses and `switch` offers to `git stash push --include-untracked` and retry, printing the `git stash pop` to get them back. `--stash` skips the question.

```
-m, --mine             only branches you authored (default: every local branch)
    --author <email>   count another email as "me" (repeatable, implies -m)
    --merged           only branches merged into the base branch
    --stash            stash blocking changes without asking
    --dry-run          print the pick, check nothing out
-v, --verbose          add commit date, sha and ahead-count to each row
```

## Keys

Prompts are [@clack/prompts](https://github.com/bombshell-dev/clack). Up to 12 branches you get the plain list; above that both commands switch to the searchable one automatically. `switch` is single-select, so it has no toggle key - `enter` on the highlighted row checks it out.

| key              | plain list | search list (13+ branches)    |
| ---------------- | ---------- | ----------------------------- |
| `↑`/`↓`          | move       | move                          |
| `space`          | toggle     | types a space into the search |
| `tab`            | —          | toggle highlighted            |
| letters          | —          | filter                        |
| `enter`          | confirm    | confirm                       |
| `esc` / `ctrl-c` | cancel     | cancel                        |

## broom options

```
-a, --all              every local branch, not just ones you authored
-m, --merged           only branches merged into the base branch
-g, --gone             only branches whose upstream is gone
    --author <email>   count another email as "me" (repeatable)
    --protect <glob>   never offer branches matching this (repeatable)
    --no-protect       ignore every protect rule except the current branch
    --dry-run          print what would be deleted, delete nothing
-v, --verbose          add commit date, sha and ahead-count to each row
-y, --yes              skip confirmation (and auto-force unmerged deletes)
```

<a id="protected-branches"></a>

## Protected branches

Per-repo rules live in git config, never in the repo tree:

```
git config --local  broom.protect 'release/*'    # this clone only
git config --global broom.protect main           # every repo
git config --add    broom.protect 'hotfix/*'     # add another pattern
git config --get-all broom.protect               # see what applies here
```

Git layers `--system` → `--global` → `.git/config` on its own, so a global default plus a per-clone addition just works, and nothing is committed. A single value can also hold a comma- or space-separated list. Want rules for every repo under a directory? Use git's own `includeIf "gitdir:~/work/"` in `~/.gitconfig`.

Patterns are globs via `Bun.Glob`: `*` stays inside one path segment (`release/*` matches `release/2026.9`, not `release/a/b`), `**` crosses them. Matching is case-sensitive, so `DEVELOP` and `develop` are different branches.

Protected rows stay visible in the list, struck through, with a hint saying which rule caught them. `--no-protect` drops every rule for one run; the current branch is never deletable.

## Merge targets

By default a branch counts as merged only once it reaches the base branch. If you merge PRs into long-lived feature or release branches first, list them as merge targets:

```
git config --local --add broom.target 'fb/*'        # origin/fb/... count
git config --local --add broom.target 'release/*'
```

Globs match remote branch names without the remote (`fb/*` matches `origin/fb/RENT-123-thing`) and are layered across config scopes like `broom.protect`. A branch's own remote copy never counts. With `-v`, rows merged into a target rather than the base show `→ <target>`.

## Behavior

- **"Worked on by me"** = you authored the branch tip, or you authored any commit on the branch that isn't on the base branch, or the branch has nothing ahead of the base at all. That last case matters: once your work is merged, the branch has no unique commits to attribute and its tip is whatever base commit it sits on - often someone else's merge - so authorship can't be judged and the branch is shown rather than hidden. Run with `-v` to see which branches were hidden and who authored them. Base branch is `origin/HEAD`, falling back to `origin/main`, `origin/master`, `main`, `master`, `develop`.
- Built-in protected names: `main`, `master`, `develop`, `development`, `trunk`, plus anything from `broom.protect` and `--protect`.
- Each row is `✅` merged into base or a [merge target](#merge-targets), or `🔴` not merged, plus `👻` when the upstream branch is gone. `-v` adds the commit date and `+N` unmerged commit count; without it rows are just status and name.
- Current branch and protected names stay in the list as struck-through disabled rows, so you can see them without being able to pick them.
- Deletes with `git branch -d`. Anything git refuses as unmerged is collected and offered as a second `-D` pass, and the sha is printed so you can `git branch <name> <sha>` to undo.
- `switch` checks out with `git switch` (git 2.23+) and shows the upstream it tracks when it lands. `switch -` is `git switch -`.

## Colors

`src/theme.ts` holds the whole palette as hex and runs it through `Bun.color(hex, "ansi")`, so it degrades to whatever depth the terminal reports. Colors turn off when stdout is not a TTY or `NO_COLOR` is set.

## Develop

```
bun run src/cli.ts --dry-run      # run broom from source
bun run src/switch.ts --dry-run   # run switch from source
bunx tsc --noEmit                 # typecheck
bun run build                     # compile ./broom and ./switch binaries
```

Row rendering (icons, legend, column padding, the 12-branch search threshold) lives in `src/ui.ts` so both commands stay in sync; git plumbing is `src/git.ts`.
