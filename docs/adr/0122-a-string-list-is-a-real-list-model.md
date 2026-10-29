# 122. A string list is a REAL list model, and `registerClass` learns `Implements`

- Status: **Accepted** (owner, 2026-10-28 — Option A, and § 6 option (a))
- Date: 2026-10-28
- Deciders: Pascal Garber
- Amends: [ADR 0046 (portable list model)](0046-portable-list-model.md) § 2 and § 3 — the
  authoring door's SHAPE, not the portable value, and not § 1's scope — and NARROWS § 5: the
  name `model` survives on every surface, what the PROPERTY accepts does not (see § 0 and § 6)
- Depends on: [ADR 0105 (real GObject backs the NativeScript subset)](0105-real-gobject-backs-the-nativescript-subset-on-android.md)
  § 2 (the engine seam, route D),
  [ADR 0096 (a GObject subset on the browser and NativeScript)](0096-a-gobject-subset-runs-on-the-browser-and-nativescript.md),
  [ADR 0098](0098-a-minimal-application-runs-on-the-browser-and-nativescript.md) § 1a (`UNLOCKED_VFUNCS`)
- Related: [ADR 0072 (value lists become a typed `extensions` field)](0072-value-lists-become-a-typed-extensions-field.md)
  § 2 (the `{ strings }` construct bag the NativeScript builder fills),
  [ADR 0030 (one corpus, GJS as oracle)](0030-one-corpus-gjs-as-oracle.md),
  [ADR 0034 (widget vocabulary convergence)](0034-widget-vocabulary-convergence.md) clause 1;
  `packages/web/adwaita-core/src/gtk-string-list.ts`, `packages/node-gi/node-gi/gi.js`,
  `packages/node-gi/node-gi/src/class.cc`

## Rule for every stage

The API is GTK's and GJS's. A stage may implement a strict SUBSET: the same names with the same
semantics, and what is not implemented is refused BY NAME. A claim needs a conformance vector
whose golden was generated from real GJS, and it has to be green on BOTH legs — the pure-JS twin
and node-gi — or the claim is not made.

## Context

`Gtk.StringList` in `adwaita-core` is an `Array` subclass. Its own file header says what it is
not: "a `GListModel` of `GtkStringObject`s, with `items-changed`, an item type and `get_item()`.
None of that is here." That was a deliberate, cheap choice, and it bought exactly what it set out
to buy — `model: list` and `model: [...]` became the same write, because `normalizeComboOptions`
gates on `Array.isArray`, which is true for a subclass, so no widget had to learn a second input
shape.

Three things have happened since.

**ADR 0105 § 2 put a REAL GObject under the NativeScript widgets** (route D), and ADR 0046's
amendment put a real `Gtk.StringList` on the GTK seam. So the same name now means a real list
model on two of the four surfaces and an array on the other two, and `adw-combo-row` is the
widget where that split stops being a detail: `model` and `selected-item` are real GObject
properties in GJS, and the migration note in `status/open-todos/nativescript.md` ("MIGRATE NEXT")
has been parked on precisely this question.

**The probe says the widget's behaviour is the MODEL's behaviour.** Measured against a real
`Adw.ComboRow` (GJS 1.88): setting a non-empty model notifies `selected`, `selected-item`, then
`model`, and the selection resets to 0; removing an ITEM shifts `selected` without the model
being replaced. That second one is `Gtk.SingleSelection` reacting to `items-changed` on the model
it holds. An array has no `items-changed`, so on an array-shaped model that behaviour cannot be
reproduced at all — not approximated, not deferred: there is no signal to listen to.

**The twin refuses `Implements` and node-gi IGNORES it.** `REFUSED_META` in
`adwaita-core/src/gobject.ts` maps `Implements → META_SYMBOLS.interfaces` and throws. node-gi's
`gi.js` does not have the key at all, so `registerClass({ Implements: [...] }, C)` registers a
GType that implements nothing and says nothing — the silent half-success this workspace refuses
everywhere else. The one `g_type_add_interface_static` in the tree is `signals.cc`'s internal
`GtkBuildable` scope, not a door anything can reach.

So the question is not "should the list model be real". It is "what does a real one cost", and
the answer has a measured floor: interface support on both legs, because a `Gio.ListModel` that
does not implement `Gio.ListModel` is not one, and `Gtk.SingleSelection`'s behaviour is the only
reason to want it.

## Decision

### 0. This AMENDS ADR 0046; it does not supersede it

Every load-bearing clause of 0046 survives verbatim. § 1's scope (the widgets GTK gives a `model`
property, and nothing else) is untouched. § 3's choice of `Gio.ListModel::items-changed` as the
positional signal is not merely kept — it is what this ADR makes literal, so superseding the ADR
that chose it would delete the reasoning for the thing being built. § 6 (selection stays in
`ComboState`; only its rule moved) is untouched, and the 2026-09-09 amendment's `gtk-host` seam
keeps building a real `Gtk.StringList` of labels exactly as it does today.

§ 5 is the one clause this ADR narrows, and only in its second half. Its DECISION — one name,
`model`, on every surface, with `options` and `items` not kept as aliases — is ADR 0034 clause 1
and survives whole. What § 6 below changes is what that one name ACCEPTS as a property write: a
`Gio.ListModel`, not an array. The name is still the GObject property's own name, which is the
reason 0046 § 5 gave for choosing it.

What changes is narrower than the ADR: the SHAPE of the authoring door § 2 introduced. 0046 § 3
already named the cost of the array shape without calling it that — "a splice is computed by
comparing the assigned model against the stored one", which is the workaround a model with its own
`items-changed` does not need.

The portable VALUE is not touched either. `AdwListModel` / `AdwListModelInput` stay a readonly
array of `{ value, label }` and `normalizeComboOptions` stays total — that is 0046's decision
about OUR vocabulary, and it is what the markup door still parses into. What § 6 takes away is one
ENTRANCE to that value: assigning the bare array to the `model` PROPERTY. The value keeps every
other door it has — the `model` attribute, `parseListModel`, the `{ strings }` construct bag,
`normalizeComboOptions` — and `new Gtk.StringList({ strings: ['a', 'b'] })` is the one line that
replaces the one write that goes.

### 1. `Implements` is accepted on both legs, for interfaces the subset has

`GObject.registerClass({ Implements: [Gio.ListModel] }, class … {})` registers a GType that
really implements the interface, on the pure-JS twin and on node-gi. It is removed from
`REFUSED_META` and added to `ACCEPTED_META`; node-gi's `registerClass` gains the key it has been
silently dropping.

The surface is GJS's, and it is these five names:

| member | where it lives |
|---|---|
| `Implements: [Iface]` at `registerClass` | class meta |
| `vfunc_get_item_type()` | prototype, overrides the iface slot |
| `vfunc_get_n_items()` | prototype |
| `vfunc_get_item(position)` | prototype |
| `items-changed (position, removed, added)` | the interface's own signal |
| `get_item_type()` / `get_n_items()` / `get_item(n)` | instance methods, routed to the vfuncs |

The instance methods are not sugar and they are not ours: GJS puts `g_list_model_get_n_items` on
every implementor, and a consumer that holds a `Gio.ListModel` calls THOSE, never the `vfunc_`
names. A class that overrides a vfunc and does not answer the matching method is the asymmetry
this would otherwise ship.

**A SUBSET, named.** `Gio.ListModel` is the only interface accepted at this stage. Anything else
in `Implements` is refused by name — the same `UnsupportedGObjectError` shape the twin already
throws for `Children`, `Requires` and `GTypeFlags`, which stay refused. An interface is not a
generic mechanism here; it is one contract with three vfuncs and one signal, and widening it needs
its own vectors.

**On node-gi this is native work, and it is the real cost of this ADR.** `RegisterClassImpl`
(`src/class.cc`) calls `g_type_register_static` and installs properties, signals and vfunc
overrides in `class_init`. Interfaces need a second step after the GType exists:
`g_type_add_interface_static(newType, ifaceType, &info)` with an `iface_init` that fills the
interface's OWN vtable (`GListModelInterface.get_item_type`/`get_n_items`/`get_item`) with
trampolines into the JS functions the existing vfunc machinery already holds. The existing
`collectVfuncs` path resolves a vfunc by walking the parent OBJECT info
(`gi_object_info_find_vfunc_using_interfaces`), which finds nothing for a class whose parent is
`GObject.Object`: the slot belongs to the interface's vtable, not to any ancestor's class struct.
So the two paths stay separate — `cd->vfuncs` for class vfuncs, a new `cd->interfaces` for
interface ones — and a `vfunc_` name that matches neither is the error it already is.

**Route D does not get this.** A foreign-parent class (`FOREIGN_PARENT_CLASSES`, the NativeScript
gate) cannot take `vfunc_*` overrides at all — `gi.js` says so where it says why, and the reason
(a vfunc trampoline would have to re-link the instance prototype, the one thing that path must
never do) is unchanged by anything here. `Implements` on a foreign-parent class is therefore
REFUSED BY NAME, not ignored. This is not a limitation of the list model: the list model is not a
widget, has no NativeScript base, and is registered through the ordinary `registerClass` path on
both legs. A widget that one day needs to implement an interface stays on the twin, which is the
rule `status/open-todos/nativescript.md` already carries under CARRY THESE.

### 2. The item is `Gtk.StringObject`, and it is OURS on every leg

A `Gtk.StringList` holds `Gtk.StringObject`s. Android ships GLib, GObject and Gio and no Gtk
(ADR 0117 decides which namespaces enter the APK), so there is no real `Gtk.StringObject` to hand
back there — and on the browser there is no GI at all. The class is therefore ours on both legs,
registered through the same door as any other: a `GObject.Object` subclass with one read-only
`string` property, GType name `GtkStringObject`, matching GJS's surface:

```ts
const o = list.get_item(0);   // a GtkStringObject
o.string;                     // 'Blue'  — the property
o.get_string();               // 'Blue'  — the method GJS also has
```

`get_item` answers the SAME object for the same position until that position changes, because
identity is what § 4's equality rule compares and what `selected-item` hands to a `notify::`
handler. GTK's own `GtkStringList` owns its items and hands back a borrowed pointer; answering a
fresh wrapper per call would make `row.selected_item === row.selected_item` false, which is not
something a GJS consumer can be asked to tolerate.

**What it does not have.** `Gtk.StringObject` in GTK is also a `GtkSectionModel` participant and
carries nothing else; there is no `value` on it, and this ADR does not invent one. ADR 0046's
amendment already measured and recorded that consequence for the GTK seam — "a `Gtk.StringObject`
holds one string, so an item's `value` does not reach GTK" — and the same sentence is now true on
all four surfaces for a `Gtk.StringList`. An author who needs `{ value, label }` writes the
portable array, which is the door 0046 § 2 built and this ADR leaves open.

### 3. `Gtk.StringList` stops being an `Array`, and gains nothing it does not have in GJS

```ts
class GtkStringList extends GObject.Object {   // Implements: [Gio.ListModel]
    constructor(props?: { strings?: readonly string[] | null });
    static new(strings: readonly string[] | null): GtkStringList;
    append(string: string): void;
    take(string: string): void;
    remove(position: number): void;
    splice(position: number, nRemovals: number, additions?: readonly string[] | null): void;
    get_string(position: number): string | null;
    find(string: string): number;              // see below
    get_item(position: number): GtkStringObject | null;
    get_n_items(): number;
    get_item_type(): GType;
}
```

Every mutator emits `items-changed` with GLib's own three numbers, ONCE per call, which is the
whole point: `g_list_store_splice` documents that it "only emits items-changed once for the
change", and `listItemsChanged` in `list.ts` already computes that minimal splice for the
comparison path. `append`/`take` emit `(n, 0, 1)`, `remove` emits `(position, 1, 0)`, `splice`
emits `(position, nRemovals, additions.length)`.

**Three things the `Array` shape gave it are GONE, and each is a real consumer-visible change.**

- **`list.length`, indexing, `map`/`filter`/`slice`, spread.** `Gtk.StringList` has no `length`
  in GJS and never did; it has `get_n_items()` and `n_items`. The `Symbol.species` override
  exists only to protect `ArraySpeciesCreate` from the `{ strings }` constructor, so it goes with
  the base class it was defending.
- **`splice` taking rest arguments.** The current class accepts BOTH C's one-array spelling and
  JS's rest spelling, deliberately, because `Array.prototype.splice` was underneath it. GTK's
  signature is `(position, n_removals, additions)` and that is the only one now. The rest
  spelling is removed rather than kept beside it: two spellings of one call is what ADR 0034
  clause 1 exists to stop, and the JS one is no longer anybody's inherited behaviour.
- **`find` changes meaning.** The current header explains at length why `find` is NOT overridden:
  `Array.prototype.find` takes a predicate, `gtk_string_list_find` takes a string and answers a
  position, and overriding it would break `list.find((s) => …)`. With `Array` gone there is no
  `Array.prototype.find` to break, so `find(string): number` is GTK's, as it should have been.

**`strings` is construct-only, as in GTK — so the XML door moved to the owner.** ADR 0072 § 2's
NativeScript builder calls `new X()` with no arguments and assigns attributes afterwards, so
`<gtk:StringList strings='["Blue","Teal"]'>` would set a construct-only property on a list that
is already built; GTK refuses that with a CRITICAL and the list stays empty. The serializer
(`sharedTreeNativeScriptXml`) therefore writes an id-less list at a `model` slot as the owner's
`model='["Blue","Teal"]'` attribute, and `Adw.ComboRow` / `Gtk.DropDown` read that JSON text in
their `model` setter, as the web elements already did. A list carrying strings anywhere else has
no XML spelling and is refused when serialized.

**No `Array` fallback anywhere, and no shim.** `normalizeComboOptions` gains a branch that reads
a `Gio.ListModel` through `get_n_items`/`get_item`, beside the `Array.isArray` branch it already
has; it stays TOTAL, because its two doors are still a property assignment and a markup
attribute. Every one of our own callers moves in the same change (§ Implementation). There is no
compatibility period: a `Gtk.StringList` that is also an array is what this ADR removes, so
leaving one would leave the thing being removed.

### 4. The seam gets an `object` kind, and it compares by IDENTITY

`ForeignPropertyKind` in `adwaita-core/src/engine.ts` is `'string' | 'boolean' | 'int' | 'uint' |
'double'`. It gains `'object'`, carrying the value's GType, so a widget can declare a real object
property at its `extends` the way it already declares a string one.

The equality rule is MEASURED, not assumed. The probe recorded in
`status/open-todos/nativescript.md` (a registered subclass, `GObject.ParamSpec.object`,
`Gio.ListStore` values) answers:

| write | `notify::` |
|---|---|
| object A | 1 |
| A again | 0 |
| object B | 1 |
| `null` | 1 |
| `null` again | 0 |
| A | 1 |

So GJS compares by identity (`===`), including for `null`, and an equal write notifies nothing.
Both legs implement exactly that: the pure-JS engine in its accessor, node-gi through
`g_param_spec_object`, which `BuildParamSpec` in `src/class.cc` ALREADY builds — `gi.js`'s
`paramSpecToNative` passes `desc.gtype` straight through. The native half of the object kind
therefore costs nothing; what is new is the seam's vocabulary and the twin's accessor.

**A non-GObject value is refused by name.** The probe measured real `Adw.ComboRow` rejecting `{}`
and `[]` with "is not a subclass of GObject_Object", and that is the refusal both legs give. This
is the one place where § 3's removal of the `Array` base has a second effect: an array written to
an object-kind `model` is now a TypeError naming the type, where before it was the value the
property wanted.

### 5. What `Adw.ComboRow` does, once its model can speak

With § 1–§ 4 in place the combo row stops deriving its behaviour and starts READING it. The
probe (real `Adw.ComboRow`, GJS 1.88) is the specification, and every row of it is reachable only
because the model emits:

| what happens | what the widget does |
|---|---|
| before any model | `selected` reads INVALID (`GTK_INVALID_LIST_POSITION`) |
| `selected = n`, no model | no-op, no notify |
| non-empty model assigned | notify `selected`, `selected-item`, `model` — in that order; selection resets to 0 |
| the SAME model assigned again | zero notifies |
| `model = null` | `notify::model` only; `selected` reads INVALID and `selected-item` `null`, neither notifying |
| empty model assigned | all three notify |
| `selected` out of range | ignored |
| an item REMOVED from the held model | `selected` shifts — no model write involved |

The last row is the one that needs this ADR, and the third is the one that needs § 4's identity
rule: "the same model again → 0 notifies" is `===` on a GObject, which is exactly what the #2424
probe measured for `ParamSpec.object`.

`selected` tracking `items-changed` is `Gtk.SingleSelection`'s behaviour, and 0046 § 6 decided
that a portable SELECTION model is not built here — so the widget subscribes to its model's
`items-changed` directly and applies the clamp `clampListSelection` already holds. That is one
subscription on one signal, not a selection model, and it keeps 0046 § 6 intact.

`use-subtitle` copies the selected item's string into `subtitle`, as measured. `expression` and
`factory` are NOT implemented and are refused by name: both take a `Gtk.Expression` /
`Gtk.ListItemFactory`, neither of which exists on Android (ADR 0117) or on the browser, and
0046 § 7 already declined item factories for `ListController`'s reasons.

### 6. `model` is a `Gio.ListModel` property, and an array is refused BY NAME

Three rules of this repository pull in different directions on one property, and the owner
decided it on 2026-10-28 in favour of GJS:

- GJS says `Adw.ComboRow:model` is a `Gio.ListModel` property. `row.model = ['a', 'b']` throws.
- ADR 0046 § 5 named the property `model` and gave it `AdwListModelInput` — a plain array.
- § 4 above says an object-kind property refuses a non-GObject by name, with no silent coercion.

An array written to a declared object-kind `model` cannot satisfy all three, so **the GJS
semantics win**: `model` is a declared object-kind property whose value GType is `Gio.ListModel`,
and a plain array written to it is a `TypeError` naming the type it got — the same refusal every
other object-kind property gives, with no array branch anywhere in the setter. The widgets this
reaches are 0046 § 1's scope: `Adw.ComboRow` and `Gtk.DropDown`.

**The markup door is NOT a property write and does not change.** A `model` ATTRIBUTE is JSON
text; the element parses it with `parseListModel` and builds the `Gtk.StringList` itself. 0046
already separates the parser from the setter, and this is the separation paying for itself:
`<adw-combo-row model='["a","b"]'>` keeps working letter for letter, as does the `{ strings }`
construct bag (ADR 0072 § 2) and the NativeScript builder's attribute path.

What a PROPERTY write looks like after this, on every surface:

```ts
// before
row.model = ['a', 'b'];
// after
row.model = new Gtk.StringList({ strings: ['a', 'b'] });
```

**This is the consumer-visible cost, and it is paid in the implementation PR, not deferred.**
Every `model: [...]` property write in the tree changes: the storybook stories, the three gallery
showcases, `@gjsify/adwaita-react-native`'s `AdwComboRowProps`, the NativeScript builder's
property path, and the published type on the `model` slot, which goes from `AdwListModelInput` to
`Gio.ListModel`. There is no deprecation window and no array fallback — ADR 0030's oracle and
this repository's no-compat rule both say the wrong shape should fail at the write, not be
coerced at it.

**`selected-item` goes with it.** It is a declared object-kind read-only property handing back the
`Gtk.StringObject` at `selected`, or `null`, exactly as the probe measured — identity-equal to
what `model.get_item(selected)` returns, which is § 2's stable-identity rule being load-bearing
rather than decorative.

## Consequences

**`adwaita-web` stays working and stays GJS-shaped.** It is the consumer 0046 § 2 shares the
authoring door with, and nothing it does today goes through `Array`-ness: `string-list-slot.ts`
reads the `strings` ATTRIBUTE off a consumed `<gtk-string-list>` child and hands JSON to
`parseListModel`, which never sees a `GtkStringList` instance. `namespace/gtk.ts` re-exports the
class under GIR's name, so a browser author writing
`new Gtk.StringList({ strings: [...] })` keeps writing it — and now gets a list that answers
`get_item`, `get_n_items` and `items-changed`, which is strictly more GJS than before.
`value-lists.spec.ts` is the suite that holds the construct bag, and it moves with § 3's API.

**iOS stays green, and this is what makes that cheap.** The pure-JS twin is the iOS leg
(ADR 0105 § 2), so interface support, the item class and the real `Gtk.StringList` all land there
FIRST and are held by a pure-JS unit spec before node-gi is touched. Nothing in § 1–§ 4 is
host-specific; the one thing that is — route D's refusal of `Implements` — is a refusal, not a
capability.

**node-gi grows its first real interface door.** `g_type_add_interface_static` with a JS-backed
`iface_init` is new native surface, and `docs/node-gi-gjs-surface.md` records it beside the
FOREIGN parent class section, including what is refused (every interface but `Gio.ListModel`,
and `Implements` on a foreign-parent class).

**One signal replaces one comparison, and the comparison stays for the door that still has no
signal.** 0046 § 3's compare-and-splice (`listItemsChanged`) is NOT removed: the markup door
re-parses a `model` ATTRIBUTE into a plain `AdwListModel` with no identity and no
`items-changed`, so reconciling that against the held list is still a comparison, and
`LIST_MODEL_OWNERSHIP_VECTORS` still holds both doors. What goes is the comparison on the
PROPERTY path — a widget handed a real `Gtk.StringList` subscribes instead.

**The `gtk-host` seam is untouched.** It builds a real `Gtk.StringList` from GI and splices it
through `reconcileStringList` (0046's 2026-09-09 amendment). It never imports the twin's class,
so § 3 cannot reach it.

## What this does NOT decide

- **A portable selection model.** 0046 § 6 and its amendment both declined `Gtk.SelectionModel`;
  this ADR declines it again. `Gtk.SingleSelection`'s one behaviour the combo row needs is a
  subscription, not a layering.
- **`Gtk.ListView`, `Gtk.GridView`, `Gtk.ColumnView`.** No widget on any renderer here; 0046 § 1
  keeps them out and nothing in a real list model changes that.
- **Interfaces in general.** § 1 accepts `Gio.ListModel` and refuses everything else by name.
- **`Gio.ListStore` as a general store.** The twin's `GioListStore` (`file-chooser.ts`) is a
  `Gtk.FileFilter`-only store that refuses nine members by name. Whether it becomes a real
  `Gio.ListModel` on top of § 1 is a separate question with its own consumer.
- **`expression` / `factory`.** § 5: refused by name.

## Implementation

1. `packages/web/adwaita-core/src/gobject.ts` — `Implements` moves from `REFUSED_META` to
   `ACCEPTED_META`, restricted to `Gio.ListModel`; the three `vfunc_` names join
   `UNLOCKED_VFUNCS` (ADR 0098 § 1a); `get_item_type`/`get_n_items`/`get_item` are installed on
   the prototype, routed to the vfuncs; `items-changed` is registered with its three `uint`
   parameters.
2. `packages/web/adwaita-core/src/engine.ts` — `ForeignPropertyKind` gains `'object'`;
   `ForeignProperty` carries the value GType; identity equality in the pure-JS accessor.
3. `packages/web/adwaita-core/src/gtk-string-list.ts` — `GtkStringObject` and the rewritten
   `GtkStringList` (§ 2, § 3); `gtk-string-list.spec.ts` rewritten against the new surface.
4. `packages/web/adwaita-core/src/list.ts` — `normalizeComboOptions` reads a `Gio.ListModel`
   beside an array, still total.
5. `packages/node-gi/node-gi/src/class.cc` — `cd->interfaces`, `g_type_add_interface_static`
   after `g_type_register_static`, an `iface_init` filling `GListModelInterface` with JS
   trampolines; `gi.js` — `Implements` accepted in the meta reader, refused on the foreign-parent
   path, `'object'` already carried by `paramSpecToNative`.
6. Conformance: new vectors in `packages/web/adwaita-core/src/conformance/list.ts` with goldens
   GENERATED from gjs, driven on both legs; A/B evidence that they fail without the change.
7. Consumers, in the same PR as (1)–(6): `packages/web/adwaita-web/src/value-lists.spec.ts`,
   `packages/nativescript-bridge/adwaita/src/{builder/index.ts,widgets/construct-props.ts}`,
   `packages/framework/storybook`, the storybook stories and the three gallery showcases that
   construct a `Gtk.StringList`, and the docs that print its API.
8. § 6's property narrowing, in the same PR as the widget (stage 3): every `model: [...]`
   PROPERTY write becomes `new Gtk.StringList({ strings: [...] })` — storybook stories, the three
   gallery showcases, `@gjsify/adwaita-react-native`'s `AdwComboRowProps`, the NativeScript
   builder's property path — and the published type on the `model` slot goes from
   `AdwListModelInput` to `Gio.ListModel`. The `model` ATTRIBUTE path is not touched.
9. `docs/node-gi-gjs-surface.md` and `status/open-todos/nativescript.md` — the new surface, the
   refusals, and the MIGRATE NEXT entry for `adw-combo-row`.

## Amendment (2026-10-29) — `ParamSpec.object` on the NativeScript engine is REAL, and the value is held BESIDE the twin

§ 4 gave the seam an `object` kind and said the native half "costs nothing", because
`g_param_spec_object` already exists and `gi.js` passes `desc.gtype` through. Stage 3 built it
and found that sentence true for the PSPEC and false for the VALUE. Both halves are measured
here; § 4's table of identity rules is unchanged.

### A1. The value type is resolved to a REAL GType, and an unmappable one throws

`paramSpecFor` in `packages/nativescript-bridge/gobject/src/engine.ts` threw on the object kind.
It now maps the subset's value type to a real GType and builds a real `g_param_spec_object`:

| subset value type | real GType |
|---|---|
| `TYPE_OBJECT` (`{ name: 'GObject' }`) | node-gi `GObject.Object` |
| the `ListModel` interface token (`gtype.name === 'GListModel'`) | `requireGi('Gio', '2.0').ListModel` |
| anything else | `TypeError` naming the type |

The `Gio` import is lazy — taken only when a `GListModel`-typed property is actually declared —
the same shape `list-store.ts` already uses in this package.

Measured, on this tree's addon (GLib 2.86): `GObject.ParamSpec.object` accepts both
`GObject.Object` and `Gio.ListModel`; a real `Gio.ListStore` round-trips by identity through such
a property; `null` is accepted. Measured in real GJS (1.88): `g_param_spec_object` accepts an
INTERFACE GType (`Gio.ListModel.$gtype` → `value_type=GListModel`), and a non-object GType
(`GObject.TYPE_INT`) fails `g_type_is_a (object_type, G_TYPE_OBJECT)` and returns null — so the
refusal above is not a policy, it is the floor the C function already has.

### A2. The VALUE never enters the twin

The engine's other kinds write `twin[spec.name] = value` and let the real store notify itself.
An object-kind value cannot take that path, and the reason is measured, not stylistic:

- node-gi refuses a pure-JS object in a `GValue`: `expected a node-gi GObject handle`.
- Every core type of the subset is pinned to `PURE_JS_ENGINE` by `registerBaseClass`, so a
  `Gtk.StringList` reaching this property is a pure-JS object BY CONSTRUCTION. There is no
  configuration under which it is a real GObject.

So `getValue`/`setValue` for the object kind read and write an engine-side per-instance map and
emit through `twin.notify(name)` inside `withEmission`. The twin's own slot for that property
stays `null` forever, and that is deliberate: the real pspec's only remaining jobs are making
`notify::<name>` a valid DETAILED signal on the twin's GType and answering `bind_property`.

**`bind()` for an object-kind property therefore routes through the core's portable
`bindProperties`**, not through `g_object_bind_property` — a real `GBinding` would faithfully
copy the twin's always-null value. This is the escape the engine already documents and takes when
either side has no twin; the object kind is a third reason to take it, not a new mechanism.

### A3. Rejected, and why

- **A real GObject stand-in per subset object.** Would force the pspec's value type back to
  `GObject` (the stand-in is not a `GListModel`), make `g_object_get` answer an object that means
  nothing to any caller, and add a second identity to keep in step with § 4's `===` rule.
- **A `jsobject` or `pointer` pspec.** node-gi exposes neither. Its `ParamSpec` keys are
  `string, boolean, char, uchar, int, uint, int64, uint64, double, float, object, boxed`, and
  `GObject.TYPE_JSOBJECT` is `undefined`. Claiming one would be the silent half-success this ADR
  opened by refusing.

### A4. The descriptor door gets its OWN list model, and it is not called `Adw*`

§ 6 narrows `Adw.ComboRow:model` and `Gtk.DropDown:model` to a real `Gio.ListModel`. It does not
touch the `model` ATTRIBUTE — the JSON markup door — and that door carries `{ value, label }`
descriptors pinned by `conformance/list.ts`, `gtk-drop-down.spec.ts` and the generated website
data. Something has to turn the attribute into a model, and `Gtk.StringList` cannot: it holds
`Gtk.StringObject`s, which hold a string and nothing else, so `{ value: 'de', label: 'Deutschland' }`
round-trips as `'Deutschland'` and the item loses the half it is addressed by.

So the core gets `GjsifyOptionList`, a `Gio.ListModel` of `GjsifyOptionObject`s — exactly what a
GTK author builds out of `Gio.ListStore` plus a `GObject` subclass of their own, written once in
the core instead of four times across the surfaces. Both are pure-JS (`registerBaseClass` pins
them to `PURE_JS_ENGINE`), which is also what lets an item satisfy `checkPropertyValue` for
`selected-item`.

**The prefix is `Gjsify`, not `Adw` or `Gtk`, because neither library has this type.** The other
borrowed core names (`AdwListModel`, `AdwMenuItem`, `AdwAdjustment`) carry a prefix over a shape
GIR really declares, and `check-core-namespace-claims.mjs` holds each of them to the GIR type it
is the portable form of. There is no GIR type here to point at, so an `Adw` prefix would be a
claim that fails lookup. `GjsifyCanvas2DBridge` and `GjsifyStandInFileFilter` are the precedent.

`reconcile()` is the markup door's update path and keeps the list's IDENTITY: re-parsing an
attribute emits the one minimal `items-changed` that turns the old contents into the new, where a
`model` PROPERTY write replaces the identity and re-runs autoselect per § 4. Editing
`model='[…]'` to append an option must not reset the selection to 0, and these are the two
different operations that distinction needs.
