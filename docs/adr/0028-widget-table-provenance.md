# 28. GIR-generated widget table, runtime ParamSpec for values

- Status: **Accepted** — amended 2026-08-28, see § Amendment
- Date: 2026-08-22
- Deciders: Pascal Garber
- Related: [ADR 0027 (GTK host layer)](0027-gtk-host-layer.md), [ADR 0019 (ts-for-gir as a library)](0019-ts-for-gir-as-library.md), [ADR 0023 (which GTK a node-gi process uses)](0023-gtk-source-precedence.md)

## Context

The host in ADR 0027 needs to know, per widget: its GType, which properties exist
and which of them are construct-only, which signals it emits, and how it adopts
children. There are two sources for that knowledge and they answer different
questions.

**The GIR** is complete, offline, and versioned with `@girs/*`. It describes the
GTK the package was built against.

**Runtime introspection** (`Klass.list_properties()`, `GObject.signal_lookup`,
`GObject.type_name`) is exact about the GTK that is actually installed, needs no
build step, and covers consumer subclasses registered with
`GObject.registerClass` — which no generator can see.

Choosing one and calling the other a fallback is the decision; leaving both as
"sources" is how a package ends up with two truths that disagree in the field.

## Decision

**The generated table is the shipped truth; runtime introspection is the value
coercer and the verifier.**

1. The widget table is generated from the **GIR XML, read directly**, and it
   travels with the package. What it SHIPS is the tag, the GType and the map
   between them. Property names, the construct-only set and signal names are
   consumed INSIDE the generator, to emit the type surfaces of § 6 — they are not
   shipped as table data, because `props.ts` and `host.ts` already resolve every
   property through `paramSpecs()` on the installed class, so a shipped copy would
   have no consumer and would be exactly the second truth this ADR exists to
   prevent.

   Not `ts-for-gir` in the `build:gir-types` subprocess form, as an earlier draft
   of this decision said: that form emits `.d.ts`, which answers a different
   question. The input is a discoverable GIR directory. Measured on the
   maintainer workstation, `/usr/share/gir-1.0` carries neither `Gtk-4.0.gir` nor
   `Adw-1.gir` without `gtk4-devel`, and the `@girs/*` npm packages ship no `.gir`
   at all — but `gjsify/ts-for-gir/girs/` in the surrounding workspace is
   git-tracked and version-pinned, and the installed `org.gnome.Sdk` flatpak
   runtimes carry one per SDK version. The generator therefore searches, names
   what it found in the artifact's provenance line, and fails loudly rather than
   guessing.
2. What the GIR cannot express stays **curated**: which method adopts a child,
   whether the container reorders in place, where text goes, irregular event
   names. The generator may only ever ADD to a descriptor, never contradict a
   curated field.
3. `@girs/*` remains the compile-time type source. `Gtk.<W>.ConstructorProps`
   already exists and is used in-repo; JSX intrinsic-element typing builds on it
   rather than generating property types a second time.
4. **Values** are coerced through the `GParamSpec` read from the installed class
   at runtime. The table says a property exists; the ParamSpec says what a value
   must look like. This is not a second source — it is the only source for the
   question it answers, and it is why a string enum nick can be rejected by name
   instead of silently dropped.

   What a ParamSpec CANNOT do is enumerate the legal nicks, and the type surfaces
   need exactly that. Measured under gjs 1.88.1: `GEnumClass.values` is not
   introspectable from GJS (`ec.values` is `undefined`) and
   `GObject.enum_to_string` returns the C identifier, not the nick. The GIR — and
   the typelib, via `ValueInfo.get_name()` — is the only source of the nick list.
   That does not contradict this item, it delimits it: the ParamSpec validates a
   value, the GIR enumerates the vocabulary.
5. The table is checked against the installed typelib on demand
   (`descriptorProblems()`), and it checks the CLAIMS, not only the names: a text
   sink must be writable and a string (a non-string one accepts the write and
   drops it, at exit 0), a `single` policy's derived getter must exist,
   `reorder: 'native'` must have an `after` method to back it, and a `keyed`
   policy's arity must match the method it names. Mere existence let four broken
   shapes pass.

6. **The generated surfaces are a published artifact, not an internal file.** One
   table emits `JSX.IntrinsicElements` for TSX/JSX authoring, a Vue
   `GlobalComponents` interface (what `vue-tsc`/Volar reads to type-check a `.vue`
   template), and a **data-only vocabulary export** that lets any dialect be
   checked against the same names. This is the alignment mechanism ADR 0027 § 9
   names.

   The third surface was going to be "a tag/property validator usable against
   Blueprint and its GtkBuilder XML". **Measurement struck it.**
   `blueprint-compiler` 0.20.4 already validates against the installed typelib,
   with did-you-mean suggestions, on exactly the three cases such a validator
   would have caught — a misspelled property (`spacinng` → "Class Gtk.Box does not
   have a property called spacinng. Did you mean `spacing`?"), an unknown widget
   type (`Gtk.Labell` → "Did you mean `Label`?"), and an invalid enum member
   (`orientation: sideways` → "sideways is not a member of Gtk.Orientation").
   Building a second one would duplicate a better tool and give this repo a
   validator with no measured value. What replaces it is the vocabulary export
   plus a cross-dialect NAME-AGREEMENT check against `adwaita-web`'s custom
   elements — an independent source, which is the part that can actually go red.

   Two things the measurement did justify, neither of them a validator, both
   tracked in `status/open-todos.md`: `blueprint-compiler lint` is advisory today
   and `vite-plugin-blueprint` runs only `compile`, so making lint fatal is a
   contained change with its own triage; and `AdwWindow` dispatches `<child>` on
   the child's GType while ignoring `type=`, which no field in `ChildPolicy`
   models, so any future placement validator needs a new curated field first.

   It is consumable from outside this repository **on purpose**, and the target is
   a GJS-convention consumer. Peachy authors GTK UIs in TSX on GJS and generates
   its own types; one GIR-derived surface is worth more to the ecosystem than two
   private copies, and it costs nothing to share — the generator's input is the
   GIR and the installed typelib, not anything gjsify-specific.

   **gtkx is explicitly not a design constraint.** It binds GObject through napi
   rather than GJS (`docs/references.md` records it that way), so the property and
   signal spellings, the class-registration story and above all the TYPE layer are
   its own — and this surface is shaped by `@girs/*`, which is the GJS type layer.
   Serving gtkx would mean parameterising the emitted type imports for a consumer
   whose conventions we do not control. If that ever falls out for free, take it;
   it does not get a line of machinery of its own. gtkx stays what
   `docs/references.md` already calls it: reference-only, worth reading.

7. **The tag spellings are measured, not chosen.** JSX intrinsic elements are
   kebab (`gtk-box`): a capitalized `JSX.IntrinsicElements` key is never
   consulted, because `<GtkBox/>` is `TS2304: Cannot find name 'GtkBox'`. The Vue
   `GlobalComponents` key is the **GType name** (`GtkBox`), because Volar resolves
   a kebab tag to EITHER spelling but a Pascal tag only to a Pascal key — so one
   key covers `<gtk-box>` and `<GtkBox>` with full prop and event checking, and
   that one key is the GType, which is also the table key and the GtkBuilder XML
   key. The registry accepts both spellings and the tag↔GType map is injective
   over all 164 concrete widget classes.

   The Vue surface is only worth shipping with its gate, and the gate has two
   measured silent-green modes: without `vueCompilerOptions.strictTemplates: true`
   an unknown tag and an unknown prop are both accepted, and with `vue` merely
   absent `vue-tsc` exits 0 on a deliberately red fixture with no output at all.
   Both need an explicit discriminator, or the gate is the checked-nothing class.

   Measured on `vue-tsc@3.3.11` + the repo's `typescript@6.0.3`, `strictTemplates`
   buys **exactly the excess-property check**: with it, an unknown prop is TS2353,
   an unknown event TS2353, an unresolved tag TS2339; without it those three are
   silently green while a wrong VALUE type still errors as TS2322. So a project
   missing the flag watches type errors appear, concludes the surface works, and
   has no checking at all on the half that actually drifts. (`vue-tsc` does crash
   on `typescript@7`, whose `exports` map has no `./lib/tsc` — with exit 1 rather
   than the exit 2 of type errors, so a gate must test for exit **0**, never for
   the absence of error lines. On 6.0.3, which ships no `exports` map at all, it
   runs.)

   **Volar's camelize has no acronym knowledge, and one widget pays for it.** A
   template tag is `-x` → `X` camelized and capitalized before lookup, so
   `gtk-gl-area` becomes `GtkGlArea` and misses `GtkGLArea` (TS2339). Of the 164
   concrete widgets exactly one has two adjacent capitals, and the generator finds
   that class BY RULE — any such GType also gets a kebab key, which a kebab tag
   does resolve against — instead of leaving it to a bug report.

8. **The JSX surface ships its OWN jsx-runtime; augmenting `solid-js` is refused.**
   The one-line alternative is `declare module 'solid-js' { namespace JSX { … } }`,
   and measured it leaves every tag Solid pre-declares valid on a GTK renderer:
   113 HTML + 4 deprecated + 59 SVG + 32 MathML = 208 elements that type-check
   clean and then render NOTHING. Closing them needs 208 `never` overrides and
   still reports `Type '{}' is not assignable to type 'never'` rather than "no such
   element". With our own runtime, `<div/>` is TS2339 and says so.

   Three further shapes are forced rather than chosen, each measured:

   - **Handler parameters carry the exact GIR signature.** `(...args: unknown[]) =>
     void` fails both ways under `strictFunctionTypes`: an annotated
     `(row: AdwActionRow) => void` will not assign to it (TS2322, contravariance),
     and an inline arrow's parameter arrives as `unknown` so using it is TS2345.
     `any[]` accepts everything and checks nothing. The parameters are also the
     signal's own, WITHOUT the emitting object, because the host strips it
     (`next(...args.slice(1))`).
   - **`ref` and `children` must be real members of each element's props.**
     TypeScript unions `JSX.IntrinsicAttributes` into the attributes of a COMPONENT
     and not of an intrinsic element, so an undeclared `ref` is TS2322 and an
     undeclared `children` makes every nested element TS2559; `children` must also
     be optional, or a self-closing tag is TS2741. Carrying the widget's instance
     type per tag makes `ref={(el) => …}` infer `el` as `Gtk.Box`.
   - **`noImplicitAny` is load-bearing.** With `jsx: "preserve"`, no
     `jsxImportSource` and `noImplicitAny` off, every JSX element is implicitly
     `any` and `tsc` exits 0 having checked nothing — the one configuration in
     which the whole surface evaporates in silence.

   And one hole that stays open, documented rather than papered over: TypeScript
   exempts every HYPHENATED JSX attribute from excess-property checking, so
   `<gtk-box no-such={1}/>` is accepted — on intrinsics and on components alike.
   Three index-signature shapes were tried; all three either changed nothing or
   collided with the declared kebab keys (TS2411). Both spellings are therefore
   generated (a declared `can-focus` at least gets its VALUE checked) and camelCase
   is the spelling to prefer.

9. **Interface properties are not optional, and GIR hides them.** `GtkBox` declares
   four properties of its own and `orientation` is not among them: it lives on
   `Gtk.Orientable`, an `<implements>` of GtkBox, because GObject installs interface
   properties on the implementor at runtime while GIR keeps them once, on the
   interface. A class-only reader therefore emits a surface in which
   `<gtk-box orientation="vertical">` — the most-written GtkBox attribute there is —
   is a type error. The reader walks parents AND interfaces.

10. **A table row is a claim that the widget can be BUILT, and one row was not.**
    `AdwLayoutSlot` requires a construct-only `id`; without one, `constructed`
    reaches `g_error()`, which is fatal by contract — SIGABRT, exit 134, a core
    dump, and nothing to catch. GIR cannot tell that apart from any other
    construct-only nullable property, and `descriptorProblems()` reads policy
    without ever instantiating, so the row was green in a 1746-test suite that
    constructed **none** of the 164. Bare-constructing all of them measures 163
    clean and no throws at all, so the requirement is CURATED as one entry
    (`REQUIRED_CONSTRUCT_PROPS`), refused in `materialize` by name, and the
    construct-every-row test is what keeps the entry count honest.

11. **A signal parameter has a DIRECTION, and three of them carry nothing.**
    GIR marks `Gtk.SpinButton::input`, `Adw.SpinRow::input` and
    `Gtk.Editable::insert-text` with a non-`in` parameter at
    `caller-allocates="0"`. GJS still passes an argument there and it holds
    uninitialised memory — measured, `new_value` arrives as `6.95e-310` and
    `position` as `1711500784`, both perfectly ordinary numbers. Typing them from
    the GIR type invites a reading that is garbage, and nothing warns. They are
    emitted as `OutParam` instead: declared, so the following parameters do not
    shift, and unreadable, so annotating `number` is an error at that position.
    `caller-allocates="1"` is the opposite case and keeps its type —
    `Gtk.Overlay::get-child-position` is handed a live `Gdk.Rectangle` to FILL.

## Amendment, 2026-08-28 — the table is two rules, not one

§ 1 said the generated table is "every concrete descendant of `GtkWidget`", and that
description was one class short of the set a renderer must be able to name.

**The measurement.** A `Gtk.ListView` takes no children — measured against its prototype
on gjs 1.88.1 / GTK 4.22.4, it installs no `append`, no `add`, no `insert`, no `prepend`,
no `remove` and no `set_child`. What GTK4 gives a renderer instead is a factory that hands
back a *carrier*, and the carrier's `child` is where a row's subtree goes. Those carriers
are not widgets: `GObject.type_is_a(Gtk.ListItem, Gtk.Widget)` is **FALSE**. So the
generated table did not carry them, and `generated.spec.ts`'s invariant — every curated
gtype is one the generator also found — made curating them impossible without changing
this ADR. That invariant is right and stays; the *criterion under it* was too narrow.

**The decision.** The generated table is the union of two rules over the same GIR:

1. `concreteWidgets` — every concrete descendant of `GtkWidget`. Unchanged.
2. `placementCarriers` — every concrete class NOT on `GtkWidget`'s chain that declares
   both halves of a one-child slot (`set_child` and `get_child`, on itself or an
   ancestor).

**It is a rule and not a list, and that is the load-bearing part.** A hand-written list of
carrier gtypes would be exactly the curated data § 2 reserves for what the GIR cannot
express. The rule was written after a hand-written list of three (`GtkListItem`,
`GtkListHeader`, `GtkColumnViewCell`), and selecting by rule instead returned **four**:
`AdwToggle` has the identical shape, was not on the list, and would have been an arbitrary
gap. That fourth member is the argument for the rule, not a bonus.

**What the rule actually keys on, stated because "both halves of a one-child slot" hides
it.** `set_child` does all the discriminating: measured over Gtk-4.0 + Adw-1, **zero**
classes declare `set_child` without `get_child`, so requiring the getter excludes nothing
here. It is required anyway because `appOccupant`/`slotOccupant` need it — but the honest
description is "a settable slot named `child`", and the discriminator is GTK's own naming
convention, not a shape the GIR describes.

**The blind spot that follows, and it is real.** Six concrete non-widgets in Gtk + Adw hold
a `Gtk.Widget` through a settable slot with a matching getter under a DIFFERENT name —
`AdwToast.set_custom_title`, `AdwSidebarItem.set_suffix`, `GtkTreeViewColumn.set_widget`,
`GtkCenterLayout.set_{start,center,end}_widget` — and this rule misses every one. Widening
to "any settable widget-typed slot" is not the fix: it would wrongly select
`GtkWidgetPaintable.set_widget` and `AdwSpinnerPaintable.set_widget`, which OBSERVE a
widget rather than place one, and the GIR cannot tell those apart. So a future carrier
spelled `set_content` is selected by nothing and noticed by nothing. Curating one is the
escape hatch, and doing so needs this section amended rather than a quiet exception.

**What does not change.** A generated row still carries no policy — `children:
{ kind: 'uncurated' }` — so which method adopts the child stays curated, exactly as for
widgets, and the generator still may only ADD a gtype (§ 1). The two rules cannot collide:
the carrier rule excludes anything on `GtkWidget`'s chain, so `assertInjective` over the
merged gtypes holds without a de-duplication step. Table size moves 164 → 168.

**A consequence worth stating because it is easy to reach for.** `Gtk.ListView` itself
stays `uncurated`, and its refusal to take a child is the correct behaviour rather than a
gap to fill. Nothing in this amendment makes a list an element whose children are its rows;
what it makes possible is placing a row's subtree through the host rather than through a
`set_child` call inside one framework's list controller.

## Consequences

- The normal disagreement between table and runtime is **version skew** — a user's
  GTK newer or older than the pinned `@girs` — not a bug. It is reported with the
  widget and property named, the same class of question ADR 0023 had to answer for
  node-gi.
- ADR 0019 (`ts-for-gir` as a library) is **not** on the critical path: the
  subprocess form is enough, and six precedents for it exist in the repo.
- A consumer's own `GObject.registerClass` subclass is not in the table. As a
  MOUNT CONTAINER it resolves through `nearestRegistered()`, which walks the real
  type hierarchy, so it inherits its ancestor's placement rules rather than
  failing. As a TAG it does not: `createElement` looks the GType name up exactly
  and raises `unknown-tag` until the subclass is registered with `registerWidget()`.
- Hand-maintaining the table is ruled out explicitly. It is what stalled
  `react-gtk`, `react-native-gtk4` and `svelte-gjs`; the curated surface is kept
  deliberately small so it cannot grow back into one.

## Implementation

The curated table under `packages/framework/gtk-host/src/descriptors/` stays, and
the generator may only ever ADD to it. Its four gates are: every curated gtype is
present in the GIR; curated may add, never contradict; every method a policy names
exists on that GType (with the ancestor walk — `set_child` is inherited, and an
own-methods-only check reports two false failures); and no vacuous descriptor,
with the emitted count floored so a parse that silently yields three entries
fails.

**The artifact is committed, and deliberately gets no regenerate-and-compare
gate.** Committing is what makes `check`, `lint`, `format`, the build cache, the
tarball and a fresh clone with no GIR all work unchanged, and it makes a widget
table reviewable in a diff. A byte gate would instead fail for nothing the day a
second CI leg runs a different GTK: four GTK versions sit on the maintainer
workstation alone (4.16.13, 4.20.4, 4.22.4, 4.23.0) and the pinned `@girs` is a
fifth answer. A `--check` mode was written and then removed for a second reason:
the `generate` script pipes the output through `gjsify format`, which reflows it
(+4 KB on `props.ts`), so the comparison reports a difference on every run.
`git diff` after a regeneration answers the same question with no machinery.

The machine-INDEPENDENT check is the runtime one, and it is now a suite rather
than a single function: `descriptorProblems()` for every method and text sink a
policy names, and `generated.spec.ts` for the generated surface — every offered
property present as a writable ParamSpec, every offered signal resolvable by
`GObject.signal_lookup`, every emitted enum nick resolvable through the host's own
`coerce()` path, and every tag's class carrying the GType the table claims. Over
164 widgets against gtk 4.22.4 and libadwaita, the two property directions agree
exactly.

**Version skew is handled by a rule, not an allowlist.** The generator emits each
member's GIR `version` attribute into the test data, and a member the installed
library lacks is accepted only if that version is newer than the one running —
anything else is a defect. That rule earned its place immediately:
`GtkApplicationWindow::save-state` arrived in GTK 4.24 and the workstation runs
4.22.4, which is one name, and the alternative was to stop checking signals or to
hard-code an exception.

**What is emitted.** `generated/widgets.ts` — the shipped runtime table (164 tags,
GType and ctor, no placement rule). `generated/props.ts` — the type surface: one
interface per GIR declaration, mirroring GIR's own inheritance, because the 164
widgets have 6768 writable property slots between them and only 561 distinct
property names. `generated/surface-data.mts` — test-only, a `.mts` file so it is
outside the library build glob and never ships. A widget the curated table does not
cover gets `children: { kind: 'uncurated' }`: it can be created, given properties
and given handlers, while inserting a child raises an error naming the tag that
needs a policy — because `add`, `append` and `set_child` all exist somewhere in
GTK and calling the wrong one is a warning at exit 0.
