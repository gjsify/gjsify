# 17. Distribution of platform-specific native builds

- Status: **Accepted**
- Date: 2026-07-31
- Deciders: Pascal Garber
- Related: [ADR 0003 (tiering)](0003-package-tiering.md), [ADR 0001 (install separation)](0001-install-clean-separation.md), AGENTS.md § "Prebuilds", § "New `@gjsify/*` package: first-publish + Trusted Publisher bootstrap"

## Context

Eleven `@gjsify/*` packages ship compiled artifacts as committed
`prebuilds/<os>-<arch>/` directories inside **one** npm tarball, declared via
`package.json#gjsify.platforms` and audited by `scripts/audit-runtimes.mjs`.

Measured on this tree:

| | |
|---|---|
| committed prebuild bytes | **97.3 MB** across 11 packages |
| usable by a `linux-x64` consumer | **31.5 MB** |
| downloaded and never loadable | **65.8 MB (68 %)** |

Worst single case: `@gjsify/lightningcss-native` at 46.4 MB for six targets.

The npm ecosystem solved this years ago, and we already *consume* the solution
without *producing* it. The established pattern — esbuild, napi-rs, rolldown,
oxc, lightningcss upstream — is:

- the main package declares **no** `os`/`cpu` and lists one
  `optionalDependencies` entry per target (`esbuild` has **26**);
- each platform package declares `os: ["linux"], cpu: ["x64"]` and contains only
  that binary;
- the package manager installs the matching one and **silently skips** the
  rest — silently, because a platform mismatch on an *optional* dependency is
  not an error (on a required one it is `EBADPLATFORM`);
- the main package resolves its installed sibling at runtime.

The older approach — a `postinstall` script downloading a binary
(`node-pre-gyp`, `prebuild-install`) — is in retreat because `--ignore-scripts`
is increasingly the default in CI and in security-conscious installs. esbuild
migrated away from it for exactly that reason. We should not adopt it.

**Both halves of this are ours to fix, and they are independent:**

1. *Consumer side* — honouring `os`/`cpu` when installing other people's
   packages. `gjsify install` did not, so a linux-x64 tree carried **166
   packages / 3563 MB / 62 % of all bytes** of foreign-platform binaries,
   including all 26 `@esbuild/*`. Addressed by the platform-filter work
   (`feat/install-platform-filter`); this ADR does not re-decide it.
2. *Publisher side* — how **we** ship our own binaries. That is what this ADR is
   about, and today we are the thing our own filter cannot help with: one
   tarball, every platform, no `os`/`cpu` anywhere for a resolver to act on.

## Decision drivers

- A consumer should not download bytes their machine cannot load.
- The bootstrap property must survive: `gjsify install --immutable` on a fresh
  clone, no Node, driven by the committed GJS bundle.
- Adding a published `@gjsify/*` name is **expensive and serialising**: npm
  Trusted Publishing requires the package to already exist, so the first publish
  is a manual maintainer action. Skipping it breaks the whole serialized
  `npm:publish` loop — the v0.4.20 incident left 60+ packages stuck at the
  previous version because one new name had no bootstrap.
- The audit chain (`gjsify.platforms` → CI matrix → committed artifact →
  loadability) is hard-won and must keep working, not be replaced by faith.

## Options

### A — Status quo: one tarball, all targets

*Keep.* Zero migration cost, zero new names, the audit chain is unchanged.
Costs every consumer 68 % waste, and the number grows with each new target: the
emulated ppc64/s390x/riscv64 legs exist precisely so those platforms work, and
each one taxes the 95 % of users who are not on them.

### B — esbuild model: `optionalDependencies` per target

The ecosystem standard. A consumer on linux-x64 fetches only linux-x64.
Composes with the platform filter we just built — our own packages become
skippable by the same rule as everyone else's.

Cost, measured: **52 new npm package names** (the sum of declared targets across
the 11 packages), each needing the manual first-publish + Trusted-Publisher
bootstrap before the next release train, or the train stops.

### C — postinstall download

Rejected on the evidence above: `--ignore-scripts` breaks it, it is why esbuild
left, and it would put a network fetch inside an install path whose
non-destructive and hang-safety invariants (ADR 0001) we deliberately hardened.

### D — Hybrid, by weight

Split only where the waste is material; keep single-tarball where it is noise.
The distribution is extremely skewed: three packages (`lightningcss-native`,
`rolldown-native`, `oxfmt-native`) are **87.7 MB of the 97.3 MB**; the remaining
eight together are 9.6 MB, and several are under 1 MB, where a second package
name costs more in release-train risk than it saves in bytes.

Splitting only those three: **~12 new names** instead of 52, removing the large
majority of the waste.

## Decision

**Option B — the esbuild model, applied to every native package.** ~52 new
per-target packages `@gjsify/<name>-<os>-<arch>`, each declaring `os`/`cpu`,
referenced as `optionalDependencies` from a main package that keeps its current
name, API and loader contract.

Option D (split only the three heavy bridges) was drafted first and rejected on
review. Its saving — 12 names instead of 52 — buys a **threshold**, and a
threshold is a hand-maintained judgement that gets re-litigated per package and
drifts. This repo has spent considerable effort this month replacing exactly
that shape with derived rules. One rule for all native packages is auditable;
"~5 MB of non-host bytes" is not.

1. Split **all 11** native packages into per-target packages.
2. `gjsify.platforms` stays the single declaration. Extend
   `audit-runtimes.mjs` to verify, for every declared target, that a
   corresponding `optionalDependencies` entry exists **and** that its `os`/`cpu`
   match the target name — otherwise we trade one silent drift for another.
3. Do the first-publish + Trusted-Publisher bootstrap for all new names in **one
   `gjsify onboard` sweep before** the split lands, so no release train is
   blocked on a missing name.
4. **Sequencing (load-bearing):** the platform filter
   (`feat/install-platform-filter`) must land and be proven **first**. After the
   split, our own packages' installability depends on our own installer
   honouring `optionalDependencies` + `os`/`cpu`. Shipping the split against an
   unproven filter would make our packages fail in the hardest-to-diagnose way:
   a main package searching for a sibling that was never installed.

## Consequences

**Good.** A linux-x64 consumer stops downloading ~66 MB they cannot load. Our
own packages become subject to the same platform filtering as everyone else's,
so the two halves of the problem get one consistent answer. Adding an exotic
target (the emulated arches) stops taxing every other user, which lowers the
cost of supporting more platforms — the OS axis gets cheaper to widen.

**Bad.** ~52 new published names, each an irreversible npm namespace claim and a
manual bootstrap step. The release train gains 52 more things that must already
exist, and every future target adds one more — the `gjsify onboard` sweep is
what keeps that from becoming a per-release chore, so it must stay working. A
consumer whose platform package genuinely failed to install now gets a missing
sibling rather than a missing directory: the loader must say which package it
expected, not just "typelib not found".

**Cheaper than the draft assumed.** Runtime discovery needs no new code path:
`detectNativePackages` (`packages/infra/cli/src/utils/detect-native-packages.ts`)
already scans *every* package in `node_modules` for a `gjsify.prebuilds` field
and its `prebuilds/<target>/` directory, so a split package is found by exactly
the mechanism that finds a bundled one. The loader contract is unchanged; only
which tarball the directory arrives in changes. This removed the largest
objection to Option B.

**Neutral.** The committed-prebuild audit chain stays; only its shape per
package changes. The bootstrap property is unaffected: the CLI's own bundle does
not depend on the heavy bridges at install time.

**Accepted cost at the small end.** `@gjsify/terminal-native` is 0.3 MB across
six targets — a split saves a consumer ~250 KB and adds five package names,
five registry entries and five bootstraps. Uniformity is chosen over that
marginal loss deliberately; see the Decision.

## Open question for implementation — RESOLVED

> Whether the split packages should also carry `gjsify.platforms` (a one-element
> list, self-describing) or omit it and let the main package's list be
> authoritative. The former is more redundant but keeps every published tarball
> self-checking; the latter keeps one source of truth. Decide when writing the
> audit rule in step 3 — whichever choice makes a wrong declaration *impossible*
> rather than merely unlikely.

**The child carries it.** Its own criterion decides: `gjsify.platforms` +
`gjsify.prebuilds` on the child is what puts the tarball that ACTUALLY CONTAINS
THE BINARY under the `prebuild-artifacts` rule — the directory exists, its
ELF/Mach-O machine matches the directory name, every library the typelib records
is staged beside it, and on the host's own target it is really `dlopen`ed. Omit
it and the one tarball a consumer downloads is checked by nothing that reads only
that tarball, while the parent's list stays authoritative for artifacts the
parent no longer contains.

The redundancy cannot become a second truth because it is not maintained: the
generator derives it from the parent's list and `--check` fails if the two
disagree. A wrong token would have to agree simultaneously with the package name,
`os`, `cpu`, the prebuild directory name and the machine field inside the binary
— and nobody hand-edits the last one.

Three further decisions the implementation had to make, recorded here because
each is a consequence of the model rather than of the code:

1. **Every declared target gets a package, including one whose artifact is
   deferred by `gjsify.platformsUncommitted`** (which the child inherits). The
   alternative — exempt ⇒ no package — breaks a live shipping path:
   `@gjsify/napi`'s `darwin-arm64` is built by `release.yml` and staged into the
   tarball at pack time, so with `prebuilds` gone from the bridge's `files` it
   would pack nothing and every macOS consumer would lose the prebuild, silently.
   It also keeps the exemption falsifiable (`prebuild-artifacts` trips when the
   directory appears, and it now appears in the child, not in a bridge that has
   left that rule's scope), and it claims the npm name at DECLARATION time rather
   than when the binary lands — spreading the bootstrap cost this ADR names as
   the split's main downside instead of concentrating it. Cost: 60 names, not 51.
2. **Binary facts move to the binary.** The npm `libc` filter,
   `gjsify.glibcRequires` and `gjsify.platformsUncommitted` all leave the bridge.
   `libc` is not cosmetic: npm, yarn and pnpm honour it, so an inherited
   `["glibc"]` on a bridge that now holds only TypeScript refuses to install on
   musl hosts where it runs fine. Per-target packages also let the field say
   something true for the first time — only `@gjsify/tls-native-linux-riscv64`
   needs it, not all five of that bridge's Linux targets, and one tarball could
   not state that.
3. **The measurement is the `prebuild-libc` rule's own reader, imported.** The
   generator WRITES the field that rule GRADES, so a second implementation of "is
   this glibc-linked" can only ever produce a manifest `--check` then rejects. It
   did exactly that: a hand-rolled predicate matched `ld-linux-*` but not
   ppc64le's `ld64.so.2` or s390x's `ld64.so.1`.
