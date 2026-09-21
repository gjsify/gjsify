# 65. A development link is an OVERRIDE the installer reads, not a manifest edit

- Status: **Accepted**
- Date: 2026-09-21
- Deciders: Pascal Garber
- Related: [ADR 0060](0060-what-the-cli-borrows-from-yarn.md) § P6 (revised here),
  [ADR 0001](0001-install-clean-separation.md),
  `packages/infra/cli/src/utils/dev-link.ts`, `packages/infra/cli/src/commands/link.ts`,
  `packages/infra/cli/src/utils/install-backend-native.ts`

## Context

ADR 0060 § P6 looked at Yarn's `link:` and `portal:` protocols and recommended **against**
them — *"neither protocol adds a capability here"* — with one condition attached: *"unless a
specific unfixable … need appears"*. The need appeared.

A consumer repo — Learn6502 (`JumpLink/easy6502`) is the measured one — depends on `@gjsify/*`
at registry ranges (`^0.51.1`) and commits its `gjsify-lock.json`. Developing a change that
spans the platform and the app therefore costs an npm release per iteration, because the
installer models exactly two spec shapes. Measured against the sources: `file:`, `link:` and
`portal:` have **zero** hits in the resolver; `commands/upgrade.ts:336-346` skips those
prefixes defensively and nothing else mentions them.

The obvious workaround is `npm link`, and it has the failure this ADR is shaped around: **the
next install silently undoes it.** The installer re-materialises `node_modules/<name>` from the
registry, says nothing, and the developer keeps testing a tree they think is theirs.

## Decision

`gjsify link <checkout> [--packages <glob>]` and `gjsify unlink`, built on three rules.

### 1. The override is a file the installer reads, not a spec the manifest carries

The pointer lives in `.gjsify-link.json` at the consumer root: the checkout path plus name
globs, never a materialised package list, so `link` and `install` derive the same set from the
same two inputs. `package.json` and `gjsify-lock.json` are not touched — measured across a full
link → install → unlink cycle, `gjsify-lock.json` keeps the same sha256 throughout, and `git
status --porcelain` is empty at every step.

Written into `package.json`, a `link:` spec would make a developer's working tree part of what
CI, the Flatpak build and every release build. That is the property those three exist to have,
and no protocol implementation buys it back. The file is hidden from git through
`.git/info/exclude` — git's own per-clone ignore list, which is never committed — rather than
`.gitignore`, because putting a local override into everyone else's diff is the same mistake
one file over.

### 2. `--immutable` refuses an active override, fail-closed

`--immutable` is what CI runs, and its whole promise is "exactly what is committed". An
override in scope is refused before anything resolves, naming the file and the checkout it
points at. The alternative — consuming it quietly — produces an artifact whose inputs are in no
commit, from a build that reported nothing unusual. This is the same asymmetry
`install-extraneous.ts` settles the extraneous-package question with: a refusal costs one red
run carrying the exact path.

A dead link is refused the same way, on both `link` and `install`: a `checkout` that does not
exist, or is not a gjsify workspace, aborts with the measured path instead of falling back to
the registry. A silent fallback is precisely the shape that makes a linked tree
indistinguishable from an unlinked one.

### 3. The linked names are excluded from the FETCH, not from the RESOLVE

This is the part the obvious implementation gets wrong, and it is not a stylistic call.

Re-linking *after* the install is not an option: with `node_modules/@gjsify/<name>` a symlink
out of `node_modules`, `assertNodeModulesDest` refuses the extract and aborts the whole install
— correctly, since `rmSync` through that link would delete the checkout's own sources. Measured
on a throwaway consumer, with the override removed but the link left in place:

```
gjsify install: refusing to extract @gjsify/semver@0.51.1 — …/node_modules/@gjsify/semver
resolves to /home/…/gjsify-link/packages/infra/semver, which is outside any node_modules/
directory (likely a symlink to a workspace source tree). Extracting here would delete
working-tree source files.                                                        [exit 1]
```

Nor may the exclusion reuse `workspaceNames`, the set it is otherwise shaped like. That option
is also handed to `resolveDeps`, and the resolve is what writes `gjsify-lock.json`; reusing it
would rewrite the consumer's committed lockfile the moment a link went active — the one thing
rule 1 promises not to do. So `linkedNames` is a separate option applied **after** the lockfile
write and only to the download set.

**And "not fetched" is not "not installed."** The first implementation answered the installer's
`topLevelResolutions` — the map `gjsify install <pkg>` writes back into `package.json` — from the
same array the exclusion had already filtered, so a linked package had no resolved version at
all. Measured on a throwaway consumer: `gjsify install is-odd` with is-odd linked rewrote
`"is-odd": "^3.0.1"` to `"is-odd": "latest"` and put `is-odd@latest` into the lockfile's
`requested`; the control run without the link wrote `^3.0.1`. That is rule 1 broken by the code
that implements rule 3. The tree of resolved nodes and the set still to download are therefore
two named values in `install-backend-native.ts` (`nodes` and `fetchable`) and must stay two.

### What `link` links

The checkout's workspace packages, narrowed by `--packages`, **intersected** with what the
consumer actually depends on (its manifests plus its installed tree). Without the intersection
a 200-member monorepo drops 200 directories into a consumer that uses two, and `unlink` has no
honest answer about what to restore. An intersection that comes out empty is an error, not a
no-op — the rule `gjsify foreach --include` already applies to a filter that selects nothing.

One measurement decided the default selector's spelling: `@gjsify/workspace`'s glob dialect
maps `*` to `[^/]*`, so a bare `*` matches **no scoped name at all**. The default is therefore
the empty list, meaning every package; a whole scope is spelled `@gjsify/*`.

## Consequences

- An active link is visible in the output of every install that re-applies it. That line is the
  feature: it is what `npm link` does not print, and what makes a linked build traceable.
- `gjsify unlink` reinstalls by default, because removing a link leaves a hole where the
  registry copy was and an undo that hands back an unresolvable tree is not an undo.
  `--no-install` skips it.
- `unlink` removes only symlinks that point into the recorded checkout. A real directory in
  that place is somebody else's, and a verifier that deletes can delete the wrong thing.
- Re-linking is a re-SELECTION. `link` removes whatever the previous override linked and the new
  one does not, because the plan is not a census: `removeDevLinks` only visits what the current
  override names, so a narrower `--packages` used to leave an orphan symlink out of
  `node_modules` that no command could name again — and `assertNodeModulesDest` then aborted
  every later `install`, with `unlink` removing the override (the escape route) before hitting
  the same abort. The ground truth for "what is linked" is the tree (`scanDevLinks`), and
  `unlink` removes the links BEFORE the override for the same reason.
- `unlink` also removes the `.git/info/exclude` block `link` wrote — only that block, matched as
  comment plus pattern, never a `.gitignore` line or a hand-written entry. A cleanup that leaves
  a rule behind about a file that no longer exists is not a cleanup.
- ADR 0060 § P6's verdict on `link:`/`portal:` **as resolution protocols** stands: none is
  implemented, `gjsify-lock.json` gains no new spec shape, and nothing about resolution
  changes. What is added is an install-time override with a refusal attached.
- A linked package is used as it is on disk — a link does not build — so a link to something
  UNBUILT is refused, by `link` and by every `install` that re-applies it, naming the path and
  the build command. `dist/`/`lib/` are git-ignored in a gjsify checkout, which makes "the entry
  point is not there" the ordinary result of a branch switch rather than an exotic state; the
  first draft only warned, once, at link time, and a later install re-linked in silence while
  the consumer died on `MODULE_NOT_FOUND` pointing at the consumer. The check runs over every
  link, not only the ones a run rewrites, because `applyDevLinks` skips a link that is already
  correct — which is exactly the measured state.
