# branch-broom

Interactive cleanup for the local git branches you've worked on. Lists mostly just branches you authored (not everything on the remote), lets you multi-select, and deletes them.

## Setup on a new machine

Needs [Bun](https://bun.sh) 1.4+

```bash
// clone the repo somewhere, cd in
bun install                                 
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

