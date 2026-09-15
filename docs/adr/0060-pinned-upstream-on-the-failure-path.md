# 60. A pinned `refs/` submodule is a cache key, and upstream is the failure path

- Status: **Accepted**
- Date: 2026-09-15
- Deciders: Pascal Garber
- Related: `.github/actions/checkout-ref-submodule/action.yml`,
  `.github/workflows/{audit-runtimes,node-gi,release}.yml`,
  `scripts/check-adwaita-style-classes.mjs`, `scripts/check-refs-citations.mjs`,
  `packages/node-gi/scripts/bundle-fonts.mjs`, `docs/references.md`, #1686

## Context

On 2026-09-15 `gitlab.gnome.org` served `503` to every git request for several hours —
`remote: The git server, Gitaly, is not available at this time`. Measured from a workstation
that morning: three consecutive probes of
`https://gitlab.gnome.org/GNOME/libadwaita.git/info/refs?service=git-upload-pack` all returned
503, and a real `git submodule update` against it failed the same way on every attempt.

On `main` at `da8680b220`, run 34942832603, that landed as a red **required** check. `Detect
runtime-triplet drift` failed at *Check out refs/libadwaita (the style-class gate reads it)*
with all three of its inline retries exhausted. While GNOME was down, nothing in the repository
could merge — on a day when three pull requests were open and none of them had touched a
workflow, a submodule, or anything GNOME hosts.

The blast radius was never one step. Six steps across three workflows fetch a GNOME-hosted
submodule, and all six were equally dead:

| workflow | job | submodule | what breaks |
|---|---|---|---|
| `audit-runtimes.yml` | `check` (ubuntu) | `refs/libadwaita` | the required check |
| `audit-runtimes.yml` | `check-windows` | `refs/libadwaita` | manifest checks |
| `node-gi.yml` | darwin windowing bundle | `refs/adwaita-fonts` | the prebuild |
| `node-gi.yml` | win32 windowing bundle | `refs/adwaita-fonts` | the prebuild |
| `release.yml` | darwin runtime bundle | `refs/adwaita-fonts` | **the release** |
| `release.yml` | win32 runtime bundle | `refs/adwaita-fonts` | **the release** |

So one upstream host stood between a tag and a published runtime bundle, and the release path
had no more defence than the required check did.

What each checkout is FOR is small and worth stating, because it bounds every option below.
`refs/libadwaita` at pin `42f647ff` is read by two gates in the required job:
`check-adwaita-style-classes.mjs:55` reads exactly one 26,355-byte file,
`refs/libadwaita/doc/style-classes.md`, and holds the ledger to the 53 classes it documents;
`check-refs-citations.mjs` resolves the tree's anchored `refs/<sub>/<path>:<line>#<token>`
citations, and its own comment records that this submodule is checked out "precisely so this
gate has something to check on every PR". `refs/adwaita-fonts` at pin `bd828c71` supplies the
UI faces `bundle-fonts.mjs` stages into `share/fonts`.

### Why the existing defence could not help

Each step already carried a three-attempt retry with a 10 s / 20 s back-off, added on
2026-08-12 after a non-retrying fetch reddened two unrelated PRs. That is the right shape for a
blip and no shape at all for an outage: 30 seconds of patience against a host that was down for
hours. Retrying harder does not fix it either — an unbounded retry converts a red check into a
job that burns its timeout and then goes red anyway.

## Decision

**A `refs/` submodule in CI is realized from the pinned COMMIT, and the network is the failure
path rather than the happy path.** One composite action,
`.github/actions/checkout-ref-submodule`, is used by all six steps, in this order:

1. **A cache keyed on the pin.** The superproject pins a submodule to a commit, so the content
   behind that SHA is immutable: a cache entry keyed on the SHA cannot go stale, because
   different content is a different key. This is a strictly stronger property than the
   `node_modules` cache has, which is keyed on a lockfile hash *with a prefix fallback* — and
   that fallback is what poisoned a pull request the same day (#1686). **There is therefore no
   `restore-keys:` here, and there must never be one:** a prefix fallback would hand a gate the
   tree of some other pin and call it a hit. Same shape as `gi-test-typelibs-<rev>` in
   `node-gi.yml`.
2. **The canonical remote**, with the retry and back-off the steps already had, unchanged.
3. **A mirror**, only after the canonical remote has failed three times, always announced with
   a `::warning::` naming both URLs.

**Every source, the cache included, is then verified against the pin**: `git rev-parse HEAD` in
the submodule must equal the gitlink the superproject commits, and `git diff --quiet HEAD` must
find the worktree matching that commit. A restore resets every mtime, so the index stat cache
is cold and that `diff` re-hashes the worktree for real.

**The action never skips.** If none of the three answers, it exits 1 with a message naming the
host that refused, the pin it could not reach, and what is blocked. A gate that passes without
reading its input is worth less than no gate — which is the whole argument
`check-adwaita-style-classes.mjs` was written around, and it keeps its own `GITHUB_ACTIONS`
discriminator on top.

### Why a mirror is a transport decision, not a trust decision

A git commit id is the hash of its tree. Fetching the **pinned SHA** from any host yields that
exact tree or git refuses the object, so the mirror cannot substitute content — and the
verification above is what turns that from an argument into a check. `.gitmodules` is never
edited: the override lives in `.git/config` for the length of one fetch and is synced back
afterwards, so the repository's declared provenance stays the canonical GNOME URL and a cached
gitdir never carries the mirror forward.

Measured 2026-09-15, while GitLab was returning 503: `github.com/GNOME/libadwaita` serves
`42f647ff` (carrying `doc/style-classes.md`, 26,355 bytes) and `github.com/GNOME/adwaita-fonts`
serves `bd828c71`. End-to-end against the live outage, the action fell through three failed
GitLab attempts to the mirror, verified the pin, and
`check-adwaita-style-classes.mjs` then read 53 documented classes from that tree and passed.

### Why the file is not vendored

Copying `doc/style-classes.md` into the tree would remove the dependency outright. Three rules
rule it out, in order of how hard they bite:

- **`refs/` is read-only by policy** — AGENTS.md § Structure lists it as "read-only submodules
  — DO NOT modify", and § Constraints repeats it. A vendored copy is a second copy of upstream
  text with nothing to diff it against, which is precisely the drift the gate exists to catch:
  the ledger would then be checked against our own stale transcription and pass forever.
- **Provenance is machine-checked against the submodule pin.** `check-refs-citations.mjs`
  resolves line citations into `refs/<sub>/…` and the `refs-pin` manifest rule stamps builds
  against the committed gitlink. A vendored file has no pin to check and no commit to cite.
- **Licence.** libadwaita is LGPL-2.1-or-later and adwaita-fonts is OFL-1.1; this repository is
  MIT. A submodule carries the upstream licence in place, at a commit; a copied file carries
  neither unless someone maintains both by hand.

## Consequences

- The six steps reach GNOME only on a cache miss. A warm cache makes the required check
  independent of `gitlab.gnome.org` entirely, and the release path with it.
- The cache is written only after verification, by an explicit `actions/cache/save` rather than
  the automatic post-job save — which runs even when the job FAILED and would otherwise publish
  a half-fetched tree under the pin's key, turning one outage into a permanently poisoned
  entry. Same split, same reason, as the build-output cache in `gjsify-setup`.
- A cache entry that does not verify is discarded with a `::warning::` and refetched. It is
  never trusted and never silently accepted.
- `timeout-minutes` stays on the CALLING step in each workflow: GitHub does not honour it on a
  step inside a composite action. It covers what no retry count can, a fetch that hangs rather
  than refuses.

### What this does NOT fix — the residue, stated

- **A cold runner on a pin nothing has cached yet, with both hosts down.** The first run after
  a submodule bump has no entry under the new key by construction. The mirror covers the case
  where only GNOME is down, which is the observed one; a simultaneous GitHub and GNOME outage
  is still a red step — and, per the decision above, a red step rather than a green one.
- **Cache lifetime is GitHub's, not ours.** Entries are evicted after 7 days without a hit and
  under the repository's 10 GB cap, so a quiet week re-exposes the first run afterwards.
- **`napi.yml` still clones `gitlab.gnome.org/GNOME/gjs.git` by BRANCH**, not by pin
  (`--branch $GJS_REF`). It is out of scope here for two reasons: there is no immutable key to
  cache on, so the lever this ADR rests on does not exist for it, and the file is being edited
  concurrently by #1686. Cutting it over means pinning that clone to a commit first, which is a
  separate decision about what the napi jobs are measuring.
