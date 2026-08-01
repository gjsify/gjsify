# ADR 0003 — Explicit package tiering (stability contract)

- **Status:** Accepted (2026-07-01); **amended 2026-08-01** — see
  [Amendment](#amendment-2026-08-01--a-platform-gated-artifact-package-inherits-its-parents-tier).
  Rules 1–4 stand; rule 5 adds the one package KIND rule 1 was never about.
- **Scope:** all published `@gjsify/*` packages; the project status data (`status/`); `scripts/audit-runtimes.mjs`

## Context

The workspace publishes ~112 packages across four runtime axes, three storybook
renderers, five devtools packages, a browser, a package manager, a bundled TS
compiler, native Vala/Rust bridges, and the node-gi engine. Each axis is individually
justified; collectively it is several teams' worth of surface maintained by
effectively one person. Today the automation (dual-runtime tests, affected-only CI,
release train) carries it — but every new axis multiplies the matrix, and nothing
distinguishes "stability promise" from "experiment" to consumers or to future
sessions deciding where fix effort goes. Experiments silently ossify into support
obligations.

## Decision

Every published package declares a tier; the tier is a documented contract:

- **Tier 1 — core (stability promise):** Node/Web/DOM pillar polyfills, framework
  bridges (`canvas2d`, `webgl`, `event-bridge`, `video`, `iframe`, `bridge-types`),
  `@gjsify/{utils,unit}`, and the CLI core commands (`install`, `build`, `run`,
  `test`, `tsc`, `workspace`, `foreach`, `publish`/auth). Full dual-runtime CI,
  root-cause governance, no known-broken releases.
- **Tier 2 — product (best effort):** design identity (`adwaita-web`, `adwaita-fonts`,
  `adwaita-icons`, `adwaita-nativescript`), storybook (`stories`, `storybook-core`,
  the three renderers), devtools (`devtools*`), flatpak tooling. Tested, released on
  the train, but breaking changes may ship with a minor + changelog note.
- **Tier 3 — experimental (no promise):** `@gjsify/node-gi` (ADR 0005),
  `devtools-browser`/`devtools-cdp`, NativeScript runtime-slot backfill, anything
  new until promoted. README + the status snapshot mark them experimental.

Rules:

1. **Dependency direction:** a Tier-1 package MUST NOT depend (deps or
   optionalDeps) on a Tier-2/3 package; Tier 2 must not depend on Tier 3. Optional
   peers are exempt (they encode exactly this looseness).
2. **Promotion gate:** Tier 3 → 2 requires a second real consumer plus one release
   cycle without a breaking change; Tier 2 → 1 additionally requires the full
   dual-runtime test discipline.
3. **New axes start at Tier 3** — by default, no matter how promising.
4. Declared in `package.json#gjsify.tier` (`1 | 2 | 3`), audited by
   `scripts/audit-runtimes.mjs` (tier table + dependency-direction check in CI),
   surfaced in the generated status snapshot.

## Consequences

- Consumers (and future maintainer sessions) can read the support level instead of
  inferring it; fix-effort triage has a default order.
- The dependency-direction check prevents the most expensive failure: a stability-
  promised package inheriting an experiment's breakage.
- Some current edges need review at adoption time (e.g. `@gjsify/storybook`'s
  optional node-gi runtime — already an optional/devDep seam, which is the compliant
  shape).

## Implementation

1. Add `gjsify.tier` to every published package.json (one mechanical PR; defaults:
   pillars+bridges+CLI = 1, design/storybook/devtools = 2, node-gi/browser/CDP = 3).
2. Extend `scripts/audit-runtimes.mjs`: tier presence, tier×dependency direction,
   drift vs the declared tiers.
3. The generated status snapshot lists tier membership; website package index mirrors it.

## Amendment (2026-08-01) — a platform-gated artifact package inherits its parent's tier

Rules 1–4 stand unchanged. Rule 1 forbids an edge from a stable package to a less
stable one; this amendment says what a package must BE for that edge to carry no
such risk, because one kind of package cannot be less stable than the package it
belongs to.

### What went wrong under the unamended rule

`@gjsify/gtk-runtime-win32-x64` and `@gjsify/gtk-runtime-darwin-arm64` are
published (0.26.1, 36 MB / 31 MB of real payload, `os`/`cpu` declared), and
`@gjsify/node-gi`'s `gtk-runtime.js` resolves either the moment it is present in
the tree. **No package declares them as a dependency, so nothing installs them.**
Measured consequence: on a stock Windows or macOS box `gi://` has no GTK, so
`gjsify showcase <name> --runtime node` cannot work for an end user — even though
CI's `windows-gtk-storybook` job proves the bundle itself works. *Built in CI is
not delivered to consumers.*

Neither existing seam closes that gap:

- **Plain tier promotion** is unavailable: rule 2's gate requires *a second real
  consumer*, and node-gi is these bundles' only consumer **by design**. Waiting for
  a second one is waiting for something that must never happen.
- **An optional peer** is exempt from rule 1 — and installs nothing. npm, yarn and
  pnpm all skip `peerDependenciesMeta.optional`, so the compliant shape delivers
  exactly what the status quo delivers.

The mis-fit is in the classification, not in rule 1. These are not experimental
libraries that node-gi happens to use; they are node-gi's own binaries, split into
separate npm names **only** because `os`/`cpu` gating is per-package. Their
stability IS their parent's, by construction — there is no version of "the GTK
bundle broke its contract" that is not "node-gi broke its contract".

### Rule 5

**A platform-gated artifact package inherits the tier of the package whose
artifacts it carries** — it declares that parent, and its `gjsify.tier` MUST EQUAL
the parent's. The parent may then list it in `optionalDependencies` without
violating rule 1.

A package is a *platform-gated artifact package* when all four hold. All four are
machine-checked by the `tier` rule in the manifest-conformance registry (selected
by `audit-runtimes --check` on every PR); this ADR does not restate what that rule
prints.

1. **Platform-gated** — it declares npm `os` and/or `cpu`. This is the whole
   reason it exists as a separate name: a resolver can only skip a *package*, not
   a directory inside one.
2. **It names its parent** — `gjsify.artifactOf: "<parent package name>"`, and the
   parent must list it in `optionalDependencies` (never `dependencies`: a hard
   dependency is `EBADPLATFORM` on every other platform, while a *skipped optional*
   is silent, which is the whole mechanism). The claim is bidirectional on purpose
   — a child naming a parent that does not own it, or a parent edge to a child that
   claims someone else, both fail. Neither side can grant itself the exemption.
3. **It has no dependencies of its own** — `dependencies`, `optionalDependencies`
   and `peerDependencies` are all empty. This is the checkable form of "exposes no
   API that could break a consumer's stability contract": what a JS file in such a
   package may contain is not usefully constrained (ours export four `bundleDir` /
   `binDir` / `typelibDir` / `isPresent` locators, which is exactly the shape the
   parent's loader needs), but a package that imports nothing has nothing whose
   breakage it could inherit. Its blast radius is the payload, and the payload is
   the parent's.
4. **Its only in-repo consumer is that parent.** A second consumer is precisely
   rule 2's promotion gate: at that point the package is a shared dependency with
   its own contract, not a carrier of someone's binaries, and it needs a tier
   argued on its own merits.

Two further points the check holds, both consequences of "one artifact set, one
release":

- **Tier equality, not "at most the parent's tier."** A lower tier on the artifact
  would advertise to a direct consumer a stability the parent does not promise; a
  higher one is rule 1 again. Equality also makes the relation survive edits in
  both directions — demote the parent and the artifact must follow, or CI reds.
- **Exact version lockstep** (the esbuild model, per ADR 0017): the parent pins the
  artifact's EXACT version, and artifact and parent versions are equal (one release
  train, ADR 0008). A range would let `node-gi@0.27.0` resolve a `0.26.x` bundle —
  a skew whose only symptom is a typelib that loads with the wrong ABI on a user's
  machine. Keeping that true across a release bump is a DERIVED step, not
  per-edge configuration: `scripts/sync-artifact-pins.mjs` (release-it's
  `after:bump` hook) re-pins every declared `gjsify.artifactOf` edge from the
  parent's new version, so a new artifact package is covered by existing. The
  rejected first draft — `@release-it/bumper` `out` entries naming each
  `optionalDependencies.<artifact>` path — both races with the
  `packages/*/*/package.json` glob already in that list (bumper reads all targets
  before writing any, so the later write of a doubly-listed file discards the
  earlier one) and would need 51 hand-listed paths after ADR 0017.

### Why fix the rule instead of special-casing node-gi

**ADR 0017 (Accepted) splits all 11 native packages into ~51 per-target packages**
`@gjsify/<name>-<os>-<arch>`, each declaring `os`/`cpu` and referenced from its
main package as an `optionalDependency`. Every one of those 51 is a platform-gated
artifact package, and every one of those references is this edge. Without rule 5,
ADR 0017 cannot land at all for any Tier-1 or Tier-2 native package — which is most
of them.

So the amendment is a **prerequisite for ADR 0017**, not a carve-out for two GTK
bundles. It is also the same argument ADR 0017 used to reject its own Option D: one
derived rule for a whole kind is auditable, 51 hand-argued exceptions are not.

### Consequences

- A Windows or macOS `npm install @gjsify/node-gi` now pulls the matching bundle;
  every other platform silently skips both (optional + `os`/`cpu` mismatch). A
  Linux tree gains nothing to download — verified against `gjsify install`'s
  platform filter, which honours `os`/`cpu`/`libc` since #897.
- `gjsify.artifactOf` is a new declaration kind, therefore claimed by a rule (the
  `field-coverage` rule fails on any `gjsify.*` key no rule claims — that guard is
  why this is stated rather than assumed).
- The artifact package still declares its own `gjsify.tier` rather than having it
  implied. A published tarball must answer "what is this package's support level"
  from its own manifest, without resolving a parent that may not be installed; the
  equality check is what keeps the two answers from diverging.
- Rule 1's exemption is scoped to a *declared, bidirectionally confirmed* artifact
  edge, so it cannot be reached by accident. A genuine Tier-2 → Tier-3 edge still
  fails exactly as before.
- Nothing about this is per-package, which is what makes it ADR-0017-ready: the
  conformance check and the release-time pin sync both DERIVE their edge set from
  the `gjsify.artifactOf` declarations, so the 51st artifact package costs the same
  as the second.
- Not decided here: whether an artifact package also carries `gjsify.platforms`
  (ADR 0017's open question). `gjsify.artifactOf` answers parentage only, and is
  orthogonal to that choice.
