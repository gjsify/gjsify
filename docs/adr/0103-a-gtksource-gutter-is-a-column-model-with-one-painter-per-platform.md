# 103. A GtkSource gutter is a column model with one painter per platform

- Status: **Proposed**
- Date: 2026-10-09
- Deciders: Pascal Garber
- Related: [ADR 0094](0094-gtksource-is-a-headless-core-and-a-nativescript-package.md) (the headless core, the
  driver seam), [ADR 0096](0096-a-gobject-subset-runs-on-the-browser-and-nativescript.md) (a GObject subset),
  [ADR 0098](0098-a-minimal-application-runs-on-the-browser-and-nativescript.md) § 1a (`vfunc_query_data`
  waits for a gutter)

## Rule for every stage

The app-facing API is GTK's: a true subset, the same names, semantics and numeric values. What is not
implemented throws, naming it. A claim needs a conformance vector; a refusal must throw. A developer keeps
the per-platform choice (`.web.ts`, their own driver); no default here blocks it.

## Context

Learn6502's `SourceView` (`packages/app-gnome/src/widgets/source-view.ts`) replaces the built-in line
numbers with its own column. Measured, by reading the app:

- `view.show_line_numbers = false`, then `view.get_gutter(Gtk.TextWindowType.LEFT)`, kept as a field.
- `gutter.insert(renderer, 0)`, `gutter.remove(renderer)`, `gutter.queue_draw()`, `renderer.queue_draw()`.
- The renderer is `class GutterRendererLineNumbers extends GtkSource.GutterRendererText`, registered with
  `GObject.registerClass` (two `Properties`), constructed with `margin_start`, `margin_end`,
  `width_request`, `focus_on_click` and `focusable`.
- It overrides one vfunc, `vfunc_query_data(lines, line)`. The `lines` argument is never read; the body
  assigns `this.text` from the 0-based `line`, in hex or decimal.

Not used: `snapshot_line`, `activate`, `GutterLines`, `GutterRendererPixbuf`, `reorder`, the RIGHT gutter.

Measured against real `gi://GtkSource` on GJS (the vectors in `view-vectors.ts` hold each line):
`get_gutter` answers one `Gutter` per side and `null` for any side but LEFT and RIGHT; `insert` returns a
boolean, `false` when the renderer already belongs to a gutter; `GutterRenderer` is abstract; an unknown
construct property throws; `text` and `markup` clear each other; `set_text(s, n)` cuts at `n` bytes; the
widget defaults are `margin_start` 0, `width_request` -1, `focusable` false, `focus_on_click` true.

## Decision

1. **The model is headless and shared.** `@gjsify/gtksource-core` holds `Gutter`, `GutterRenderer` (abstract)
   and `GutterRendererText`, and a `GutterSet` per view that makes the LEFT and RIGHT gutters on first ask.
   The web and NativeScript views both answer `get_gutter` from it, and `GtkSource.Gutter`,
   `GutterRenderer`, `GutterRendererText` join both namespaces. A renderer is a plain object, not a widget:
   it holds the five widget properties above, in `snake_case` and `camelCase`, and refuses any other.
2. **A gutter is an ordered list of columns; the driver paints them.** The seam is the `EditorDriver` of
   ADR 0094. It is handed the columns left to right: the built-in line numbers at position 0 while
   `show_line_numbers` is true, and each inserted renderer at its position. A column carries its width
   (`width_request`, else the widest label), its margins and a label per line. The web driver adds one
   element per column to the existing gutter element; the Android driver draws each column in
   `drawGutter` with the arithmetic it already uses (`gutterWidth`, `visibleLines`). Neither draws a
   widget per line: only the visible lines are asked for.
3. **`query_data` feeds the label, in the next slice.** For each visible line the session calls
   `renderer.vfunc_query_data(lines, line)` and then reads `text` or `markup`, which is the order
   GtkSourceGutterRendererText snapshots in. `lines` is a minimal `GutterLines`. Until then a text renderer
   shows its constant `text` on every line, as GTK does without the vfunc; this slice paints nothing.
4. **`queue_draw` schedules one repaint per task** of the columns of that gutter, as the web driver
   already batches `paintLine`. It is a no-op until a painter exists.
5. **Held, not acted on:** `focus_on_click` and `focusable` are stored and read back, like `indent-width`
   (ADR 0094 § Deliberate gaps). `activate`, tooltips and `GutterRendererPixbuf` are absent and throw by
   name.
6. **The default blocks nothing.** `show_line_numbers` works with no gutter call; an app that never calls
   `get_gutter` is unchanged; a `.web.ts` or an own driver may paint the columns its own way, since the
   model is public and the painter is the only platform code.

## Open questions

- **Equal positions.** The model keeps insertion order. Real GTK's order for two renderers at one
  position is not observable through the API subset, so no vector holds it. Learn6502 inserts at 0 with
  the built-in numbers off, so it is unaffected.
- **`GObject.registerClass` on a renderer.** ADR 0096 covers widgets. A `GutterRendererText` subclass with
  `Properties` is the first non-widget base; slice 7, where a subclass first matters, checks it.
- **Tap on a column.** Nothing in Learn6502 uses `activate`; a gesture on web and Android is not designed.

## Consequences

- `get_gutter` no longer throws. Code that relied on the refusal gets a `Gutter` that draws nothing until
  the painting slice lands.
- Learn6502's `SourceView` reaches `insert`/`remove`/`queue_draw` unchanged on both targets; its renderer
  subclass needs slice 7 to show anything.
- A renderer is not a `Gtk.Widget` here: `get_parent`, `get_allocated_width` and the other widget verbs
  on it are absent.

## Alternatives rejected

- **Paint a constant now.** A column that repeats one string answers no real use and invites the next
  slice to guess its layout.
- **A bare `show_line_numbers` shim for Learn6502.** It would hide the renderer behind a flag and leave
  every other `GutterRenderer` caller on a refusal.

## What this does not decide

- `GutterLines` beyond the call Learn6502 needs, `snapshot_line`, a Pixbuf renderer, a gutter on the right.

## Implementation

Tracked in `status/open-todos/`. This PR: the model, `get_gutter` on both views, the namespace rows and the
conformance vectors against real `gi://GtkSource`. Next: `vfunc_query_data` and the painters (slice 7).
