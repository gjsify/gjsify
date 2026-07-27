# ADR 0015 — Headless package contract: `gjsify.headless` as a declared, machine-checked promise about the root entry

- **Status:** Accepted (2026-07-27)
- **Scope:** `@gjsify/canvas2d-core` (Tier 1, `packages/dom/`), `@gjsify/adwaita-core` (Tier 2, `packages/web/`), and every future package that documents itself as headless; `scripts/audit-runtimes.mjs`. Introduces one new declarative field, `package.json#gjsify.headless`.
- **Supersedes nothing.** Complements ADR 0003 (`gjsify.tier`), the OS-axis `gjsify.platforms` declaration, and ADR 0014 (`gjsify.runtimeSubpaths` + `polyfill`-slot routing) — all four are declared contracts the audit holds.

## Context

`@gjsify/canvas2d-core` exists because of one property. It was split out of
`@gjsify/canvas2d` to break the `dom-elements ↔ canvas2d` cycle, and AGENTS.md
states the property that makes the split work:

> **Headless** CanvasRenderingContext2D … **NO GTK dependency in the ROOT entry** —
> usable in worker-like contexts.

It nevertheless imported `gi://Gdk` at five call sites (`canvas-pattern.ts`,
`context/drawing.ts`, `context/pixels.ts`). In GTK4, GDK is not a separate
library — `Gdk-4.0` lives inside `libgtk-4.so` — so importing it dlopens the
entire GTK stack. The "headless" core was pulling in GTK on import, for as long
as the package had existed, and the fix (`refactor(canvas2d-core): route pixel
ops through a seam`) had to move that code behind a side-effect subpath,
`@gjsify/canvas2d-core/gdk`.

**No check caught it, and none structurally could.** That is the finding this
ADR responds to; it was verified against the pre-fix tree rather than reasoned
about:

- The **drift check** feeds the `gi_url` source signal into `suggestRuntimes()`
  as an **input**. A `gi://Gdk` import therefore made the declared triplet agree
  with the detector *better*, not worse. It produced agreement, not drift — the
  check is a consistency check between declaration and code, and the code and
  the declaration were consistent. Both were wrong about the same thing.
- The **ADR-0014 reachability pass** is gated on
  `slot === 'polyfill' || slot === 'partial'` across
  `REACH_TARGETS = ['browser','nativescript','node']`. canvas2d-core declares
  `node:"none"`, `browser:"native"`, `nativescript:"none"` — every slot was
  skipped, so `src/**` was never examined at all.

The gap is categorical, not accidental. Every audit in the script models
**cross-runtime** portability: *which of gjs × node × browser × nativescript
does this package reach, and can the code a slot resolves to keep that promise?*
What canvas2d-core promises is **intra-GJS layering**: within the GJS runtime,
headless versus toolkit-bound. That axis had no representation in any
declaration and no check anywhere — the contract lived only in prose, and prose
does not fail a build.

The same layering claim is made elsewhere. `@gjsify/adwaita-core` (ADR 0004)
documents itself as "**Headless** Adwaita widget behavior … pure TS, NO platform
imports". Today that claim happens to be covered as a side effect of its
all-`polyfill` declaration (a `@girs/*` binding anywhere in its `src/**` is a
fatal browser/nativescript reachability failure) — but that coverage is
incidental: it evaporates the moment someone changes an unrelated slot, which is
exactly the shape canvas2d-core is in.

## Decision

### 1. The claim is DECLARED, never inferred

A new field, `package.json#gjsify.headless`. A package that documents itself as
headless says so in its manifest; nothing is guessed.

The rejected alternative was a **name heuristic** (`*-core` ⇒ headless). It is
guessable, which is its only virtue, and wrong by construction:
`@gjsify/adwaita-core` and `@gjsify/storybook-core` are headless for entirely
different reasons (design-behavior extraction vs renderer-agnostic logic),
`@gjsify/webrtc-native` is a `-native` package that is the most toolkit-bound
thing in the tree, and a future `-core` may be headless in neither sense. A
heuristic also silently changes meaning when someone renames a package. A
declaration is honest (the package states its own promise), greppable, and
reviewable in the diff that introduces it — the same reasoning that made
`gjsify.tier` and `gjsify.platforms` declared rather than sniffed.

### 2. Two spellings, because there are two genuinely different promises

```jsonc
"gjsify": { "headless": true }                     // the CLOSED promise
"gjsify": { "headless": ["Gdk", "Gtk"] }           // the SCOPED promise
```

- `true` — the root entry reaches **no typelib at all**: no `gi://`, no
  `@girs/*` value import, no bare `cairo`/`system`/`gettext`, no legacy
  `imports.*` read. This is `@gjsify/adwaita-core`'s "pure TS, NO platform
  imports".
- an array — the root entry reaches **none of the listed typelib namespaces**;
  everything else is permitted. This is `@gjsify/canvas2d-core`, which is
  headless *of GTK* while legitimately binding Cairo + PangoCairo.

A boolean-only field would force canvas2d-core — the package the invariant
exists for — to either lie or opt out, and an invariant that excludes its
motivating case is decorative. A list-only field would force adwaita-core to
enumerate an open-world set ("every typelib that exists"), which is
unmaintainable and silently under-specifies: the namespace nobody thought to
list is exactly the one that leaks. So the field carries the **shape** of the
promise and the check reads it literally. Namespaces compare
case-insensitively, so `@girs/gdkpixbuf-2.0` and `GdkPixbuf` are the same
promise.

An unparseable declaration is a hard failure (`headless-declaration-invalid`),
never a degrade-to-nothing-forbidden — the latter passes on anything.

### 3. The check follows the ROOT entry only

For each declaring package, the audit resolves the source behind
`exports["."]`, walks relative imports inside the package **and** crosses into
the entry every `@gjsify/*` workspace import resolves to, and fails when the
graph reaches a forbidden typelib. Failure to *resolve* the root entry is itself
a failure (`headless-entry-unresolvable`) — a check that silently passes when it
cannot find what it is meant to inspect is worse than no check.

**Root-entry-only is the load-bearing part**, and it is the subtlety that made
the original bug invisible. A side-effect **subpath** may legitimately reach the
forbidden typelibs: the canvas2d-core fix moved the GDK code to
`@gjsify/canvas2d-core/gdk`, which `@gjsify/dom-elements/register/canvas` and
`@gjsify/canvas2d` import explicitly. Scanning `src/**` — what the ADR-0014
reachability pass does for a non-routing slot — would flag that subpath and turn
the *fixed* tree red. The promise the prose makes is about what a bare
`import '@gjsify/canvas2d-core'` pulls in, and that is precisely what is checked.

Crossing workspace edges is deliberate: a headless root that reaches GTK through
a sibling package is no less GTK-bound than one that writes `gi://Gtk` itself.

### 4. It runs in every `--check`, not behind `--strict`

Same reasoning as the tier, platform and reachability audits: it is
declaration-driven, cheap (a static import scan — no build, no evaluation), and
it passes on the current tree. A guard that only runs in a mode CI does not use
is not a guard. CI invokes `--check --strict`, which is a superset.

### 5. Applied to the packages that make the claim

| Package | Declaration | Documented claim |
|---|---|---|
| `@gjsify/canvas2d-core` | `["Gdk", "GdkPixbuf", "Gsk", "Gtk", "Adw"]` | "Headless … NO GTK dependency in the ROOT entry" |
| `@gjsify/adwaita-core` | `true` | "Headless Adwaita widget behavior … pure TS, NO platform imports" |

These are the two packages whose AGENTS.md row and `package.json#description`
both make the headless claim in those words. canvas2d-core's list names the
whole GTK-stack namespace set (`Gtk`/`Gdk`/`Gsk`/`Adw`) plus `GdkPixbuf` —
not merely the namespaces that happened to leak — because the failure mode was
"the root reached one GTK-stack namespace nobody was watching". `GdkPixbuf` is
technically its own library, but the package's documented seam puts it behind
the `/gdk` subpath too (`CanvasImageHandle` is declared structurally in
`pixel-bridge.ts` specifically so the core needs no `gi://GdkPixbuf`), so the
declaration records the contract as documented.

`@gjsify/storybook-core`, `@gjsify/stories` and `@gjsify/devtools-protocol`
describe themselves as *renderer-* / *runtime-* / *transport-agnostic* — a
cross-runtime claim, already fully machine-checked by ADR 0014 through their
all-`polyfill` declarations. They are deliberately left undeclared; adding a
redundant field where the existing invariant already bites would dilute what a
`headless` declaration means. adwaita-core is declared *despite* today's
incidental ADR-0014 coverage precisely because that coverage is contingent on an
unrelated slot value staying put.

## Consequences

- The intra-GJS layering axis becomes a first-class, machine-checked contract
  instead of prose. A regression of the canvas2d-core class now fails CI naming
  the exact import chain from the root entry.
- Splitting a package to obtain a headless core now has a way to *prove* the
  split worked, which is what makes the split worth its cost. The
  `-core` / `/core` guidance in AGENTS.md `### Don't patch — implement at the
  source` gains an enforcement mechanism.
- Cost: one more declared field, and a judgement call per package about what its
  promise actually is. The judgement is the point — a field nobody has to think
  about would be a field that says nothing.
- The check is static and conservative. It follows static ESM imports; a
  `await import('gi://Gtk')` behind a runtime branch is not caught. That is
  consistent with every other reach analysis in the script, and the
  graceful-degradation dynamic-import shape is a sanctioned pattern elsewhere
  (`@gjsify/terminal-native`), so treating it as a violation would be wrong.

## Implementation

1. `scripts/audit-runtimes.mjs`: `auditHeadless()` + the `gjsify.headless`
   declaration shape, wired into `--check` alongside the tier / platform /
   reachability audits. Reuses `collectReachMeta()` (extended with the packages'
   `exports` targets so a subpath import can be followed to its source).
2. Declarations on `@gjsify/canvas2d-core` and `@gjsify/adwaita-core`.
3. AGENTS.md `## Governance — non-negotiable` gains a `|headless:` rule beside
   `|tier:` and `|platforms:`.

**Verified to fire.** Restoring the three pre-fix sources
(`git checkout d88b38c5d^ -- canvas-pattern.ts context/drawing.ts
context/pixels.ts`) makes `--check` exit 1 with four
`headless-contract-violated` findings — one per `gi://Gdk` / `gi://GdkPixbuf`
**value** import, each rendered with its chain from `src/index.ts`; the two
`import type GdkPixbuf` sites are correctly ignored. On that same pre-fix tree
the drift, tier, platform and reachability audits all still report OK, which is
the direct confirmation that the two structural blind spots above are real and
that this check is what closes them.
