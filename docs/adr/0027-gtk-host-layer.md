# 27. One GTK host layer, framework adapters on top

- Status: **Accepted**
- Date: 2026-08-22
- Deciders: Pascal Garber
- Related: [ADR 0004 (headless Adwaita core)](0004-headless-adwaita-core.md), [ADR 0009 (native Adwaita app shell)](0009-native-adwaita-app-shell.md), [ADR 0003 (package tiering)](0003-package-tiering.md), [ADR 0028 (widget table provenance)](0028-widget-table-provenance.md), [ADR 0030 (one corpus, GJS as oracle)](0030-one-corpus-gjs-as-oracle.md)

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
gjs 1.88.1. An earlier revision of this ADR concluded from that "so it is not an
escape hatch either", and that conclusion was wrong.
`vfunc_add_child(builder, child, type)` IS callable from GJS and dispatches
correctly — measured on gjs 1.88.1 / GTK 4.22.4 / Adw 1.10 across 29 containers:
`GtkBox` appends, `AdwHeaderBar` type `title` lands in the title slot, `GtkListBox`
wraps the row, `AdwPreferencesGroup` reaches its internal list. What it is not is a
safe DEFAULT: `GtkLabel.vfunc_add_child` accepts a child, reports nothing, and
surfaces only as `Finalizing GtkLabel …, but it still has children left` at
teardown, exit 0. A wrong child type is a warning followed by a wrong placement;
a move is a `CRITICAL` and a silent no-op. So the table earns its place by refusing
what the generic call accepts, not by being the only way to place a child.

Every container's adoption rule therefore still has to be stated somewhere. Stated
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
`@gjsify/gtk-host` (`{gjs: polyfill, node: polyfill, browser: none, nativescript: none}`).

**`node` was `none` in the first revision of this ADR, and that is amended rather
than quietly corrected.** The host's own source reaches nothing but `gi://`, which
the `--app node` target routes to `@gjsify/node-gi` — measured, a host showcase
builds for that target with no warnings and the bundle carries
`import "@gjsify/node-gi/globals"` and `@gjsify/node-gi/system`, so even the three
GJS-only spellings left in the probe layer (`system`, `print`, `printerr`) are
seeded rather than missing. What pinned the host to GJS was this declaration and a
`test:gjs`-only script, not its code.

`browser` and `nativescript` stay `none`, and that is not the same kind of claim:
on those two targets `gi://` is substituted with `{}`, so a wrong declaration
there fails SILENTLY — which is why the reachability check treats them as fatal
and `node` only as a warning.

The reason this matters most is not portability for its own sake. **There is no
GJS host on Windows**, so `test:gjs` cannot run there at all; node-gi is the only
way this host runs on win32. The enabling defect was in node-gi rather than here —
a class-struct static (`Klass.list_properties()`) was unreachable, and
`paramSpecs()` needs it on every element-creation path — and it is fixed at the
core. Which suite a claim about that belongs in is settled by
[ADR 0030](0030-one-corpus-gjs-as-oracle.md).

This is a DECISION and not yet a description of the manifest: the slot flips in the
same change that gives it a test leg, because a declared runtime with no suite
behind it is exactly the defect ADR 0030 § Decision 6 names.

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
   silent failure is refused by name, one code each — `src/errors.ts` IS the list,
   and carries no count, because a hand-kept one drifts (it said thirteen while the
   file held eighteen). A string enum nick
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
   measured obstacle at the markup layer was in the web pillar, and it is now FIXED:
   an `adwaita-web` element re-homed its `[slot=]` children exactly once, in
   `connectedCallback`, so a child appended afterwards was never adopted. A renderer
   mutates its tree after mount by definition, so that was an upstream fix rather
   than a renderer workaround, and it landed there — `src/slotted-children.ts` is the
   single owner, and adoption is live.

   **The numbers this paragraph used to carry were wrong on both sides, and the
   correction is worth keeping.** It said "42 of 51 element files … only two adopt
   late". Re-measured: the directory holds 55 files, 50 of which define elements, so
   51 matched nothing; 42 was the count of files calling `replaceChildren`, which
   means "installs its own subtree" rather than "has a slot"; and of the 23 that
   really re-homed authored children, exactly ONE adopted a late child. A live count
   inside prose, drifting exactly as the agent-context rules warn.

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
- Adapters share one package version, because they are one implementation of one
  contract rather than three products: each is ~280 lines that reach into this
  host's internals (`insertNode`, `setProp`, the anchor resolution), and none of
  them is separately useful or separately buildable. The cost that stays is real
  and is not hidden: a framework contract break can force a version that the other
  adapters' consumers take along.

  **An earlier revision of this ADR gave a different reason and it is withdrawn.**
  It said the alternative — one npm name per adapter — "costs a manual
  `gjsify onboard` bootstrap each, whose omission left 60+ packages behind in
  v0.4.20". The incident is real and the bootstrap is a real step, but it is a step
  in SHIPPING a name, not a fact about where code belongs. Letting it decide a
  boundary shapes the package tree around a release chore, and it dates instantly:
  `onboard` is idempotent and cheap. Wherever this repo argues a boundary, the
  criterion is structural — a package-level cycle, or independent external
  consumers.

## Implementation

`packages/framework/gtk-host/`, with `./conformance` exporting the table check and
the GTK-tree readers so every adapter runs the same vectors — and
`installDiagnosticsGate()`, because GTK's failure mode is exit 0 and a suite that
never looks at stderr cannot see a mis-parented tree at all. Follow-up work on the
table — the generator, and the import-direction check that lands with the first
adapter — is tracked in `status/open-todos.md`. The per-framework adapters and the
DOM facade are decided here and not yet scheduled.
