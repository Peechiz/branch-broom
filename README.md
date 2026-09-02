# branch-broom

Interactive cleanup for the local git branches you've worked on. Lists only branches you authored (not everything on the remote), lets you multi-select, and deletes them.

## Setup on a new machine

Needs [Bun](https://bun.sh) 1.4+ and git. Nothing else — no global npm packages, no Node.

```bash
curl -fsSL https://bun.sh/install | bash     # skip if bun is already installed
git clone <this-repo> ~/src/branch-broom
cd ~/src/branch-broom
bun install                                  # @clack/prompts + types
bun link                                     # puts `broom` on your PATH
```

`bun link` symlinks `~/.bun/bin/broom` at `src/cli.ts`, so it runs from source and picks up edits with no rebuild step. That directory is already on your PATH if you installed Bun the normal way; if `broom` isn't found, add `export PATH="$HOME/.bun/bin:$PATH"` to your shell profile.

Check it:

```bash
broom --help
cd ~/some/git/repo && broom --dry-run        # lists branches, deletes nothing
```

**Prefer a standalone binary?** `bun run build` compiles `./broom`, a single self-contained executable with Bun and the deps baked in — copy it anywhere on your PATH and the checkout stops mattering. It's gitignored, so a fresh clone always builds its own.

**Uninstall:** `bun unlink` in the checkout, or `rm ~/.bun/bin/broom`.

### Bring your protect rules along

Protect rules live in git config (see [Protected branches](#protected-branches)), so they don't travel with this repo. On the new machine:

```bash
git config --global --add broom.protect main            # global default
cd ~/path/to/some/repo
git config --local --add broom.protect DEVELOP          # per-clone rule
```

Copy your current ones with `git config --global --get-all broom.protect` on the old machine.

## Run

```
broom              # in any git repo
broom --dry-run    # see the list, delete nothing
broom -v           # add dates, shas and ahead-counts
```

Or without installing: `bun run /path/to/branch-broom/src/cli.ts`

## Keys

Prompts are [@clack/prompts](https://github.com/bombshell-dev/clack). Up to 12 branches you get the plain checkbox list; above that it switches to the searchable one automatically.

| key | plain list | search list (13+ branches) |
|---|---|---|
| `↑`/`↓` | move | move |
| `space` | toggle | types a space into the search |
| `tab` | — | toggle highlighted |
| letters | — | filter |
| `enter` | confirm | confirm |
| `esc` / `ctrl-c` | cancel | cancel |

## Options

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

## Behavior

- **"Worked on by me"** = you authored the branch tip, or you authored any commit on the branch that isn't on the base branch, or the branch has nothing ahead of the base at all. That last case matters: once your work is merged, the branch has no unique commits to attribute and its tip is whatever base commit it sits on - often someone else's merge - so authorship can't be judged and the branch is shown rather than hidden. Run with `-v` to see which branches were hidden and who authored them. Base branch is `origin/HEAD`, falling back to `origin/main`, `origin/master`, `main`, `master`, `develop`.
- Built-in protected names: `main`, `master`, `develop`, `development`, `trunk`, plus anything from `broom.protect` and `--protect`.
- Each row is `✅` merged into base or `🔴` not merged, plus `👻` when the upstream branch is gone. `-v` adds the commit date and `+N` unmerged commit count; without it rows are just status and name.
- Current branch and protected names stay in the list as struck-through disabled rows, so you can see them without being able to pick them.
- Deletes with `git branch -d`. Anything git refuses as unmerged is collected and offered as a second `-D` pass, and the sha is printed so you can `git branch <name> <sha>` to undo.

## Colors

`src/theme.ts` holds the whole palette as hex and runs it through `Bun.color(hex, "ansi")`, so it degrades to whatever depth the terminal reports. Colors turn off when stdout is not a TTY or `NO_COLOR` is set.

## Develop

```
bun run src/cli.ts --dry-run   # run from source
bunx tsc --noEmit              # typecheck
bun run build                  # compile ./broom standalone binary
```
