# ADR 0007 — Web targets implement the shared controller/view layer (experiment)

- **Status:** Accepted (2026-07-01) — **spike SUCCESS, superseded 2026-07-02 by a full app-web rewrite** (see Spike finding below)
- **Scope:** ecosystem-level; validation lives in `easy6502` (`app-web`, `common-ui`), gjsify side: `@gjsify/adwaita-web`

## Spike finding (2026-07-02) — SUCCESS on all three criteria → ADOPT

The bounded spike (`AdwDebuggerView` over `@gjsify/adwaita-web` driven by the shared
`debuggerController`, `JumpLink/Learn6502#158`) passed every criterion:
(a) `@learn6502/common-ui` was **completely untouched** — the `DebuggerView` + all five
widget interfaces mapped onto Custom Elements with zero signature changes, not even an
additive one; (b) the web view class was **smaller** than its NativeScript twin
(212 vs 231 lines), same widget breakdown and shape; (c) the service→controller→view
event flow worked through the shared `GameConsoleEventBridge` with **no re-implemented
controller**. The controller/view layer is genuinely platform-neutral.

**Decision (maintainer, 2026-07-02):** go beyond per-view migration — REMOVE the classic
skilldrick easy6502 web tutorial and rebuild `app-web` entirely on `@gjsify/adwaita-web`
+ `@learn6502/common-ui` so the web app matches the native Adwaita app (`app-gnome`).
Locked choices: CodeMirror-6-backed Adwaita source editor; hard cutover; the missing
adwaita-web components (`AdwViewStack`, `AdwViewSwitcherBar`, menu button, `adw-source-view`)
built upstream in gjsify; tutorial prose fed from the `@learn6502/learn` package's
prerendered HTML target. Tracked as its own project (`status/open-todos.md` / session memory), not this
ADR. The spike also surfaced adwaita-web packaging gaps (raw-TS `main`/`types`, src-leaked
build artifacts) fixed separately.

## Context

The ecosystem's sharing model works at the right altitude everywhere except the web
UI layer. easy6502 shares `@learn6502/core` (assembler/simulator, 100 %) across all
three targets and `@learn6502/common-ui` (services + controllers + view interfaces)
across GTK **and** Android — but `app-web` re-implements its UI from scratch because
the controller/view-interface pattern "doesn't map to the web's imperative/reactive
style". That reasoning predates `@gjsify/adwaita-web`: Custom Elements *are* a
widget tree, structurally the same shape the GTK and NativeScript views implement.
If a web view class extending/composing adwaita-web elements can implement the same
`MainView`/`DebuggerView`/... interfaces, the story becomes fully coherent — one
controller layer, three widget trees — and `common-ui`'s claim of platform
neutrality gets its strongest test. If it can't, that is equally valuable: it tells
us the view-interface layer is GTK/NS-shaped and should not be advertised as
platform-neutral.

## Amended 2026-08-22 — a second convergence axis exists now

This ADR chose the **controller** layer as the place portability is bought, and the
spike confirmed it: `@learn6502/common-ui` was completely untouched. Nothing below is
retracted.

What has changed is the option set. UI-framework renderers now target GTK directly
(ADR 0027), which puts a second axis on the table that did not exist here: the
**markup vocabulary** itself, shared across native GTK, Blueprint/XML, TSX/JSX, Vue
templates and the `adw-*` elements of this pillar. ADR 0027 § 9 records that as a
goal with a falsifiable criterion, and names the measured obstacle that lives in
THIS pillar: 42 of 51 `adwaita-web` element files re-home `[slot=]` children once, in
`connectedCallback`, so a child appended after mount is never adopted. Fixing that is
web-pillar work (`status/open-todos.md`), and it is the prerequisite for the markup
axis becoming more than an aspiration.

## Decision

1. **Run a bounded spike in easy6502:** implement the *smallest* view interface
   (`DebuggerView` is the candidate — self-contained, minimal event surface) in
   `app-web` as a class over `@gjsify/adwaita-web` elements, driven by the existing
   `common-ui` `DebuggerController` — alongside the current web implementation, not
   replacing it.
2. **Evaluation criteria (written into the spike PR):** no changes to `common-ui`
   interfaces beyond additive fixes; the web view is not materially larger or more
   contorted than its NS twin; event flow (service → controller → view) works
   without a bridging layer that itself re-implements a controller.
3. **Decision point:** criteria met → migrate `app-web` view-by-view to
   `common-ui` + adwaita-web (follow-up PRs, no big-bang); criteria failed →
   update this ADR to `Rejected (spike finding)` with the concrete mismatch
   documented, and formally accept the three-implementations status quo for web.
4. gjsify-side prerequisite work discovered by the spike (missing adwaita-web
   elements, behavior gaps) lands in gjsify per the normal root-cause rule — and
   feeds the ADR-0004 core where the gap is behavioral.

## Consequences

- Either outcome removes the current ambiguity ("web is different" as folklore vs.
  as verified constraint).
- Success collapses the easy6502 UI maintenance from 3 implementations to
  1 controller layer + 3 thin view layers, and gives `common-ui` browser test
  coverage (it becomes runnable under the browser test axis).
- The spike is cheap by design: one view, additive, no migration commitment.

## Implementation

1. Spike PR in easy6502 (`app-web`): `AdwDebuggerView implements DebuggerView` over
   adwaita-web; wire to `DebuggerController`; screenshot + behavior check against
   GTK/Android.
2. Finding recorded here (status update) + easy6502 AGENTS.md.
3. On success: per-view migration backlog in easy6502; on failure: status quo
   documented, question closed.
