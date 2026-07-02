# ADR 0003 — Explicit package tiering (stability contract)

- **Status:** Accepted (2026-07-01)
- **Scope:** all published `@gjsify/*` packages; STATUS.md; `scripts/audit-runtimes.mjs`

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
  new until promoted. README + STATUS.md mark them experimental.

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
   surfaced in the STATUS.md package tables.

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
   drift vs STATUS.md tables.
3. STATUS.md package tables gain a Tier column; website package index mirrors it.
