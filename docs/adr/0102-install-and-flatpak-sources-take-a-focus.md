# 102. `install` and `flatpak sources` take `--focus`: a workspace closure, computed from the one full lockfile

- Status: **Accepted** (2026-10-09)
- Date: 2026-10-09
- Deciders: Pascal Garber
- Related: [ADR 0065 (a development link is an override)](0065-a-development-link-is-an-override-not-a-manifest.md),
  [ADR 0060 (what the CLI borrows from Yarn)](0060-what-the-cli-borrows-from-yarn.md),
  [ADR 0001 (install is non-destructive)](0001-install-clean-separation.md),
  `packages/infra/cli/src/commands/install.ts`, `packages/infra/cli/src/commands/flatpak/sources.ts`,
  `packages/infra/cli/src/utils/install-backend-native.ts`

## Context

A mixed monorepo carries toolchains that one of its apps never builds. Learn6502 (`gjsify/easy6502`) is the
measured one: `packages/app-android` pulls the NativeScript toolchain, `packages/app-gnome` is what the
Flatpak ships. The Flatpak build runs `gjsify install --immutable` offline from a cache that
`gjsify flatpak sources` filled from the whole lockfile. Measured on `origin/main` of that repo:
`gjsify-lock.json` has 1356 package entries, 29 of them under `nativescript`, 72 `nativescript` lines; the
generated `gjsify-sources.json` has 14 `nativescript` tarballs. None is used by the GNOME build, and all are
downloaded, pinned and shipped in the offline cache.

Yarn Berry's `yarn workspaces focus` is the model: "run an install as if the specified workspaces (and all
other workspaces they depend on) were the only ones in the project". Its source
(`packages/plugin-workspace-tools/sources/commands/focus.ts`) does three things that matter here:

1. The closure is the named workspaces plus, transitively, every workspace named in their `dependencies`,
   `devDependencies`, `optionalDependencies` (`Manifest.hardDependencies`).
2. Every other workspace, **the root included**, has its `dependencies`, `devDependencies` and
   `peerDependencies` cleared. The root is not special-cased: it is in the closure only if named or
   depended on.
3. The install runs with `persistProject: false`: the lockfile is not rewritten into the subset.

### Measured: does `gjsify-lock.json` record the edges?

Both halves exist, one is missing.

- **Package → package edges: recorded.** `writeLockfile`
  (`utils/install-backend-native.ts`, `function writeLockfile`) writes, per entry keyed by install path,
  `dependencies`, `optionalDependencies`, `peerDependencies` and `peerDependenciesMeta`. `readLockfile` /
  `lockfileToNodes` read them back into `ResolvedNode`, and `findVisible` resolves an edge the way Node's
  parent-walk does. `computeOptionalFlags` already walks this graph from the top-level names, on both the
  resolve and the lockfile path. Measured on the 1861 entries of this repo's own lockfile: the entry keys
  are `version resolved integrity optional optionalDependencies os cpu libc dependencies bin`.
- **Workspace → package edges: not recorded.** The lockfile is `{ lockfileVersion: 4, requested, packages,
  peersResolved }`. `requested` is ONE flat list of `name@range` merged over every workspace
  (`workspaceInstallLocked` builds `externalSpecs` as a single `Set`; the per-workspace attribution in
  `specOrigins` is passed to the resolver and never written). The lockfile has no workspace nodes. A
  `workspace → seeds` map therefore cannot come from the lockfile alone.
- **The seeds are available offline anyway.** The closure's roots are the focused workspaces' own
  manifests, which `discoverWorkspaces` reads from disk, and the lockfile is only needed to walk
  from those seeds. Both `install` and `flatpak sources` run in the monorepo, and a Flatpak build has the
  source tree (`{ "type": "dir", "path": "." }`).
- **One property of the hoisted layout makes the seed lookup exact.** Top-level specs always take the root
  slot (`decidePlacement` returns `node_modules/<name>` for a null requester), so seed `name` is
  `node_modules/<name>`. `computeOptionalFlags` relies on the same fact.

So **no format change and no version bump is needed**. A bump would also make `main` write a format the
published CLI cannot read, the Node-less bootstrap that `scripts/check-lockfile-reader-lead.mjs` guards.

## Decision

**`gjsify install --focus <workspace…>` and `gjsify flatpak sources --focus <workspace…>` act on the
closure of the named workspaces. The closure is computed by one shared function from the workspace
manifests plus the full `gjsify-lock.json`. The lockfile is never rewritten into a subset.**

### 1. One closure function, two callers

`utils/install-focus.ts` exports a pure function over two inputs: the discovered workspaces and a
lockfile-shaped `packages` map.

1. **Workspace closure.** The named workspaces, plus every workspace named in their
   `dependencies`/`devDependencies`/`optionalDependencies`, transitively. Matching is by package name,
   exactly as `workspaceInstallLocked` already decides that a dep "is" a workspace (`byName`), explicit
   `link:`/`file:`/`portal:`/`git+`/`http(s):` specs excluded, so the two cannot disagree.
2. **Seeds.** The external `name@range` specs of the closure's manifests, same filters as today.
3. **Package closure.** From each seed's `node_modules/<name>` entry, follow `dependencies`,
   `optionalDependencies` and REQUIRED `peerDependencies` through `findVisible`. Optional edges are
   followed because the install later decides them per host (`applyPlatformFilter`); leaving them out would
   make the closure depend on the host that computed it. An optional peer is not followed: the resolver
   does not place it either. The result is a set of install paths.

`install` uses the set to filter what is fetched and extracted; `flatpak sources` uses the same set to
choose which entries become tarball sources. The Flatpak cache and the offline install therefore agree
by construction, which is the property a second implementation would lose.

### 2. The lockfile stays complete, and the focus is a consumer of it

`--focus` never writes `gjsify-lock.json`. The drift check (`describeLockfileDrift`, `requested` against
the live specs) still compares the FULL set over all workspaces: focusing changes what is installed,
not what is committed. Consequently:

- `--focus` requires a lockfile that matches the full request. A missing or stale one fails with the
  same message `--immutable` gives, and a pointer to run a plain `gjsify install` first. It does not
  resolve, because resolving would reach the unfocused toolchains over the network, which is what the
  option exists to avoid.
- With or without `--immutable`, `--focus` is lockfile-authoritative. `--immutable` additionally keeps
  its tree check (`assertNoExtraneous`), judged against the FULL node set, so a tree left by an earlier
  full install is not called extraneous.
- The optional-flag fixpoint (`computeOptionalFlags`) runs on the full set as today, because the full
  set is what a lockfile write would persist; under `--focus` it runs again over the closure, before the
  platform filter. A package reachable from the focus only through optional edges is not made fatal by an
  unfocused workspace that requires it.

### 3. The root workspace is not implicit — Yarn's rule

The root `package.json` is a workspace here too (`discoverWorkspaces(cwd, { includeRoot: true })`), and
focus follows Yarn: it is in the closure when named by its package name or depended on, otherwise its
(dev)dependencies are not installed. The deciding evidence is Yarn's source above, which clears the root's
dependencies like any unselected workspace.

What Learn6502's Flatpak build needs from the root, measured in `meson.build`: the CLI at
`node_modules/@gjsify/cli`, and `@gjsify/rolldown-native` and `@gjsify/lightningcss-native` for the prebuilds
(`GI_TYPELIB_PATH`/`LD_LIBRARY_PATH`). The first is also an `app-gnome` devDependency, the other two are
root-only. With Yarn's rule the consumer has two correct answers: name the root
(`--focus @learn6502/app-gnome learn6502`, which also installs the root's lint and release tooling), or
declare the two prebuild packages where they are used, in `app-gnome`. An implicit root would make a focused
install quietly larger than its name says and hide the second answer.

**Decision for the motivating consumer (Pascal, 2026-10-09):** the root is not implicit in a focus. A consumer
moves the build-time dependencies a workspace needs into that workspace. Learn6502 moves
`@gjsify/rolldown-native` and `@gjsify/lightningcss-native` into `app-gnome`'s devDependencies instead of
naming the root in `--focus`. Naming the root stays possible.

A root with no `name` cannot be named and is never in a focused closure.

### 4. Unknown names fail, naming the name

A `--focus` argument that is not a discovered workspace name throws and lists the unknown name(s) with
the known workspace names, as `getWorkspaceByIdent` does. No glob, no path form: one way to spell a
workspace is the one the rest of the CLI already uses.

### 5. What a focused install leaves out besides packages

For a workspace outside the closure the install writes no per-requester links, no root hoist symlink, no
`.bin` shim, and runs no scoped-override local install. "As if they were the only workspaces" is the
contract, and a link to a workspace whose dependencies are absent would be a broken link that looks
installed.

### 6. `gjsify link` (ADR 0065) is orthogonal and keeps its rules

A link overrides packages by name from a local checkout and is dropped from `fetchable` after the lockfile
decision. Under `--focus` that filter is applied to the closure, so a linked name outside the closure is
simply not in play. `--immutable` with an active link is still refused, before anything resolves, naming the
file (ADR 0065 § 2): focus does not relax a fail-closed rule, and a focused `--immutable` build with a link
is no more reproducible than an unfocused one. `flatpak sources` never reads a link, as today.

### 7. Not decided here: a `--production` flag

Yarn pairs `focus` with `--production` (clear devDependencies). No consumer needs it: Learn6502's Flatpak
build compiles on the target and needs its devDependencies (the CLI is one). Adding it would define what
"production" means for a workspace whose build tool is a devDependency, without a case to measure it
against. Omitted. Revisit when a consumer measures the need.

## Alternatives rejected

- **Add per-workspace edges to the lockfile (format v5).** Would make the closure computable from the
  lockfile alone, at the cost of a format bump that the published CLI cannot read (see Context). The
  manifests are on disk wherever either command runs; the information is not missing, only not co-located.
- **Write a subset lockfile for the focus.** The Yarn source says why not: it would drop every other
  workspace's pins, and the next full install would re-resolve them. One shared root lockfile is the
  property the consumer asked to keep.
- **Install the root implicitly.** See § 3.
- **A second graph walk inside `flatpak sources`.** Two walkers drift; the cache would stop matching the
  install the build runs.
- **Move the toolchain to a separate repo or lockfile.** Pushes a packaging problem into the consumer's
  layout, and the Android app wants to stay a normal workspace.

## Consequences

- A consumer's Flatpak cache shrinks by exactly what the focused closure does not reach, and
  `meson.build` changes by one flag. The consumer's own number is measured in the implementing PR against a
  copy of Learn6502.
- Unfocused workspaces are not built or linked after a focused install. A script that runs a workspace
  outside the closure fails with an ordinary missing-module error, which is the same trade Yarn's
  `workspaces focus` makes.
- `flatpak sources --focus` supports `gjsify-lock.json`, the one format that records the edges and that
  the offline install consumes. It refuses `package-lock.json`, `yarn.lock` and `pnpm-lock.yaml` with a
  message naming the flag, instead of returning the unfocused set: npm's file also holds workspace and
  link entries this walk does not model, and the other two have no per-package edges in the shape read here.
- No lockfile bytes change, so a consumer's CI cache key and `check:flatpak:sources` keep working; the
  generated sources file does change when `--focus` is added to its generating command.

## What this does not decide

- `--production`, `--all` and a no-argument form that focuses the cwd's workspace (Yarn's default): each
  is addable later without changing § 1 to § 6.
- Focused builds for other commands (`gjsify build`, `gjsify workspace`).

## Implementation

Tracked in `status/open-todos/ci.md` (install and Flatpak build). One PR on top of this one: `utils/install-focus.ts` with its unit
tests; `install` wiring; `flatpak sources` wiring; CLI help and the docs pages that list the two commands'
flags. Evidence for the Learn6502 numbers in the PR description.
