# @gjsify/adwaita-web

Browser Adwaita UI components as Custom Elements, bringing the Libadwaita look (light/dark) to the web with no GJS dependencies. Backed by SCSS that mirrors the upstream `refs/adwaita-web` and `refs/libadwaita` color/sizing tokens.

Write the tags — `<adw-window>`, `<adw-header-bar>`, `<gtk-button>`, `<gtk-entry>`, `<adw-preferences-group>`, `<adw-switch-row>`, `<adw-overlay-split-view>` and the rest — or reach the classes through the GIR namespace the tag names: `Adw.Window`, `Gtk.Button`, `Adw.OverlaySplitView`. Each tag carries the prefix of the library that owns its GType, and the namespace member is that split read back (ADR 0034). There are no `AdwWindow`/`GtkButton` class exports at the package root; the elements with no GTK counterpart at all — `AdwCard`, `AdwDataGrid`, the declarative page and slot wrappers — keep their flat name, because it is their only one.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/adwaita-web

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/adwaita-web
yarn add @gjsify/adwaita-web
```

## Usage

```typescript
// Registers all custom elements and self-applies the compiled stylesheet.
import '@gjsify/adwaita-web';
```

It does **not** register the Adwaita Sans `@font-face`, and that is a size
decision rather than an omission: the two faces inlined are 2.39 MB / 1.18 MB
gzip against a 190 KB / 26 KB stylesheet, and `gjsify build --app browser` has no
code splitting, so a lazy face costs the same bytes as an eager one. The
stylesheet names the family; on a GNOME host the system install resolves it.
Where that is not good enough — an app served to arbitrary browsers — opt in:

```typescript
import { applyAdwaitaFonts } from '@gjsify/adwaita-web/fonts';

applyAdwaitaFonts(); // idempotent; injects both faces as `data:` URIs
```

> The stylesheet is injected on import, so a separate `import '@gjsify/adwaita-web/style.css'` is not required (and under a bundler with its own CSS pipeline it injects the same rules twice). The compiled CSS is still exported at `@gjsify/adwaita-web/style.css` if you prefer a static `<link>` with no JS injection.

```html
<adw-window>
  <adw-header-bar slot="header">
    <span slot="title">My App</span>
  </adw-header-bar>
  <adw-preferences-group title="Settings">
    <adw-switch-row title="Dark mode"></adw-switch-row>
  </adw-preferences-group>
</adw-window>
```

The package entry is TypeScript (`src/index.ts`), consumed via a
TypeScript-compiling build — `gjsify build --app browser` / the `gjsifyBrowser()`
Vite preset (or any Vite/bundler setup). Type declarations are shipped
pre-built at `lib/types/index.d.ts`, so `gjsify tsc` consumers resolve the
package's types without compiling its source.

## Slots are live

These are light-DOM custom elements, so `slot="…"` is emulated rather than native
(see [ADR 0010](../../../docs/adr/0010-adwaita-web-style-isolation.md) for why the
package stays out of the shadow DOM). The emulation is **live**: a child appended
after the element is in the document lands in the same internal box as the
identical child written in the markup.

```typescript
const row = document.querySelector('adw-action-row')!;
const toggle = document.createElement('gtk-switch');
toggle.setAttribute('slot', 'suffix');
row.append(toggle); // lands in the suffix section, exactly as a declared one does
```

Two limits are worth knowing:

- **Append, not reorder.** A late child goes to the end of its slot's box. Once a
  child has been adopted it is no longer a child of the host, so
  `host.insertBefore(next, adopted)` throws in the DOM before this package sees
  it — reorder inside the box you were handed (`row.prefixSection`,
  `view.topBar`, …). Native `<slot>` is what would lift this, and it is part of
  the shadow-DOM path ADR 0010 defers.
- **An unknown slot name is assigned nowhere**, as in the native algorithm: a
  `slot="sufix"` typo stays where you put it instead of quietly becoming default
  content in the wrong box.

## Shared behaviour (`@gjsify/adwaita-core`)

The widget *behaviour* — as opposed to the DOM rendering — comes from
[`@gjsify/adwaita-core`](../adwaita-core), the headless Adwaita layer defined by
[ADR 0004](../../../docs/adr/0004-headless-adwaita-core.md). It is pure TypeScript
with no platform imports, and `@gjsify/adwaita-nativescript` composes the exact
same state machines, so a behaviour fix lands once and both ports pick it up.

| Element | Core state machine | What core owns |
| --- | --- | --- |
| `<adw-toast-overlay>` | `AdwToastQueue` + `AdwToast` | one toast at a time, FIFO ordering, auto-dismiss lifecycle |
| `<adw-combo-row>` | `ComboState` | the list model + its `items-changed` splice, index↔value mapping, out-of-range guards, programmatic-vs-user split |
| `<adw-spin-row>` | `SpinState` | value/min/max/step with clamping on every mutation |
| `<adw-toggle-group>` | `ToggleGroupState` | segment list, guarded active index |
| `<adw-expander-row>` | `ExpanderState` | expanded/collapsed disclosure |
| `<adw-alert-dialog>` | `AdwAlertResponses` | response registry, default/close response, resolve-to-chosen-id |

Each element keeps only the DOM half: the markup, the CSS classes and the
`notify::*` / `response` `CustomEvent`s. The public element API is unchanged —
the composition is an implementation detail.

### Toasts are queued, one at a time

`<adw-toast-overlay>` follows `Adw.ToastOverlay`: it shows **exactly one** toast
and queues the rest FIFO. Each queued toast is shown only after the visible one
is dismissed — by its timeout, by its close button, by its action button, or by
`dismiss()`.

```typescript
const overlay = document.querySelector('adw-toast-overlay');

overlay.addToast('File moved to Trash', { timeout: 3, buttonLabel: 'Undo', onAction: undo });
overlay.addToast('Second file moved');   // waits its turn — not shown yet

overlay.currentToast?.title;  // 'File moved to Trash'
overlay.pendingToasts;        // 1

overlay.dismiss();      // show the next queued toast now
overlay.clearToasts();  // dismiss the visible one and drop the queue
```

`addToast()`'s `timeout` is in **seconds** (mirroring `Adw.Toast:timeout`); `0`
keeps the toast until it is dismissed and holds the queue behind it. The
auto-dismiss runs on the browser's timers by default; assign
`overlay.scheduler` a custom `ToastScheduler` (the seam `@gjsify/adwaita-core`
defines) to drive toast lifetimes from your own clock — that is how the
package's own regression tests advance time without real timers.

## Theming a page without `<adw-window>`

The components read their colours from the `--window-*` CSS custom properties,
but only `<adw-window>` paints the window surface. A page that lays out rows or
cards directly on `<body>` (no window chrome) therefore renders on the browser
default and its native controls ignore the dark scheme. Opt into the Adwaita
surface + light/dark `color-scheme` by adding the `adw-root` class to `<body>`
(or the `:root`/`<html>` element):

```html
<body class="adw-root">
  <adw-preferences-group title="Settings">
    <adw-switch-row title="Dark mode"></adw-switch-row>
  </adw-preferences-group>
</body>
```

`adw-root` is opt-in and additive — it binds `--window-bg-color` /
`--window-fg-color` + `color-scheme: light dark` to the page and changes nothing
about the individual components.

## Icons, and the ones the stylesheet does not ship

A `<gtk-image icon-name="go-next">` is a CSS mask: the box takes its colour from
`currentColor` and a generated `.adw-icon--<name>` class supplies the `mask-image`, so the
glyph re-themes with whatever contains it. The names that resolve are a **chosen subset** of
[`@gjsify/adwaita-icons`](../adwaita-icons) — a few dozen of them, plus one glyph drawn
locally — because inlining the whole set as data-URIs costs about 1.07 MB, roughly five
times the stylesheet it would sit in.

A name outside that subset draws **`image-missing`**, the broken-image glyph libadwaita
itself substitutes when it has no icon to draw. So does a name that could never be a mask
class at all — a space, a quote, a reverse-DNS application id — because
`gtk_icon_theme_lookup_icon` has no "found nothing" answer either. It is deliberately
visible: the icon has not silently disappeared, and nothing throws — an icon is decorative,
and neither of the other two Adwaita renderers takes an application down over a glyph. Only
an **absent or empty** name draws nothing, which is the host declining an icon.

### Registering your own

```typescript
import { registerIcon, isIconAvailable } from '@gjsify/adwaita-web';
import { dialogErrorSymbolic } from '@gjsify/adwaita-icons/status';

if (!isIconAvailable('dialog-error')) {
    registerIcon('dialog-error-symbolic', dialogErrorSymbolic);
}
```

```html
<gtk-image icon-name="dialog-error"></gtk-image>
<!-- …or any widget attribute that takes an icon name -->
<adw-status-page icon="dialog-error" title="Could not connect"></adw-status-page>
```

`registerIcon(name, svg)` takes the icon's **SVG source** — exactly what
`@gjsify/adwaita-icons` exports, and equally any symbolic SVG of your own drawn on the 16px
Adwaita grid with `fill="currentColor"`. It writes the same pair the build writes: a
`--icon-<name>` custom property on the document element and a `.adw-icon--<name>` mask rule,
so from then on the name is indistinguishable from a compiled one — in `<gtk-image>`, in a
widget attribute, in a hand-written `class="adw-icon adw-icon--dialog-error"`, and in your
own CSS as `var(--icon-dialog-error)`.

Notes worth having:

- **Register before you mount, where you can.** An icon already in the document shows the
  fallback until the registration lands. The CSS is live, so it corrects itself on the next
  style recalculation with no re-render — but there is a visible frame in between.
- **`registerIcon` needs a live document.** It writes to `document.documentElement` and
  `document.head`, so calling it at module top level in an SSR/SSG build (an Astro component
  module, for instance) throws a `ReferenceError` before any page renders. Call it from
  client-side code — an `onMount`, a `client:load` boundary, a `DOMContentLoaded` handler.
- **The name is normalized the same way the attribute is**: one optional `-symbolic` suffix
  comes off, and what is left has to be a single CSS token. `registerIcon` *throws* on a name
  that is not (`org.gnome.Builder`, `a b`), because a call that silently registers nothing is
  the failure this whole area exists to end — and because there is no mask class such a name
  could be given. `<gtk-image>` stays lenient with the same input: the name came from markup,
  so it draws `image-missing` rather than taking the page down.
- **Re-registering replaces the glyph** rather than adding a second rule, so a runtime theme
  switch can call it as often as it likes.
- `isIconAvailable(name)` reads the live cascade, not a generated list, so it also answers
  `true` for a glyph you supplied through your own stylesheet's `--icon-<name>`.

### Why this is a web-only concern

The three Adwaita renderers resolve an icon name three different ways, and it is worth
knowing which one you are on:

| Renderer | How a name resolves | An unknown name |
| --- | --- | --- |
| GTK (`@gjsify/adwaita-app`) | `GtkIconTheme` looks it up in the **system** icon theme at runtime | draws the theme's `image-missing` |
| NativeScript (`@gjsify/adwaita-nativescript`) | `AdwIcon` is handed the **SVG source**, not a name | cannot happen — a missing icon is a missing import |
| Web (this package) | a **compile-time** subset, plus `registerIcon` | draws `image-missing` |

All three therefore end on ONE glyph for a name they cannot draw. The web reaches it by two
routes — no mask class for a known-shaped name, or no usable class for a name like
`org.gnome.Builder` — and a dotted name has no registration path, so that second route is
where it stays.

Only the web renderer has a set that can be missing something at runtime, which is why only
it needs a registration path. `scripts/check-adwaita-icon-masks.mjs` holds the compiled
subset against every name this repository's SHIPPING surfaces emit, in both directions, and
fails on a compiled glyph that did not come from `@gjsify/adwaita-icons`.

## Source-code editor (`adw-source-view`)

An Adwaita-styled source editor — the web twin of GtkSourceView — is available as
an **opt-in subpath** so its CodeMirror dependency never bloats the core bundle:

```typescript
import '@gjsify/adwaita-web';              // app chrome (theme variables, components)
import '@gjsify/adwaita-web/source-view';  // registers <adw-source-view>
```

```html
<!-- Editable 6502 editor with a line-number gutter and a copy button -->
<adw-source-view line-numbers editable copyable style="height: 260px"></adw-source-view>

<!-- Read-only hex monitor: the gutter renders 4-digit hex addresses -->
<adw-source-view
  line-numbers hex-addresses line-number-start="1536"
  readonly copyable language=""></adw-source-view>
```

Backed by CodeMirror 6, it maps 1:1 onto the `common-ui` `SourceViewWidget`
interface: `code`, `editable`/`readonly`, `selectable`, `lineNumbers`,
`lineNumberStart`, `copyable`, `copyButtonIcon`, `copyButtonTooltip`, plus a
`hexAddresses` gutter mode (hex-address line numbers for the monitor / hexdump /
disassembled panes) and a `language` toggle (`6502` enables 6502-assembly syntax
highlighting; empty = plain text). It ships an Adwaita CodeMirror theme mapped to
the same CSS variables, so it follows light + dark automatically. Edits emit a
`code-changed` `CustomEvent` (programmatic `.code =` is suppressed for two-way
binding), the copy button copies the buffer (whitespace-stripped in hex mode),
and the widget is pinned LTR regardless of page direction.

## License

MIT
