# 27. One GTK host layer, framework adapters on top

- Status: **Accepted**
- Date: 2026-08-22
- Deciders: Pascal Garber
- Related: [ADR 0004 (headless Adwaita core)](0004-headless-adwaita-core.md), [ADR 0009 (native Adwaita app shell)](0009-native-adwaita-app-shell.md), [ADR 0003 (package tiering)](0003-package-tiering.md), [ADR 0028 (widget table provenance)](0028-widget-table-provenance.md)

## Context

gjsify can build and run GTK4/Adwaita applications, but only imperatively: a
consumer writes `new Gtk.Box()`, `append()`, `connect()` by hand. Every modern UI
framework wants the opposite — describe the tree, let a renderer reconcile it.
Vue, React, Solid and (pending) Svelte each publish a contract for exactly that,
and Angular publishes `Renderer2`. None of them can be satisfied without a host:
an object model with create / insert / remove / set-property / navigate.

The temptation is to write that host inside the first adapter and generalise
later. NativeScript is the counter-example, and it is measured rather than
argued. It carries five framework flavours over one host (`@nativescript/core`),
and the adapters are tiny because the host exists:

| Flavour | Mechanism | Binding code |
|---|---|---|
| `nativescript-community/solid-js` | `solid-js/universal` | **91 lines** (~18 of real logic) |
| `nativescript-community/react` | `react-reconciler` HostConfig | **505 lines** |
| `@nativescript/angular` | `Renderer2` | **528 lines** |
| `nativescript-vue` v3 | `@vue/runtime-core` `createRenderer` | 434 lines of adapter in a 2 138-line package — the extra 1 704 are host, registry and widget table it carries alone |
| `SudoMaker/dominative` (a DOM facade over the same host) | undom-ng | 856 lines + 38 widgets in 640 |

The first two hold **zero** lines of widget knowledge; they declare `dominative`
as a peer and stop. Under GTK4 the shared share is larger still, because GTK4
deleted `GtkContainer`: there is no generic `add`, and `Gtk.Buildable.add_child`
is introspected as a vfunc only — `typeof headerBar.add_child === 'undefined'` on
gjs 1.88.1 — so every container's adoption rule has to be stated somewhere. Stated
once, that is a table. Stated per adapter, it is the same table three times, and
hand-maintained widget tables are what stalled `react-gtk`, `react-native-gtk4`
and `svelte-gjs`.

Two further GTK facts shaped the contract, both measured on gjs 1.88.1:

1. **GTK's failure mode is exit 0.** `set_property('orientation', 'vertical')`
   emits `GLib-GObject-CRITICAL` and leaves the value at `HORIZONTAL`; the JS
   setter `box.orientation = 'vertical'` does the same with no diagnostic at all;
   writing a read-only property does not throw. A renderer that forwards authored
   values verbatim produces a wrong window and a green test run.
2. **A generic insert bypasses container wrapping.** `insert_before` on a
   `Gtk.ListBox` skips the `GtkListBoxRow` wrap; `get_row_at_index(0)` keeps
   returning the old row, and teardown emitted 1 230 783 lines of
   `Gtk-WARNING: Tried to remove non-child` while the process still exited 0.

## Decision

gjsify owns a framework-agnostic GTK4/Adwaita host as a Tier-3 package,
`@gjsify/gtk-host` (`{gjs: polyfill, node: none, browser: none, nativescript: none}`).

1. **A shadow node tree.** `parent`/`first`/`next` are the host's own links, never
   `Gtk.Widget.get_parent()`/`get_first_child()`. Text nodes and anchors own no
   widget, so the GTK tree cannot answer navigation questions about them. A node
   also carries `attached`, the separate fact of whether GTK has taken it — every
   framework materialises bottom-up, so owning a widget and being in the tree are
   different questions, and conflating them made the replay touch non-children.
2. **Anchors never enter the GTK tree.** Vue's `createComment` and every
   `v-if`/`<Show>` boundary become anchor nodes; insertion resolves forward past
   them to the next node that owns a widget. An empty branch therefore cannot
   shift a sibling's index — the structural bug that stalled `gnome-vue`.
3. **Child placement is data, dispatched on the policy's own `kind`.** Seven policy
   kinds — `none`, `single`, `ordered`, `indexed`, `slotted`, `keyed`, `coords` —
   each naming the methods it calls. (Descriptor lookup is by exact GType name;
   only `mountRoot` walks the hierarchy, through `nearestRegistered`.) A container
   that can only append pays a tail rotation, and `reorderMode()` says so rather
   than claiming a cheap move exists: measured, `Adw.PreferencesGroup.insert`,
   `Gtk.Stack.reorder_child_after` and `Adw.HeaderBar.reorder_child_after` are all
   `undefined`, while the near-identical `Adw.PreferencesPage.insert` is not. The
   rotation appends the new child FIRST — detaching the tail before an append that
   can throw destroyed already-rendered siblings.
4. **Values are coerced against the installed GTK's `GParamSpec`,** and every
   silent failure is refused by name — thirteen codes today. A string enum nick
   that resolves is APPLIED; one that does not is `bad-enum`. `bad-boolean` and
   `bad-flags` refuse the two other types GObject mis-stores silently
   (`Boolean('false')` is TRUE). A signal name is checked against the CLASS, so a
   typo does not wait for a widget to exist.
5. **Construct-only changes rebuild.** The widget is replaced, its position,
   properties and listeners preserved — the move react-three-fiber makes for `args`.
   A construct-only property cannot be patched, and pretending otherwise is a
   silent no-op.
6. **`remove` detaches; `destroy` tears down,** because frameworks move nodes.
   `destroy` disconnects every handler, unparents, drops the reference and closes
   a toplevel window — the one node unparenting cannot reach. It is eager and is
   the only place a handler dies: GJS blocks JS callbacks during GC, so there is
   no finaliser to fall back on.
7. **Adapters are subpaths of this package and carry no widget knowledge.** No
   adapter may contain a widget name literal or an insertion rule.
8. **A GTK-backed DOM facade is not the foundation.** If a DOM sat underneath,
   Vue, React, Solid and Angular would each pay for a parser, an entity table and
   a selector engine to reach `insert` and `setProp`. It remains available as a
   later sibling *over* this host, priced on its own.

9. **One vocabulary across every surface is a GOAL, recorded here so it is worked
   towards rather than rediscovered.** The same widget names should describe the same
   UI in native GTK4 (`GtkBox`, `AdwActionRow`), in Blueprint and the GtkBuilder XML
   it compiles to, in TSX/JSX intrinsic elements, in a Vue template, and in the
   `adw-*` custom elements of `@gjsify/adwaita-web`. New markup in any of them stays
   as close to the others as that surface allows, and a divergence is written down
   rather than absorbed.

   **What this is not yet: a promise that one component tree renders natively and in
   a browser.** ADR 0007 bought portability at the CONTROLLER layer because that was
   what the surfaces allowed at the time — before any framework renderer existed. The
   measured obstacle at the markup layer is in the web pillar: 42 of 51
   `adwaita-web` element files re-home `[slot=]` children exactly once, in
   `connectedCallback`, so a child appended afterwards is never adopted. A renderer
   mutates its tree after mount by definition, so that is an upstream fix, not a
   renderer workaround.

   The criterion that would turn this goal into a decision: **the same authored tree,
   rendered through this host and through `adwaita-web`, satisfies the same
   `@gjsify/adwaita-core/conformance` vectors** — the behaviour contract ADR 0004
   already defines — with no per-surface markup branch. Until then the generated
   table (ADR 0028) is the alignment mechanism rather than the proof: one source
   emits the type surface for each dialect, so a name can only diverge deliberately.

   The longer horizon this points at — generating NativeScript and browser builds
   from one native-authored source, now that several template engines are in play —
   is **not decided here**. It becomes reachable only if the criterion above is met,
   and it would need its own ADR.

## Consequences

- One table serves every adapter, and its correctness is machine-checked against
  the installed typelib: every method and text sink a descriptor names must exist
  on that GType, or `descriptorProblems()` reports it by widget name.
- Placement vectors assert against the **real** GTK tree
  (`get_first_child`/`get_next_sibling`), never the shadow tree — a renderer that
  asserts against its own bookkeeping agrees with itself while the window is wrong.
- Vectors assert **identity** across a reorder, not only order: order alone is
  satisfied by remove-all-and-re-append, which destroys focus and scroll position.
- ADR 0009 § 2 ("never a wrapper that conceals the toolkit") is deliberately
  inverted here and bounded by escape hatches that stay testable: raw GType tags,
  `on:<raw-signal-name>`, direct widget access, and `mountRoot` into an
  application-owned shell — which appends AFTER what the application already put
  there, rather than at position 0.
- Adapters share one package version. A framework contract break can force a
  version that other adapters' consumers take along; the alternative — one npm
  name per adapter — costs a manual `gjsify onboard` bootstrap each, whose
  omission left 60+ packages behind in v0.4.20.

## Implementation

`packages/framework/gtk-host/`, with `./conformance` exporting the table check and
the GTK-tree readers so every adapter runs the same vectors — and
`installDiagnosticsGate()`, because GTK's failure mode is exit 0 and a suite that
never looks at stderr cannot see a mis-parented tree at all. Follow-up work on the
table — the generator, and the import-direction check that lands with the first
adapter — is tracked in `status/open-todos.md`. The per-framework adapters and the
DOM facade are decided here and not yet scheduled.
