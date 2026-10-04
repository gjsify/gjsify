# 90. A `layout { }` block becomes a `layout` field, and a renderer places the child or refuses it

- Status: **Proposed**
- Date: 2026-10-04
- Deciders: Pascal Garber
- Related: [ADR 0051 (one authored tree, rendered)](0051-one-authored-tree-rendered.md),
  [ADR 0053 (Blueprint parsed in-repo)](0053-blueprint-parsed-in-repo.md),
  [ADR 0072 (typed `extensions`)](0072-value-lists-become-a-typed-extensions-field.md)

## Context

Learn6502's `debug-info.blp` places sixteen labels in a `Gtk.Grid` with
`layout { row: 0; column: 1; }`. ADR 0072 listed `layout` among the blocks that stay losses
("no gallery page needs them"), so `?shared-tree` refused the file. A page needs it now, and the
shape is the simplest of the extensions: GtkBuilder writes the block as
`<layout><property name="row">0</property>…</layout>`, a bag of scalars that belongs to the
child's *layout-manager child object* (`GtkGridLayoutChild`), not to the widget.

## Decision

### 1. One optional field, a record of scalars

`SharedNode.layout?: Record<string, string | number | boolean>`, in source order. It is NOT folded
into `props`: `halign` in a layout block names the layout child's property and collides by name
with the widget's own, which is why ADR 0072 refused to fold `accessibility` the same way.

Values keep **the spelling the source wrote** and are not resolved through the widget — the XML
exit does the same (`19-layout.blp`: `halign: center` stays `center`; `37-layout-untyped-ident.blp`:
`column: null` stays `null`). A block holding a non-scalar entry stays a `layout` loss.

The GtkBuilder XML exit is untouched: stage C of `check-blueprint-corpus.mjs` still holds every
file byte-equal. Stage D gains a layout arm that compares the `<property>` elements inside each
golden `<layout>` with what the projection carries.

### 2. What each renderer does

| renderer | `layout` |
|---|---|
| `adwaita-nativescript` | written on the child BEFORE it is handed to the parent: `row`, `column`, `row-span`, `column-span` become NativeScript's `row`, `column`, `rowSpan`, `columnSpan`; only a `Gtk.Grid`-like parent (one with `attach`) takes it |
| `adwaita-web` | refused by name |
| `gtk-host` | refused by name |

The NativeScript builder refuses, naming the key: a key a grid child has no spelling for
(`halign`), a value that is not a whole number (`column: null`), and a parent with no layout
manager. Each would otherwise be a cell the tree asked for and never got.

Web and gtk-host refuse rather than ignore, by ADR 0071 § 3's reasoning: a grid child with no cell
lands on the first one at exit 0. A renderer that gains a door removes its refusal.

## Consequences

- Every `layout` entry in the corpus is carried and held against the oracle; the rule files that
  declared a `layout` loss declare none.
- `SharedTreeNode` has a seventh optional field; `check-shared-tree-shape.mjs` holds every
  restatement.
- `debug-info.blp` stops being refused for `layout`.

## Alternatives rejected

- **Placement as `props`** (`props['layout.row']`). A dotted key in a bag of widget properties
  invites a renderer to write it on the widget, which is the silent dead write the builders refuse.
- **Typing the entries against `GtkGridLayoutChild`.** The reference compiler does not either, and
  an untyped value is a measured oracle behaviour.
