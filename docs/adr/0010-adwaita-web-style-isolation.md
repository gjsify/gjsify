# ADR 0010 — adwaita-web style isolation: light-DOM boundary reset + token contract

- **Status:** Accepted (2026-07-24)
- **Scope:** `@gjsify/adwaita-web` (Web pillar, published). Binds its consumers — the gjsify website docs, the browser storybook (`@gjsify/adwaita-storybook`), `easy6502` `app-web`, and the DOM showcases.

## Context

`@gjsify/adwaita-web` renders the Adwaita widget set as **light-DOM Custom Elements**
styled by one global SCSS stylesheet (design-identity axis 4: carry Libadwaita into
the browser so it *composes* with the page and stays themeable via the `--adw-*` /
`--*` design tokens). Light DOM was a deliberate choice — it keeps the widgets
overridable and trivially server-renderable (Astro docs/showcases paint them fully
styled from server HTML, no FOUC).

The open question (raised 2026-07): should the components move to **Shadow DOM** so
they don't break visually when embedded in a host page with conflicting CSS? Shadow
DOM would isolate them — but the isolation is symmetric: a shadow boundary blocks the
host's CSS from leaking *in* **and** from *overriding* in. So naive Shadow DOM buys
"don't break" at the cost of "can't override from outside", which is the exact
friction we want to avoid. A shadow migration is also a real re-architecture
(adopted stylesheets, a `::part`/token API to freeze, Declarative Shadow DOM for SSR,
forms/ARIA-across-boundary care) and would regress the SSR-simplicity the consumers
rely on.

**Evidence (measured, not theoretical).** Dropping the real widgets into a
deliberately hostile host theme (Georgia serif, purple text, `line-height: 2.3`,
`letter-spacing`, generic `button`/`input` rules, a `* { box-sizing: content-box }`
reset) showed the actual exposure: the components' *class-scoped* rules already win
the box/border/background battles against realistic element-level host CSS; what
leaks is **inherited typography** (`font-family`, `color`, `line-height`,
`letter-spacing`, …) into text and elements the components don't explicitly pin, plus
a `*`-reset reaching internal `box-sizing`. That is a narrow, fixable surface — it
does not require Shadow DOM.

A note on `@layer`: cascade layers are an *override-ergonomics* tool, not an isolation
tool. Layered styles LOSE to un-layered styles regardless of specificity, so putting
adwaita in a layer makes it *more* vulnerable to a host's un-layered resets — the
wrong direction for "don't break". Layers are therefore explicitly not used here.

## Decision

Keep adwaita-web **light-DOM** and harden it, rather than migrate to Shadow DOM.

1. **Style-isolation boundary reset** (`scss/_reset.scss`, `@use`d before the
   component partials): every component's custom-element tag re-establishes the
   Adwaita typographic + box-model context (`font-*`, `color`, `line-height`,
   `letter-spacing`, `word-spacing`, `text-align/-indent/-transform/-shadow`,
   `box-sizing`), so a host page's inherited typography stops at each widget
   boundary. A descendant `box-sizing: border-box` pins the box model against a host
   `* {}` reset. It is a FLOOR only — emitted first, so each component's own rules
   override it, and no `!important` is used.

2. **The `--adw-*` / `--*` design tokens are the public theming contract.** Consumers
   re-theme through tokens (which cross any future shadow boundary unchanged) and
   ordinary higher-specificity rules — light DOM keeps full overridability, the thing
   Shadow DOM would take away.

3. **Shadow DOM is the documented future option, not adopted now.** If embedding into
   genuinely hostile third-party pages ever becomes a hard requirement, the path is:
   **open** shadow roots + one shared constructable stylesheet via `adoptedStyleSheets`
   + a deliberate `--adw-*` + `::part()` override API + Declarative Shadow DOM for SSR
   + native `<slot>` (which would also retire the current querySelector slot
   emulation). That is a separate ADR when/if triggered.

4. **No dual-mode.** We do not ship a per-component light/shadow toggle — two styling
   models would double the surface and the bugs.

## Consequences

- **Pro:** widgets survive a hostile host's typography without losing overridability;
  SSR stays trivial (no shadow, no FOUC, no DSD plumbing); a small, low-risk,
  additive change (one partial); no published-API break — only stronger defaults.
- **Con:** not bulletproof against an *adversarial* host (`!important` on inherited
  properties, or rules deliberately targeting `adw-*` internals with high
  specificity) — that is the price of light DOM, and the escape hatch is the Shadow
  DOM path above.
- **Maintenance:** `$adw-components` in `_reset.scss` lists every custom-element tag
  and must stay in sync with `src/elements/*` (the `customElements.define('adw-…')`
  calls). Guarded by the style-isolation browser spec.
- The `--adw-*` token set is now an intentional, documented public contract, not an
  incidental implementation detail.

## Implementation

- `packages/web/adwaita-web/scss/_reset.scss` + `@use 'reset';` in `adwaita-skin.scss`.
- Regression test: `src/style-isolation.spec.ts` (browser axis) embeds a widget in a
  hostile-typography container and asserts its computed `font-family` stays Adwaita.
- Validated on the real widgets: normal rendering unchanged; the hostile-host
  typography leak is blocked (before/after captured during review).
- Follow-ups (`status/open-todos.md`): document the `--adw-*` token contract on the
  website; consider lifting the boundary reset into `@gjsify/adwaita-core` if a second
  light-DOM renderer ever needs it.
