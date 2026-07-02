# ADR 0004 — Headless Adwaita core: share widget behavior across renderers

- **Status:** Accepted (2026-07-01)
- **Scope:** `@gjsify/adwaita-web`, `@gjsify/adwaita-nativescript`, new `@gjsify/adwaita-core`

## Context

The Adwaita design identity ships as three parallel widget implementations: native
Libadwaita (GTK — upstream, not ours to change), `adwaita-web` (Custom Elements),
and `adwaita-nativescript` (42 widgets over real NS views). Shared today: story
metadata (`*.meta.ts` via `@gjsify/stories`), assets (`adwaita-fonts`,
`adwaita-icons`), and the design-token CSS. NOT shared: every piece of *behavior* —
expander/toggle state, combo selection, spin clamping, toast queueing + auto-dismiss,
dialog response models, breakpoint evaluation, color-scheme observing. A behavior
fix costs 2× (web + NS), and divergence between the two is only caught by the
screenshot-parity harness after the fact.

The workspace has already proven the fix pattern on itself:
`@gjsify/storybook-core` (`StoryViewBase<TNode>`, `StoryRegistry`, `bindControl`,
`StorybookController`) holds all renderer-agnostic logic, and three thin renderers
compose it — pure TS, all-`polyfill`, 92 specs on GJS + Node + browser. Several
core-shaped pieces even exist already but live in the wrong place:
`parseBreakpointCondition`/`AdwBreakpoint` and the `color-scheme` observable are
implemented inside `adwaita-nativescript` although they contain no NS-specific code.

## Decision

1. Create **`@gjsify/adwaita-core`** (`packages/web/adwaita-core/` or
   `packages/framework/` — decide by first PR; pure TS, runtimes all-`polyfill`,
   no platform imports): headless widget behavior — state machines, interaction
   logic, a11y semantics — following the `storybook-core` / `StoryViewBase<TNode>`
   seam pattern. `adwaita-web` and `adwaita-nativescript` become thin render
   adapters over it. GTK stays native Libadwaita (core aligns the two ports, it
   does not re-implement GTK).
2. **Migration is opportunistic, not a rewrite** (mirrors the cross-runtime
   convention): new widgets start in core; an existing widget moves when it is
   touched for a behavior change anyway. No "while-I'm-here" sweeps.
3. **Seed with what is already duplicated or misplaced:** breakpoint condition
   parsing/evaluation, the color-scheme observable, toast queue/auto-dismiss,
   expander/combo/spin/toggle-group state, dialog response model. These are pure
   logic with existing tests to port.
4. The pure-JS→native rule from AGENTS.md ("lift into a `-core` package") applies —
   this ADR is that rule applied to the design-identity axis.

## Consequences

- Behavior fixes land once; renderers only re-render. Screenshot parity shifts from
  "detect divergence" to "verify rendering", which is what it is good at.
- Core logic becomes testable on GJS + Node + browser without a device/emulator —
  today NS widget logic is only exercised through mock-based NS specs.
- A new renderer (e.g. a future iOS pass, or GTK-side helpers) starts from behavior
  parity for free.
- Cost: one more package on the release train, and a seam design per widget family
  (the `<TNode>`-generic chrome pattern is the template — resist over-abstracting;
  a widget with genuinely trivial behavior does not need a core class).

## Implementation

1. Package scaffold + move `parseBreakpointCondition` + `color-scheme` (both consumed
   from NS via re-export, no consumer-visible break).
2. Toast queue + dialog response model (web + NS adapt).
3. Row/state machines (expander, combo, spin, toggle-group) as they are next touched.
4. STATUS.md widget tables note per-widget core adoption; `adwaita-web` and
   `adwaita-nativescript` declare the core dep.
