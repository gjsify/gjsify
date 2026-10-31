# 128. A menu model is a REAL `Gio.MenuModel`, and the abstract base is a CLASS

- Status: **Accepted** (owner, 2026-10-30)
- Date: 2026-10-30
- Deciders: Pascal Garber
- Amends: [ADR 0042 (portable menu model)](0042-portable-menu-model.md) — the TYPE the name
  `AdwMenuModel` stands for, and what a `menu-model` PROPERTY accepts; not § 1's scope, not the
  portable vocabulary, and not the markup door
- Depends on: [ADR 0122 (a string list is a real list model)](0122-a-string-list-is-a-real-list-model.md)
  § 4 (the seam's object kind and its identity rule) and its A4 amendment (the `Gjsify*` prefix,
  and `reconcile()` as the markup door's update path),
  [ADR 0096 (a GObject subset on the browser and NativeScript)](0096-a-gobject-subset-runs-on-the-browser-and-nativescript.md),
  [ADR 0118 (a GLib.Variant subset)](0118-a-glib-variant-subset-runs-on-the-browser-and-nativescript.md) § 2
- Related: [ADR 0097 (menus and actions on the browser and NativeScript)](0097-menus-and-actions-run-on-the-browser-and-nativescript.md),
  [ADR 0030 (one corpus, GJS as oracle)](0030-one-corpus-gjs-as-oracle.md),
  [ADR 0034 (widget vocabulary convergence)](0034-widget-vocabulary-convergence.md) clause 1;
  `packages/web/adwaita-core/src/{gio-menu.ts,menu.ts}`,
  `packages/framework/gtk-host/src/{menu.ts,props.ts}`

## Rule for every stage

The API is GTK's and GJS's. A stage may implement a strict SUBSET: the same names with the same
semantics, and what is not implemented is refused BY NAME. A claim needs a conformance vector
whose golden was generated from real GJS, and it has to be green on BOTH legs — the pure-JS twin
and node-gi — or the claim is not made.

## Context

ADR 0122 did this for `Gtk.StringList`, and the menu is the same defect one widget over.
`AdwMenuModel` in `packages/web/adwaita-core/src/menu.ts` is `readonly AdwMenuNode[]`, and
`GioMenu` in `gio-menu.ts` is an `Array` subclass whose own header admits what it is not. On the
GTK seam a `menu-model` is a real `Gio.Menu` — `buildGioMenu` constructs one and `fromGioMenu`
reads one back — so the same name means a real menu model on one surface and an array on three.

The array shape costs the same thing it cost the list, and `split-button.ts` is where it is
visible: `menuKey = JSON.stringify(model)` is the identity a widget uses to decide whether its
popover has to be rebuilt. Measured against the real widgets (GJS 1.88 / GTK 4.22, headless):

| what happens | `Adw.SplitButton` | `Gtk.MenuButton` |
|---|---|---|
| model A assigned | 1 × `notify::menu-model` | 1 |
| A assigned AGAIN | **0** | **1** |
| model B assigned | 1 | 1 |
| `null` | 1 | 1 |
| `null` again | **0** | **1** |
| A mutated in place (`append`) | 0 | 0 |

So libadwaita guards by POINTER and GTK does not guard at all, and neither of them has a notion of
a serialised menu. `JSON.stringify` gets both halves wrong at once: two structurally equal models
are one key where libadwaita sees two writes, and a mutation of the held model changes the
contents without changing anything the widget watches.

The second measurement is the one that decides the shape of the solution. A link's
`items-changed` **does not bubble**: appending to a section reaches the root's link read
immediately and produces zero emissions on the root. A renderer connected to the model it was
handed therefore shows a stale section for ever — a defect that was unreachable while the model
was an array, because every mutation went through a re-parse of the whole tree, and that arrives
WITH the real model.

## Decision

### 1. `Gio.MenuModel` is an abstract CLASS, so there is no interface work

This is the one place the string list is not the precedent. `Gio.ListModel` is an INTERFACE, and
the whole `Implements` / `ACCEPTED_INTERFACES` apparatus of ADR 0122 § 1 exists for it.
`Gio.MenuModel` is an abstract class:

```
new Gio.MenuModel()                           → Cannot instantiate abstract type GMenuModel
new Gio.Menu().constructor.$gtype.name        → 'GMenu'
GObject.type_parent(Gio.Menu.$gtype).name     → 'GMenuModel'
GObject.signal_lookup('items-changed', Gio.MenuModel.$gtype) !== 0  → true
```

One hop, no interface in between, and `items-changed` declared on the base. The twin is therefore
two ordinary `registerBaseClass` registrations — an abstract `GioMenuModel` (GType `GMenuModel`,
carrying the signal) and `GioMenu` (GType `GMenu`) under it — and this ADR needs no native work on
node-gi at all. ADR 0122's interface door is a dependency of nothing here.

A port that copied the string list wholesale would have declared an interface GTK does not have,
which is why the measurement is in `MENU_MODEL_TYPE_VECTORS` rather than in a comment.

### 2. The type name splits: `AdwMenuModel` is the REAL thing, `AdwMenuTree` is the snapshot

`AdwMenuModel` keeps its name and changes what it means — it is `GioMenuModel`, the model a widget
holds. The authored and read-back TREE gets the new name:

```ts
type AdwMenuModel = GioMenuModel;              // the real model
type AdwMenuTree = readonly AdwMenuNode[];     // what an author writes, what a reader gets back
```

`AdwMenuNode` is untouched, including its `items: readonly AdwMenuNode[]`, which is why every
existing vector table in `conformance/` survives this ADR with a type rename and not a rewrite.
`AdwMenuInput` is untouched: it is the authoring vocabulary of ADR 0042 § 2 and this ADR does not
narrow what an author may write, only where they may write it.

The naming is the opposite way round from the obvious one, deliberately. The portable tree is the
thing with no GIR type to point at, and `check-core-namespace-claims.mjs` holds an `Adw`-prefixed
core name to the GIR type it is the portable form of — `AdwMenuModel` over a real `GMenuModel` is
that claim being true for the first time, where `AdwMenuModel` over an array was the claim being
decorative.

### 3. The twin is GIO's surface, and `menuNodeAt` hands back a SNAPSHOT

```ts
class GioMenuModel extends GObject.Object {    // abstract, GType GMenuModel
    is_mutable(): boolean;
    get_n_items(): number;
    get_item_attribute_value(position: number, attribute: string, expectedType: VariantType | null): Variant | null;
    get_item_link(position: number, link: string): GioMenuModel | null;
    iterate_item_attributes(position: number): GioMenuAttributeIter;
    iterate_item_links(position: number): GioMenuLinkIter;
    items_changed(position: number, removed: number, added: number): void;
}

class GioMenu extends GioMenuModel {           // GType GMenu
    freeze(): void;
    append(label: string | null, detailedAction: string | null): void;
    prepend(label: string | null, detailedAction: string | null): void;
    insert(position: number, label: string | null, detailedAction: string | null): void;
    append_item(item: GioMenuItem): void;
    prepend_item(item: GioMenuItem): void;
    insert_item(position: number, item: GioMenuItem): void;
    append_section(label: string | null, section: GioMenuModel): void;
    append_submenu(label: string | null, submenu: GioMenuModel): void;
    // … the prepend_/insert_ pair of each, as in GIO
    remove(position: number): void;
    remove_all(): void;
}
```

`MENU_MUTATOR_EMISSION_VECTORS` is the measured contract: ONE emission per mutator, always. There
is no mutator that batches and none that stays silent — and `remove_all()` on an EMPTY menu
**still emits** `(0, 0, 0)`, which is the row that separates this twin from ADR 0122's. The string
list skips a no-op splice; a menu does not, so the skip is not copied.

`items_changed` is PUBLIC and does not touch the contents. A subclass reports its own splice
through it, and a triple that does not match the contents is not policed — measured, and the
mechanism § 7's `reconcile` uses.

**`Gio.MenuItem` is a snapshot, and that decides an assertion style.** Measured: after
`append_item`, a later `set_label` on the item does not reach the menu. So `menuNodeAt` hands back
a DEEP snapshot node rather than a live view, and the specs compare menu nodes by VALUE — an
identity assertion would hold the port to a sharing GIO does not do.

### 4. Reading a menu is `menuTree`, and watching one is `watchMenuModel`

Two core functions, because every surface needs both and three of them had neither:

```ts
menuTree(model: GioMenuModel | null): AdwMenuTree;
watchMenuModel(model: GioMenuModel | null, handler: () => void): () => void;
```

`menuTree` is the LIFT of `gtk-host`'s `fromGioMenu` — the same read logic, in the core, so the
host delegates to it instead of carrying a second copy. It reads through
`get_item_attribute_value` + `get_item_link` and is therefore the one function that works
unchanged over the twin and over a real GI `Gio.Menu`.

`watchMenuModel` connects `items-changed` on the root **and recursively on every link**, and
re-subscribes when a link is replaced. That is not defensive depth; it is § Context's measurement:
a link's emission does not bubble, so a watcher connected only to the root is connected to the
wrong thing. It answers the renderer-reactivity requirement for every surface at once, and the
disposer it returns is what an element calls on disconnect.

### 5. `use-markup` stays a STRING, and `icon` stays a NAME

Two attribute divergences, both kept rather than migrated, and both measured.

GIO reads `use-markup` as a BOOLEAN when it is handed one, and `buildGioMenu` has always written
the STRING `'true'`. Both reach a renderer and both are read by `fromGioMenu`, so the string
stays: migrating it would change the bytes on the GTK seam for no behavioural difference, and
`MENU_ATTRIBUTE_VARIANT_VECTORS` carries both rows so neither can drift away unnoticed.

GIO's own `icon` is `(sv)` — a serialised `GIcon`, e.g.
`('themed', <['document-save-symbolic', 'document-save']>)`. ADR 0118 § 2's variant subset is
`b i u d s` and arrays of them, with no type for that, so the portable model carries an icon NAME
as `s`, which is what the existing writer does and what the twin stores. The divergence is the
SUBSET's, declared in `MENU_MODEL_DIVERGENCE_VECTORS` rather than worked around at each reader.

`target` is the attribute whose type is not fixed: it is the TARGET's own, so `win.zoom(2)` reads
`i` and `app.view::list` reads `s`. Both reach the same renderer, which is why the display side
compares the PRINTED target.

### 6. The twin refuses a malformed detailed action on EVERY leg

`g_menu_item_set_detailed_action` on a malformed name is a `g_error()` — SIGABRT, uncatchable from
JS. `gtk-host` already guards it with `Gio.Action.parse_detailed_name`, the same parser with an
error return. The twin now refuses the same strings in the same place, so
`MENU_DETAILED_ACTION_VECTORS`' `gioValid: false` rows become the twin's refusal spec and are
driven on every leg instead of only against the host.

What this narrows: `normalizeMenuModel`'s totality now covers ATTRIBUTE typos only. A bad action
still propagates through `parseMenuModel` — JSON parsing stays total, because the markup door may
not throw — and surfaces at the mutator, which is exactly where GTK surfaces it today.

### 7. `menu-model` is an object property, an array is refused BY NAME, and the attribute door coerces

The door follows ADR 0122 § 6 and its A4 amendment without inventing a second mechanism.

A widget's `menu-model` property takes a real `GioMenuModel`, or `null`, or — on the authored path
— the JSON STRING that a `menu="…"` attribute is by the time it reaches a widget. Anything else is
refused by name, and the refusals are GJS's own words, measured:

| write | answer |
|---|---|
| `new Gio.Menu()` | accepted |
| `null` | accepted, clears the popover |
| a JSON string (the authored attribute) | parsed into a real model (`readMenuModelWrite`) |
| `['a']` | `Object 0x… is not a subclass of GObject_Object, it's a Array` |
| `{}` | `… it's a Object` |
| a `Gtk.Label` | `Object is of type GtkLabel - cannot convert to GMenuModel` |

**`null` is the ONLY spelling of "no menu", and that is a measurement, not a simplification.** An
EMPTY non-NULL `Gio.Menu` at `menu-model` builds a `GtkPopoverMenu` on both `Adw.SplitButton` and
`Gtk.MenuButton`, and so does a model whose only child is an empty section; `set_menu_model(null)`
is what returns the popover to `null`, and an empty model still DISSOCIATES a popover the
application set by hand. So the old "an empty list collapses to no menu" rule of the array era is
removed rather than carried: it was the one place the port disagreed with GTK about whether a
dropdown exists, and it only existed because an array had no way to say `null` separately from
`[]`. A model does.

**The ParamSpec is `TYPE_OBJECT` plus an explicit class check, and that is a gap this ADR names
rather than closes.** `ParamSpec.object` accepts `TYPE_OBJECT` or a subset INTERFACE, and
`GMenuModel` is a registered CLASS, so the pspec is
`ParamSpec.object('menu-model', '', '', READWRITE, TYPE_OBJECT)` and the door checks the class
itself. Widening `ParamSpec.object` to registered classes is a later ADR with its own vectors;
until then the check lives one layer above the pspec, where a reader of `checkPropertyValue` can
see it. (The NativeScript widgets never meet that gap — see the amendment below.)

**Each element holds ONE authored menu instance, and a re-parse RECONCILES into it.**
`GjsifyMenu.reconcile(tree)` emits the single minimal `items-changed(0, old, new)` that turns the
old contents into the new, and emits NOTHING when the content is equal. Editing `menu='[…]'` to
append an item must not replace the model, because `Adw.SplitButton` guards by identity and would
otherwise rebuild its popover on every attribute write. `reconcile` is on a `Gjsify*`-named
subclass, as `GjsifyOptionList` is, because a real `Gio.Menu` has no such method — ADR 0122 A4's
reasoning for the prefix applies unchanged.

**`split-button.ts`'s `menuKey` goes.** It becomes an IDENTITY comparison, which is what
`Adw.SplitButton` does. `gtk-menu-button` gets NO guard, which is what `Gtk.MenuButton` does. Two
widgets, two behaviours, both measured, neither guessed.

## Consequences

**Desktop stays GJS-identical, and the host keeps its own reader — measured, not preferred.**
`gtk-host/src/menu.ts` keeps `buildGioMenu`, which builds a real GI `Gio.Menu` and always did, and
it keeps `fromGioMenu` rather than delegating to the core's `menuTree`. The two differ in ONE
argument neither can give up: `get_item_attribute_value(position, name, expected_type)` takes a
`GLib.VariantType` in real GIO and a type STRING in the portable `GLib.Variant` subset of ADR 0118
— the recorded `variant-type-is-a-string` divergence. `menuTree` passes `'s'`; real GIO needs
`new GLib.VariantType('s')`. A reader that satisfied both would carry a branch on which runtime it
is in, inside the one function whose whole job is to be implementation-blind, so the duplication is
kept and both headers say why. `props.ts`'s `coerce` keeps converting a portable array at the
`GMenuModel` ParamSpec seam, which is ADR 0122 § 5's precedent and the reason the GTK seam needs no
new door.

**iOS stays green for free.** The twin IS the iOS leg, so everything in § 1–§ 7 lands there first
and is held by pure-JS unit specs. Nothing here is host-specific and nothing needs node-gi.

**Renderers now react where GTK reacts.** Every surface holding a `menu-model` subscribes through
`watchMenuModel` and redraws on `items-changed`, including a change inside a section, which no
surface did before because no model could tell them.

**The consumer-visible cost is paid in the implementation PR.** `AdwMenuModel` means a different
type, so every annotation of an authored tree becomes `AdwMenuTree`; every `menuModel = [...]`
PROPERTY write becomes a real model; `menuNodeAt`'s identity assertions become value comparisons.
The `menu` ATTRIBUTE path is not touched, so markup, the website data and the gallery trees keep
working letter for letter. There is no deprecation window and no array-accepting overload — ADR
0030's oracle and this repository's no-compat rule both say the wrong shape fails at the write.

## What this does NOT decide

- **`menu-model` as a declared object-kind property on route D.** ~~`realValueTypeFor` in
  `packages/nativescript-bridge/gobject/src/engine.ts` would gain `'GMenuModel'` →
  `requireGi('Gio', '2.0').MenuModel`, the shape ADR 0122 A1 built for `GListModel`.~~ DONE in the
  separate PR this asked for — see the amendment below.
- **Widening `ParamSpec.object` to registered classes.** § 7: named, not closed — and the
  amendment below measures that route D does not wait on it.
- **`Gio.MenuModel` as a general abstract-base mechanism.** This ADR registers two base classes
  through the door `registerBaseClass` already has. Nothing about abstract bases in general is
  decided here.
- **`Gio.DBusMenuModel` / the menu exporter.** `MENU_EXPORTER_MAX_SECTION_SIZE` is exported with
  its measured value and enforced by nothing; exporting a menu over D-Bus has no consumer here.
- **`get_item_attribute` (the varargs form).** Not introspectable, therefore absent — and a
  method GJS cannot call is not part of the surface a port owes.

## Implementation

1. `packages/web/adwaita-core/src/conformance/menu.ts` + `conformance/index.ts` — the eight
   measured tables (type surface, mutator emissions, attribute variants, links and non-bubbling,
   notify asymmetry, the door, the divergences, the constants), as PURE DATA so the commit
   compiles standalone.
2. This ADR.
3. `packages/web/adwaita-core/src/gio-menu.ts` — `GioMenuModel`, `GioMenu`, `GioMenuItem`, the two
   iterators, the `Gio.MENU_*` constants, `GjsifyMenu.reconcile`, `readMenuModelWrite`.
4. `packages/web/adwaita-core/src/menu.ts` — `AdwMenuModel` / `AdwMenuTree` (§ 2), the tree
   walkers retyped onto `AdwMenuTree`, the detailed-action refusal (§ 6); `menu-actions.ts`,
   `popup-menu-plan.ts`, `split-button.ts`, `menu-tree.ts`, `index.ts`. `menuTree` and
   `watchMenuModel` (§ 4) live in `gio-menu.ts`, so `menu.ts` needs only a type-only import of
   `GioMenuModel` and the cycle is erased at compile time.
5. `packages/web/adwaita-web/src` — `elements/menu-slot.ts`, then the elements holding a
   `menu-model`, `application.ts`, and their specs; the identity guard on `adw-split-button` and
   its absence on `gtk-menu-button`. The four door steps (read the write, refuse, snapshot, watch)
   are a RENDERER-LOCAL class, not a new core API: the two renderers' doors differ — the web takes
   a JSON string, NativeScript refuses one by name — so the two slots are deliberate copies rather
   than a shared abstraction over a difference.
6. `packages/nativescript-bridge/adwaita/src` — `widgets/menu-slot.ts`, the six widgets, and their
   specs. The widget-level door and notify tables run from a NEW `menu-model-door.spec.ts` under
   `test.trees.mts`, because the pure `test.mts` entry may not import a widget module.
7. `packages/framework/gtk-host/src` — `menu.ts` keeps its own `fromGioMenu`, retyped to
   `AdwMenuTree`, for the `variant-type-is-a-string` reason above; `props.ts` unchanged in
   behaviour; `menu.spec.ts` drives the refusal rows against real GIO.
8. `packages/infra/blueprint/src/{project.mjs,shared-node.d.mts}` — wording only. The
   `menuModels` field KEEPS its name: it is keyed by the GTK property name `menu-model`, not by
   the type of its value, and its value was always a tree.
9. Docs, storybook, examples, and `status/open-todos/nativescript.md`; ADR 0042 and ADR 0097
   amended with a pointer here.

## Amendment (2026-10-31) — `menu-model` IS declared on route D, and the pspec gap is not on that path

§ "What this does NOT decide" deferred the NativeScript declaration to its own PR with its own
measurement. This is that measurement. `Adw.SplitButton:menu-model` and `Gtk.MenuButton:menu-model`
are declared object-kind properties at the `withSignals` / `withProperties` seam, and
`realValueTypeFor` gained the row ADR 0122 A1's table now carries.

### A1. `GioMenuModel.$gtype` is the whole type declaration

No new token was needed. `registerBaseClass(GioMenuModel, 'GMenuModel', …)` already calls
`makeType('GMenuModel')` and installs `$gtype`, and `realValueTypeFor`'s discriminant is
`valueType.name`, so the declaration reads `valueType: GioMenuModel.$gtype` and the engine
answers `requireGi('Gio', '2.0').MenuModel`. `GioMenuModel` gained one line —
`declare static readonly $gtype: GType;`, the `Gtk.FileFilter.$gtype` precedent — so a consumer
names the type without a cast.

### A2. § 7's ParamSpec gap is never REACHED by these two properties

An object-kind declared property is `isSeamOwned` (ADR 0122 A2): its value lives in the seam's
store on both legs and never enters the GObject. On the pure leg that means the widget goes
through `installPureJsProperties` and no ParamSpec is built for the declared property at all —
`PURE_JS_ENGINE.registerForeignClass` throws on one (`gobject.ts:576`) — so the `valueType` check
at `gobject.ts:301`, the one § 7 names, is never executed. Widening the twin's `ParamSpec.object`
to registered classes therefore stays a later ADR and nothing on this path waits for it. On the
node-gi leg the pspec IS real, which is exactly what `realValueTypeFor` is for.

### A3. One slot, TWO declarations, because the two C setters differ

Measured on GJS 1.88 / GTK 4.22 (`Adw.SplitButton.find_property('menu-model')`;
`GObject.ObjectClass` is not exposed in GJS, which is why the lookup is on the class):

| | `Adw.SplitButton` | `Gtk.MenuButton` |
|---|---|---|
| pspec flags | `1073742051` — `G_PARAM_EXPLICIT_NOTIFY` | `227` — no explicit notify |
| A, then A again | 1 notify, then 0 | 1, then 1 |
| B over A · `null` · `null` again | 1 · 1 · 0 | 1 · 1 · 1 |
| `null` on a FRESH widget | 0 | 1 |
| mutating the HELD model | 0 on both — `items-changed` is not `notify::` | |
| readback | by identity on both | |

So `Adw.SplitButton` declares `explicitNotify: true` and emits `notify('menu-model')` at the END
of its `afterNotify`, after the slot adopted the model — C rebuilds the dropdown before it
notifies, and left to the seam the emission would come first and a handler would read the
PREVIOUS dropdown. It declares NO `changed` hook: C's guard is identity and the seam's default
identity check is that guard. `Gtk.MenuButton` declares `changed: () => true` (the
`AdwSplitButton:icon-name` spelling) and no `explicitNotify`, because nothing on the button
repaints from the model.

### A4. Consumer-visible: `menuModelChange` is gone, `notify::menu-model` is the door

On both widgets. The seam no longer calls `notifyPropertyChange`, so
`addEventListener('menuModelChange')` installs a listener that never fires; it is NOT refused,
because `refuseDeclaredEvent` names only the spellings GObject owns — and those
(`notify::menu-model`, `notify::menuModel`, `notify::menu_model`) ARE refused on
`addEventListener` and on `notify({ eventName })`. `Gtk.MenuButton` additionally lost its
hand-rolled `menuModel` / `menu_model` accessor pair; the seam installs all three spellings, and
both widgets keep their `get_menu_model` / `set_menu_model` verbs, which route through the
declaration and therefore notify like a write.

`refuseMenuString` runs in `normalize` AHEAD of `readMenuModelWrite`, so the XML door keeps ADR
0128's own wording instead of `readDeclaredValue`'s generic "holds an object" — safe because
`coerceDeclared` calls `normalize` INSTEAD of `readDeclaredValue`, and necessary because a
refusal may not live in a `notify::` handler, where an exception is swallowed.
