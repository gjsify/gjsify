# @gjsify/gtk-host

The element model UI-framework renderers bind to, for GTK4 and libadwaita.

Vue, React, Solid and Angular each publish a contract for rendering into
something that is not the DOM. What none of them provides is the *something*:
an object model that can create a widget, set a property, adopt a child, and
navigate the result. That is this package.

```ts
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

## The node tree

Three node kinds — `element`, `text`, `anchor` — linked by the host's own
`parent`/`first`/`next`, never by `Gtk.Widget.get_parent()`. Text and anchors own
no widget, so GTK cannot answer navigation questions about them.

**Anchors never enter the GTK tree.** Vue's `createComment` and every
`v-if`/`<Show>` boundary becomes one, and insertion resolves forward past it to
the next node that owns a widget. An empty branch therefore cannot shift a
sibling's index.

**Text has no node in GTK.** It goes to the owning widget's declared `textSink`
(`Gtk.Label:label`, `Gtk.Entry:text`, …). A widget without one rejects text by name.

## Child placement

Seven policy kinds, declared per widget as data and dispatched by
`GObject.type_is_a`:

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
table, not a surprise in an app.

## Lifetime

`remove` detaches and is reversible, because frameworks move nodes. `destroy`
tears a subtree down: it disconnects every handler, unparents, drops the
reference, and closes a toplevel window (the one node unparenting cannot reach —
it has no parent and its `GtkApplication` still holds it). It is recursive, it is
eager, and it is the only place a handler dies: GJS blocks JS callbacks during
GC, so **whatever is not disconnected here stays connected for the life of the
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

Adapters run the same vectors, so "it works in Vue" and "it works in Solid" mean
the same thing.
