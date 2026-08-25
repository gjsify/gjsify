# 31. `node-gi` and `napi` stay outside the npm workspace

- Status: **Accepted**
- Date: 2026-08-25
- Deciders: Pascal Garber
- Related: [ADR 0005 (node-gi scope)](0005-node-gi-scope.md), [ADR 0011 (N-API host in GJS)](0011-napi-host-in-gjs.md), [ADR 0003 (package tiering)](0003-package-tiering.md), [ADR 0017 (native package distribution)](0017-native-package-distribution.md)

## Context

`packages/node-gi/*` and `packages/napi/*` are absent from the root
`package.json#workspaces` globs while every other package tree is present. The
question "why, and could it be cleaner" has now been asked, and the answer was hard
to find — which is the defect this ADR exists to fix.

**ADR 0005 does not require it.** Its Decision 2 forbids a *dependency*: no Tier-1
or Tier-2 package may put `@gjsify/node-gi` in `dependencies`/`optionalDependencies`,
and the sanctioned seams are a `devDependency` and the conditional `--app node`
build injection. That invariant is enforced by name in `scripts/audit-runtimes.mjs`
and is **independent of workspace membership** — a member would still be refused a
hard dependency edge. ADR 0005 also graduated node-gi to Tier 2 on 2026-07-14, so
the exclusion is not "it is experimental" either.

**The operative reason was written down in exactly one place: a comment beside the
`IGNORE` patterns in `packages/infra/cli/src/commands/affected-classify.ts`** — "the
GJS-first install/foreach tooling cannot build their node-gyp addons or Vala+C++/meson
shim, so `main.yml` neither builds nor tests them and their own workflows are the
source of truth". A constraint that shapes the package tree, kept where only someone
editing the CI classifier would meet it.

### What membership would cost, measured

- **`@gjsify/node-gi`'s `build` script is literally `node-gyp rebuild`.** As a member
  it enters `gjsify foreach build`, which runs in a container with no GTK/GI
  development toolchain. That is the real blocker, and the classifier's comment is
  accurate about it.
- There are **five tree-wide `foreach` sweeps** (`build`, `check`, `test`, `clear`,
  `npm:publish`), and `build` already carries **fifteen** `--exclude` entries. A
  sixteenth is not a new mechanism, it is a worse instance of one the governance
  rules already call a smell — and a sweep that forgets it compiles C++ where it
  cannot.
- node-gi declares an `install` lifecycle hook. `gjsify install` never runs lifecycle
  scripts (`install-backend-native.ts` says so in as many words), so the monorepo's
  own installer is unaffected — but a plain `npm install` at the repo root would
  start a node-gyp build that currently cannot happen.

### What membership would buy, measured

Exactly one thing, and it is already mitigated. `tests/e2e/create-app`'s
`patchPackageJson` remaps every WORKSPACE member to a locally packed tarball, so a
non-member is the one `@gjsify/*` range it installs from the public registry. That is
the whole mechanism behind the release-commit race — on a `chore: release` commit the
version is bumped but not yet published. It is fixed by waiting for the registry
(`awaitRegistryResolvable`), which is the better fix anyway: installing from npm is
what that suite exists to prove.

**And one thing it would NOT buy, contrary to the first reading.** The templates
would still need `process-template.mjs`'s `file:` → `^<version>` rewrite: a published
template must reference a published range, whatever the monorepo calls the edge
internally.

## Decision

**`packages/node-gi/*` and `packages/napi/*` stay outside the workspace, and the
reason is recorded here rather than in a CI comment.**

1. The boundary is about **build tooling** — not experiment status, not dependency
   isolation. Those have their own mechanisms: tiering (ADR 0003) and the
   `audit-runtimes` rule ADR 0005 § 2 names.
2. **Their own workflows are the source of truth.** `node-gi.yml` and `napi.yml`
   build, load-test and gate them; `main.yml` does neither, by design.
3. The `IGNORE` patterns in the affected classifier stay, and their comment points
   here instead of carrying the argument alone.
4. **The seams a non-member needs are named, so they stop reading as accidents:** a
   `file:` relative dependency where a member would say `workspace:^` (the
   `@gjsify/sqlite` and `@gjsify/gtk-host` devDependencies), the `file:` → `^version`
   rewrite in `process-template.mjs`, and `tests/e2e/create-app` resolving them from
   the registry rather than from a tarball.

## Consequences

- Anyone asking this again finds the answer in `docs/adr/`, which is where they look.
- **`@gjsify/napi`'s exclusion rests on weaker ground than node-gi's, and that is
  recorded rather than smoothed over.** Its `build` is
  `gjsify run build:gjsify && build:types` — pure TS, which a sweep could run; the
  meson step is a separate `build:meson`. What keeps it out is its `test`, which needs
  the Vala+C++ shim, plus symmetry with node-gi. If that asymmetry ever matters, this
  is the paragraph to argue against.
- The create-app suite keeps one registry-resolved `@gjsify/*` range and therefore
  keeps needing the wait. That is a cost of this decision and belongs on its ledger
  rather than hidden inside the e2e.

## Alternatives rejected

- **Membership plus a sixteenth `--exclude`.** Buys one already-mitigated defect
  class; pays a hand-maintained list entry and a failure mode where a forgotten
  exclusion compiles C++ in the wrong container.
- **Membership with the exclusion DERIVED from a declaration** — skip packages
  declaring `gjsify.platforms`, so it is computed rather than named. The right shape
  if the exclude lists ever need touching for another reason; not worth a migration
  of its own today, because the existing fifteen entries are bootstrap-order
  exclusions rather than native ones, so nothing gets deleted in exchange.
- **Renaming node-gi's `build` so the default sweep does not compile.** Changes a
  published package's script surface for the convenience of a sweep it is not in.
