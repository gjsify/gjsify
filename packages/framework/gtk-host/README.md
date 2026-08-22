# @gjsify/gtk-host

The element model UI-framework renderers bind to, for GTK4 and libadwaita.

Vue, React, Solid and Angular each publish a contract for rendering into
something that is not the DOM. What none of them provides is the *something*:
an object model that can create a widget, set a property, adopt a child, and
navigate the result. That is this package.

```ts
import type Adw from '@girs/adw-1';
import { createElement, insert, materialize, registerBuiltinWidgets } from '@gjsify/gtk-host';

registerBuiltinWidgets();

const window = createElement('AdwApplicationWindow', { title: 'Hello' });
const box    = createElement('GtkBox', { orientation: 'vertical', spacing: 12 });
const button = createElement('GtkButton', { label: 'Press me' });

insert(box, window);
insert(button, box);
(materialize(window) as Adw.ApplicationWindow).present();
```

## Why a shared host

NativeScript carries five framework flavours over one host, and the adapters are
small because the host exists: its Solid adapter is **91 lines**, its React
adapter **505** — and both hold *zero* lines of widget knowledge. Under GTK4 the
shared share is larger still: GTK4 deleted `GtkContainer`, so there is no generic
`add`, and `Gtk.Buildable.add_child` is introspected as a vfunc only. Every
container's adoption rule has to be written down somewhere. Written once, it is a
table; written per adapter, it is the same table three times — which is what
stalled `react-gtk`, `react-native-gtk4` and `svelte-gjs`.

See [ADR 0027](../../../docs/adr/0027-gtk-host-layer.md) and
[ADR 0028](../../../docs/adr/0028-widget-table-provenance.md).

## What it refuses to do quietly

GTK's failure mode is exit 0, so this host is loud on purpose. Measured on
gjs 1.88.1:

| What you write | What GObject does | What this host does |
|---|---|---|
| `orientation: 'vertical'` | keeps `HORIZONTAL`; `set_property` logs `GLib-GObject-CRITICAL`, the JS setter says nothing at all | resolves the nick against the enum's GType |
| `orientation: 'sideways'` | same silence | throws, naming `GtkOrientation` |
| a read-only property | accepts the write, stores nothing | throws, naming the property |
| a misspelled property | nothing | throws, naming the widget |
| text inside `<GtkImage>` | nothing | throws, naming the tag and the fix |
| a child under a childless widget | `Gtk-WARNING` at exit 0 | throws, naming the three fixes |
| `selectable: 'false'` (a string) | JS truthiness makes it TRUE | honours `'true'`/`'false'`, throws on any other string |
| a string for a flags property | dropped silently | throws, naming the flags GType and asking for the numeric value |

## The node tree

Three node kinds — `element`, `text`, `anchor` — linked by the host's own
`parent`/`first`/`next`, never by `Gtk.Widget.get_parent()`. Text and anchors own
no widget, so GTK cannot answer navigation questions about them.

**Anchors never enter the GTK tree.** Vue's `createComment` and every
`v-if`/`<Show>` boundary becomes one, and insertion resolves forward past it to
the next node that owns a widget. An empty branch therefore cannot shift a
sibling's index.

**An element is `attached` only once GTK has taken it.** Owning a widget is not
the same fact: every framework materialises a subtree bottom-up, long before
inserting it. Placement reads `attached`, never `widget !== null` — deriving it
from the widget made the `remove-all` policy detach non-children and re-add
already-parented ones, at exit 0.

**Text has no node in GTK.** It goes to the owning widget's declared `textSink`
(`Gtk.Label:label`, `Gtk.Entry:text`, …). A widget without one rejects text by name.

## Child placement

Seven policy kinds, declared per widget as data and dispatched on the policy's
own `kind`. Descriptor lookup is by exact GType name; `mountRoot` is the one path
that walks the type hierarchy (`GObject.type_is_a`, via `nearestRegistered`), so
an application's own subclass resolves to its ancestor's rules:

| kind | example | how a child lands |
|---|---|---|
| `single` | `AdwBin`, `GtkWindow` | `set_child` / `set_content` |
| `ordered` | `GtkBox` | `append` + `insert_child_after` |
| `indexed` | `GtkListBox` | `insert(row, i)` — the parent addresses a **wrapper** row |
| `slotted` | `AdwHeaderBar` | `pack_start` / `pack_end` / `set_title_widget`, chosen by the child's `slot` |
| `keyed` | `GtkStack` | `add_titled(child, name, title)` |
| `coords` | `GtkGrid` | `attach(child, column, row, …)` |
| `none` | `GtkLabel` | rejected, with the three fixes named |

A container that cannot reorder in place declares it. `Adw.PreferencesGroup` has
`add` and `remove` and no `insert` — measured — so it declares
`reorder: 'remove-all'` and pays a tail re-append. The degradation is in the
table, not a surprise in an app. The re-append is ordered so a refusal costs
nothing: the new child is appended FIRST, then the tail is rotated — detaching the
tail first and failing on the append took already-rendered siblings with it.

Its sibling `Adw.PreferencesPage` looks identical and is not: `insert(group, i)`
exists there, so it uses `indexed` and reorders natively. Near-identical APIs with
opposite capabilities are exactly why the table is measured per widget rather than
inherited.

`slot` and `layout` are props the CHILD declares: `slot="end"` picks a `slotted`
attachment point, `layout={{ column, row, columnSpan, rowSpan }}` a `coords` cell,
`layout={{ name, title }}` a `keyed` page. Both are read at placement time, so
changing either RE-PLACES the child rather than doing nothing.

## Lifetime

`remove` detaches and is reversible, because frameworks move nodes. The wrapper
row an `indexed` parent demanded is handed back at the same time — it belongs to
that parent, and dragging a `GtkListBoxRow` into the next one would carry the
still-parented widget with it — so a re-insert gets a fresh row. Author your own
`<GtkListBoxRow>` when the row itself holds state. `destroy`
tears a subtree down: it disconnects every handler, unparents, drops the
reference, and closes a toplevel window (the one node unparenting cannot reach —
it has no parent and its `GtkApplication` still holds it). It is recursive, it is
eager, and it is the only place a handler is disconnected for good — a rebuild
disconnects and re-binds, a re-render replaces. GJS blocks JS callbacks during GC,
so **whatever is not disconnected here stays connected for the life of the
process**.

Construct-only properties cannot be patched; GObject accepts the write and keeps
the old value. Changing one **rebuilds** the widget in place, preserving position,
properties and listeners.

## Conformance

`@gjsify/gtk-host/conformance` exports the checks that keep the table honest and
the readers every vector asserts through:

- `descriptorProblems()` — every method and text sink a descriptor names must
  exist on that GType in the *installed* GTK.
- `gtkChildren()` / `gtkChildTypes()` / `dumpTree()` — read the **real** widget
  tree. A renderer that asserts against its own bookkeeping agrees with itself
  while the window is wrong.

## Adapters

`@gjsify/gtk-host/solid` is the first, and it is the thesis made checkable: Solid
publishes a ten-method renderer contract, every one of them is a host op, and the
adapter is the mapping — no widget name, no insertion rule, no GTK knowledge.
`scripts/check-adapter-import-direction.mjs` holds it to that mechanically.

```ts
import { For, createElement, insert, mount, setSolidProp } from '@gjsify/gtk-host/solid';

const dispose = mount(() => {
    const box = createElement('GtkBox');
    insert(box, createComponent(For, { get each() { return items(); }, children: renderRow }));
    return box;
}, myWindow);
```

Two things the adapter has to know that the contract does not say:

- **`removeNode` is a detach, never a teardown.** Solid uses one op for a
  reconciliation move and for an unmount, and `<For>` moves the same nodes across a
  reorder (measured: 3 of 3 widget objects reused). Destroying there would recreate
  every row on every reorder.
- **`solid-js/universal`'s `render` returns the disposer and nothing else** — the
  DOM renderer additionally clears its container, the universal one has no
  equivalent, so disposing tears down the reactive scopes and leaves the widgets
  mounted (measured: a button kept firing). Tearing the subtree down is `mount`'s job.

Solid's control-flow components (`For`, `Index`, `Show`) are re-exported re-typed:
their runtime is renderer-agnostic, their types are pinned to the DOM's `Element`.

Vue and React adapters will run the same vectors, so "it works in Vue" and "it
works in Solid" will mean the same thing.
