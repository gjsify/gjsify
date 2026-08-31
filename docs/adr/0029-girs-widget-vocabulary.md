# 29. The widget vocabulary moves to `@girs/*`, dialects stay with consumers

- Status: **Accepted**
- Date: 2026-08-25, accepted 2026-08-26 with the three corrections in § Implementation
- Deciders: Pascal Garber
- Related: [ADR 0027 (GTK host layer)](0027-gtk-host-layer.md), [ADR 0028 (widget table provenance)](0028-widget-table-provenance.md), [ADR 0019 (ts-for-gir as a library)](0019-ts-for-gir-as-library.md), [ADR 0026 (HTML parsing and selector engine)](0026-html-parsing-and-selector-engine.md)

## Context

ADR 0028 § 6 said the generated type surfaces are "a published artifact, not an
internal file" and left where they publish from open. They are currently emitted
by `packages/framework/gtk-host/src/generator/` into `src/generated/`, and they
describe nothing about gjsify: the input is the GIR and the installed typelib.

### The seam, measured

Code lines only — comments and blanks excluded, because these modules are 30 %
comment and counting them measures prose, not coupling.

| module | code | GIR-generic | dialect convention | gtk-host model | can it move? |
|---|---:|---:|---:|---:|---|
| `gir.mts` | 249 | 249 | 0 | 0 | verbatim |
| `tsmap.mts` | 100 | 98 | 2 | 0 | verbatim |
| `surface.mts` | 196 | 195 | 1 | 0 | verbatim |
| `emit-types.mts` | 156 | 124 | 32 | 0 | split |
| `emit.mts` | 103 | 13 | 0 | 90 | stays |
| `main.mts` | 128 | 105 | 9 | 14 | split |
| `mini.fixture.mts` | 59 | 59 | 0 | 0 | verbatim |
| **total** | **991** | **843** | **44** | **104** | |

The import graph decides it more sharply than the count does. `gir.mts`,
`tsmap.mts`, `surface.mts` and the fixture import **nothing** outside
`generator/`. `emit-types.mts` reaches out once, for `tagOf`. `emit.mts` reaches
out for `ChildPolicy`, `WidgetDescriptor`, `GeneratedWidget` and `tagOf`, and
every one of its four gates reads `CURATED_DESCRIPTORS`; `main.mts` wires those
in. So the gtk-host-specific half is `emit.mts` plus `main.mts`'s wiring — which
is the half that emits the **runtime table**, not the half that emits the
**types**. A prior read put this at "roughly 840 of 1 158 generic". The
generic count was right; the denominator was not (the file total is 1 620 lines,
991 of them code).

### What ts-for-gir already has, and what we duplicate

`@girs/*` today emits, per class, three things this generator re-derives:

- **`X.SignalSignatures`** — signal name → handler type, inheriting the parent
  chain and every implemented interface, with `notify::<prop>` keys included.
  Measured: 5 948 `notify::` keys in `@girs/gtk-4.0` alone.
- **the phantom `$signals: X.SignalSignatures`** on every class, marked
  `@internal`, "generated only for TypeScript type checking".
- **`GObject.SignalCallback<Emitter, Fn>`**, which prepends the emitter. So
  `SignalSignatures[K]` is the parameter list **without** the emitting object —
  which lines up verbatim with the host's `next(...args.slice(1))`.

`@gi.ts/parser` also already models `glib:nick` (`gir-types.ts:766`) and nothing
reads it.

**The independent-convergence evidence.** peachy's entire JSX type layer is
46 lines (`packages/react/src/global.d.mts`). It declares **no**
`IntrinsicElements` — its element type is the GI class — and its `SignalProps`
mapped type reads `Self["$signals"]` and wraps it in
`GObject.SignalCallback<Self, …>`. Both names already exist in `@girs/*`, with
the same shape. peachy reached that encoding independently, through
`@peachy/types` (its lockfile carries **zero** `@girs/*` entries). Two type
generators arriving at the same phantom-member vocabulary is the argument that
the vocabulary belongs in the type layer rather than in any one renderer.

This corrects the premise this ADR started from. peachy does **not** lack typed
signal handler props; it has them. What it lacks is narrower and still real:

1. `Self["$readableProperties"]`, which `@peachy/types` emits and `@girs/*` does
   not (measured: zero occurrences of `$properties` or `$readableProperties` in
   the generated types). On `@girs/*` peachy's `notify::` branch has no input.
2. `$type?: string` — declared on `IntrinsicAttributes`, so it is accepted on
   **every** element, including function components, with **every** value.

### What `ConstructorProps` is not

The obvious "we already have this" answer is `X.ConstructorProps`. It is the
wrong shape on three axes, and the first is a correctness bug:

- **It offers read-only properties as settable.** Measured on Gtk-4.0: 150
  read-only property declarations across 68 classes and interfaces, all present.
  `Gtk.Widget.ConstructorProps` carries `has_default`, `has_focus`, `parent`,
  `root` and `scale_factor`. GTK's failure mode for writing one is **exit 0** —
  no throw, no diagnostic (ADR 0027 § Context 1).
- **Its members are required**, so every consumer wraps it in `Partial<>`.
- **It spells snake_case and camelCase, never kebab** — the spelling GObject
  itself uses, and GtkBuilder's, and Blueprint's. A dialect whose attributes are
  kebab has no key to check against.
- Enum properties carry the enum constant, never the nick. Compiled against the
  shipped types: `{ top_bar_style: 'raised' }` is TS2322 and `{ 'margin-top': 6 }`
  is TS2353, while `{ has_default: true }` and `{ root: null }` compile clean.

## Decision

**`@girs/*` emits the GIR-derived widget vocabulary as module-scoped exports on
an opt-in subpath. It emits no JSX namespace and no tag spelling. Each consumer
declares its own dialect on top.**

### 1. Data-shaped, never JSX-shaped

A JSX namespace does NOT have to be global. `gtk-host` ships TWO module-scoped
ones — `src/jsx-runtime.ts:41` for Solid and `src/react-jsx-runtime.ts:97` for
React — in ONE package, each reached through its own `jsxImportSource`, and they
do not collide with each other or with anything else; the package contains no
`declare global` at all. An earlier revision of this ADR said a JSX namespace *is*
a global declaration; that is false as stated, and two dialects coexisting in one
of our own packages is the counterexample.
What is true is the PRACTICE: gtkx emits
`declare global { namespace React.JSX { interface IntrinsicElements { … } } }` per
namespace, with no module-scoped `JSX`, no `jsxImportSource` indirection and no
opt-out — so importing one widget pulls the whole element table, React's DOM
intrinsics stay in scope, and a second library augmenting the same interface
collides hard on any shared tag. That is the shape to avoid, not JSX itself.

So the reason the surface is data-shaped is not that a JSX form is impossible
here. It is that every JSX form is a DIALECT decision, and there are four of them:

- **The tag spelling.** The GIR knows `AdwToolbarView`. Turning that into
  `adw-toolbar-view` is a renderer's choice, and the constraint behind it is
  Volar's resolution rule rather than anything in the GIR.
- **The signal prop names.** `onClicked` in Solid and React, `@clicked` in a Vue
  template. GObject itself says `clicked`.
- **The shape each framework wants.** Solid wants a `JSX` namespace off its own
  `jsxImportSource`, React wants `React.JSX`, Vue wants a `GlobalComponents`
  interface. A package emitting all three would have to know all three.
- **Bundler knowledge.** `jsx-runtime`'s four exports are throwing stubs whose
  message names `babel-preset-solid` and the Vue SFC compiler. That is a statement
  about the build, not about the type system.

And the cost of leaving all four to the consumer is one line — `GtkIntrinsicElements`
is a single mapped type over the maps this subpath emits. Everything expensive
(properties per widget, enum nicks, construct-only unions, the GType map) is here;
what stays with the consumer is the spelling. A second consumer with a different
dialect writes its own line and duplicates nothing.

`@girs/*` is used by projects that want nothing to do with JSX, so an opt-in
data subpath is what serves both. Should a JSX surface ever be worth SHARING
between consumers, the answer is a package layered ON `@girs/*` — never `@girs/*`
itself, and never a global augment.

### 2. What the subpath exports

`@girs/<ns>/surface`, module-scoped, four kinds of name. Shapes as generated:

```ts
// Enum nicks — GIR's `glib:nick`, which the parser already models.
export type AdwToolbarStyleNick = 'flat' | 'raised' | 'raised-border';

// One props interface per GIR DECLARATION, mirroring GIR's own inheritance:
// writable-only, optional, kebab-keyed, nick-widened. Kebab because that is
// GObject's OWN spelling — `g_object_set(o, "top-bar-style", …)` — not a JSX
// choice; `top_bar_style` and `topBarStyle` are binding conveniences and
// therefore dialect, which is why they are not here.
export interface AdwToolbarViewProps extends GtkWidgetProps, GtkAccessibleProps {
    'top-bar-style'?: AdwToolbarStyleNick | Adw.ToolbarStyle;
    'reveal-top-bars'?: boolean;
    'extend-content-to-top-edge'?: boolean;
}

// The name union a renderer needs to know it must REBUILD rather than patch.
export type AdwAboutDialogConstructOnly = AdwDialogConstructOnly | 'appdata-resource-path';

// The GType-keyed map. GType is also the GtkBuilder key and the typelib key.
export interface Widgets {
    AdwToolbarView: {
        class: Adw.ToolbarView;
        props: AdwToolbarViewProps;
        signals: Adw.ToolbarView.SignalSignatures;   // reuses what @girs already emits
        constructOnly: AdwToolbarViewConstructOnly;
        slotCandidates: { top: 'add_top_bar'; bottom: 'add_bottom_bar'; content: 'set_content' };
    };
}
export type WidgetGType = keyof Widgets;
```

`signals` **points at** the existing `SignalSignatures` rather than emitting a
second copy. That is the whole duplication, deleted.

**No new phantom member.** Adding `$properties` to the class body would mirror
the already-shipped `$signals`, and it would land in the base `.d.ts` where every
consumer pays for it. The GType-keyed `Widgets` map carries the same link from
inside the subpath, so the base package is untouched.

### 2b. The test for what belongs here

**General goes to `@girs/*`; framework-specific stays in the framework.** peachy
implemented its own signal-prop types because `@girs/*` did not offer them, not
because it wanted its own — so "peachy already has it" is not evidence that it is
framework-specific, and the earlier reading of that as independent invention was
too generous.

The line this ADR draws, applied case by case:

| | belongs where | because |
|---|---|---|
| `$signals`, `SignalCallback` | `@girs/*` (already there) | a GIR fact |
| `$readableProperties` | `@girs/*` (missing today) | a GIR fact; peachy re-derived it only because it was absent |
| enum nicks | `@girs/*` | `glib:nick` is in the GIR |
| property keys in **kebab** | `@girs/*` | GObject's canonical spelling, see above |
| `slotCandidates` | `@girs/*` | derivable, and honestly named as candidates |
| tag spelling, `on…` names, `JSX.IntrinsicElements`, Vue `GlobalComponents` | the consumer | each framework answers it differently |
| camelCase / snake_case property keys | the consumer | binding convenience, not the GObject name |
| **which** candidate is a real slot | gtk-host | runtime behaviour ts-for-gir cannot verify |

The failure mode this test prevents is one dialect winning by being first: a
kebab `IntrinsicElements` in `@girs/*` would make every non-JSX consumer pay for
a choice only JSX consumers need.

### 3. The dialect is the consumer's, and it is small

Everything gtk-host emits today that the surface does not — the kebab tag map,
`on…` handler prop names, `WidgetPropsByTag`, both `JSX.IntrinsicElements`
dialects, the Vue `GlobalComponents` key and its Volar camelize repair — is
built from the exports above, in the consumer. Prototype measurement: **66 lines, 39 of them code**
of consumer-side dialect produce a kebab intrinsic map, `on<Signal>` and
`onNotify<Prop>` handler props with GIR-exact parameter types, a `ref` that
infers the concrete class, and a `$type` narrowed to the container's own slots.

peachy needs no dialect at all: its element type is the class, so `props` and
`constructOnly` reach it through the class it already imports, and `$type`
narrows from `slotCandidates`.

One shape difference the consumer migration will meet, recorded so it is not read as a
bug: gtk-host's `props.ts` widens EVERY object-typed property with `| null` ("clearing
one is legitimate"), while the `@girs` surface prints the nullability GIR states,
because it reads the same model the main emitter does. **Measured, so the migration has a
number rather than a shrug: 12 of the 418 dashed keys in the Gtk-4.0 surface** —
`action-target`, `cell-area`, `cell-area-context`, `pointing-to`, `page-setup`,
`print-settings`, `accel-size-group`, `title-size-group` and the four
`primary-`/`secondary-icon-gicon`/`-paintable` keys. That is a narrowing, and it wants a
decision in the consumer — widen in the dialect, or fix the fixtures that pass `null` to a
property GIR does not mark nullable — rather than a cast.

### 4. Placement stays curated, and the GIR supplies the gate

A GIR-only surface **cannot** express adoption. Measured across the 164 concrete
Gtk + Adw widgets, a naming rule over methods taking exactly one widget argument
(`pack_*`, `set_*[_widget]`, `add_*[_bar]`) finds 121 candidates on 77 widgets and
recovers **every curated slot of every slotted container exactly** —
`AdwHeaderBar` → start/end/title, `AdwToolbarView` → top/bottom/content,
`AdwActionRow` → prefix/suffix. It also yields `AdwActionRow.set_activatable_widget`,
which parents nothing. Both are `void f(GtkWidget*)` at
`transfer-ownership="none"`; **nothing in the GIR separates them.**

Cambalache bounds the residue independently: 16 of 166 widget types (9.6 %) carry
hand-written slot info, 32 rows total, and 2.2 % of all catalog rows are
un-derivable — after fifteen years of Glade heritage. That is a bill of materials,
not an argument against the move.

So: the subpath emits `slotCandidates`, named honestly as candidates. The
adoption table stays curated in gtk-host, because it encodes runtime behaviour
ts-for-gir has no way to verify. The candidate list becomes the **gate**: a GTK
release that adds a candidate no curated row covers shows up as a diff.

Two cautions taken from the same measurement: `layout='container'` is worthless
as a takes-children signal under GTK 4 (true for all 166 types), and the
parent → `<Type>LayoutChild` link exists only as an `f"{owner}LayoutChild"` string
convention, declared nowhere.

**gtkx's `omittedProps` is not copied.** It is 40 hand-typed entries in
`@gtkx/react`, not GIR-derived, applied as a `continue` in the prop collector.
The link to the placement rule is two parallel hand-maintained tables joined by a
shared `string[]` with no consistency check — their own comment calls the field
"inert at runtime; read only by codegen". The version worth having derives the
omission **from** the placement rule, which is the gap they left open. Not decided
here; it needs the curated table to move first.

### 5. Defaults come from a construction probe, never from GIR

Three independent measurements agree. Ours: GIR `default-value` and a probed
instance disagree in 104 of 953 cases. Cambalache never reads `default-value` at
all (zero hits in its tree) — it instantiates a real object, subclassing abstract
classes to do so, and where pspec-default and instance-value disagree it ships
**both**. gtkx trusts the GIR default and is the outlier. Whatever this surface
emits for defaults must come from a probe, which means it cannot come from
ts-for-gir's headless generation at all — so **no defaults are emitted here**, and
the probe stays in gjsify where a GTK is installed.

### 6. The reader is `@gi.ts/parser`, and the faster one loses

Measured on `Gtk-4.0.gir`:

| reader | file | time | RSS |
|---|---|---:|---:|
| `@gjsify/domparser` (gtk-host) | 6.2 MB | 232 ms | 53 → 96 MB |
| `@gi.ts/parser` / fast-xml-parser | 5.9 MB | 745 ms | 92 → 200 MB |

domparser is ~3× faster and ~2.5× lighter, and it still loses, for three reasons
that are not performance:

1. **One reader, one model.** The surface points at
   `Adw.Carousel.SignalSignatures` — a name the main emitter produced. If a second
   reader decided what a class is, the surface could reference a class the emitter
   did not emit. That is precisely the second truth ADR 0028 § 1 exists to prevent,
   and it would be invisible until a namespace with an unusual shape hit it.
2. `@gi.ts/parser` already models `glib:nick`. The nick vocabulary is the one
   thing gtk-host's reader adds, and it is already sitting unread in ts-for-gir.
3. **ADR 0026 § Decision 4 froze a wart under domparser** for a different
   consumer's sake: in `application/xml` mode `tagName` is LOWERCASED and
   `nodeName` UPPERCASED, both wrong by the XML spec, frozen because a measured
   consumer switches on lowercase literals at 24 sites. `gir.mts`'s own header
   already records that "a generator for a mixed-case dialect could not use this
   reader as-is". Building a published contract on a deliberately-frozen defect is
   a bill that comes due later.

The cost is bounded and one-time: 2.25 s for all seven namespaces, at generation
time, inside a generator that already parses 705 GIR files.

**As implemented it is stronger than "the same parser twice".** The surface is built
from ts-for-gir's own MODEL — `IntrospectedClass`, `IntrospectedProperty`,
`IntrospectedEnum` — not from a second `parser.parseGir()` pass, so a name the surface
references is literally a name the main emitter emitted rather than a name a second
read agreed about. That closes the § 6.1 concern by construction, and it cost three
fields the model was throwing away: `GirEnumMember.nick` (the parser has modelled
`glib:nick` since the beginning and nothing read it), `IntrospectedBase.glibTypeName`
(the GType was reachable only inside `resolve_names`, mixed with `c:type` and
`glib:type-struct`), and `IntrospectedProperty.girName` (`fromXML` rewrites `-` to `_`,
and `propertyCase: "both"` then emits a camelCase COPY, so neither spelling in the
model is the name GObject registered).

**The dogfooding loss is real and gets paid explicitly rather than absorbed.**
`gir.mts` was worth having partly because it exercised a Tier-1 package against a
real 6 MB document. Retiring it silently removes that coverage. It is therefore
kept in gjsify as a **differential test**: the same GIR parsed through both
readers, asserting identical models — the shape the `domparser`-vs-`parse5` check
already uses. That turns a side effect of production use into a named gate.

## Consequences

- **gtk-host's `src/generated/props.ts` (254 KB, 6 374 lines) is deleted** and
  replaced by imports from `@girs/gtk-4.0/surface` and `@girs/adw-1/surface` plus
  the consumer dialect. `generated/widgets.ts` (the runtime tag/GType/ctor table)
  **stays**: it is `emit.mts`'s output, it is gtk-host's model, and ADR 0028 § 1
  already decided what it may carry.
- **`generated.spec.ts` cannot move, and must not.** It asks the *installed*
  typelib whether every emitted name is real — every property a writable
  ParamSpec, every signal resolvable by `GObject.signal_lookup`, every nick
  resolvable through `coerce()`. ts-for-gir generates 705 GIRs headlessly in CI
  with no GTK and no GJS; it cannot run that check. It is also the one thing
  neither peachy nor gtkx nor Cambalache has. **It stays in gjsify**, which makes
  a hard requirement on the subpath: it must ship the same facts as a **runtime
  data module** beside the `.d.ts` (`OWN_PROPS`, `OWN_SIGNALS`, `DECLS`,
  `ENUM_NICKS`, `SINCE`), because types are erased and a spec cannot read them.
  Without `SINCE` the version-skew rule from ADR 0028 § Implementation loses its
  input and degrades to an allowlist.
- The surface is emitted only for namespaces that actually declare `GtkWidget`
  descendants. Measured on the landed generator: 705 `.gir` files in ts-for-gir's
  `girs/` reduce to 475 distinct namespaces, 102 of which declare a concrete
  `GtkWidget` descendant; a full run emits 703 `@girs/*` packages and **138** of them
  carry a `./surface` (more than 102 because a namespace with two versions — Gtk-3.0
  and Gtk-4.0 — is two packages).
- **One correction to the rule above, and it is a real one.** A base a widget inherits
  from can live in a namespace that declares no widgets and still carry settable
  properties. Dropping it shrinks the vocabulary by properties nobody would notice were
  missing; giving its namespace a surface would publish a widget surface with no widgets
  in it. So such a base is INLINED into the consuming surface, and named in that file's
  provenance line so growth shows up in a diff. Measured across all 475 namespaces this
  happens EXACTLY ONCE — `Gcr.Prompt`, a GObject interface with ten writable properties,
  implemented by widgets that live in `GcrUi` — and the first version of the generator
  refused the input instead, which took a 705-namespace run down at namespace 265. A
  base from such a namespace that carries NOTHING settable is still dropped: Gtk-4.0 and
  Adw-1 each reach four (`GObject.Object`, `GObject.InitiallyUnowned`,
  `Gio.ActionGroup`, `Gio.ActionMap`), all empty.
- ADR 0028 § 6's "gtkx is explicitly not a design constraint" survives unchanged,
  and is now better supported: gtkx binds GObject through napi and augments
  `React.JSX` globally. What this ADR takes from it is a hazard to avoid, not a
  contract to serve.

## Alternatives rejected

- **Keep it in gtk-host.** Costs nothing today and concedes the 843 generic lines
  permanently. It also leaves `@girs/*` with a `ConstructorProps` that offers 150
  read-only Gtk properties as settable — a defect every `@girs` consumer carries,
  fixed for one renderer only.
- **A separate package (`@gjsify/gir-surface` or similar).** Needs its own GIR
  reader, its own release, its own version skew against `@girs/*`, and it would
  reference `@girs` types it does not generate — reintroducing the two-readers
  problem the reader decision just closed. It buys independence from ts-for-gir's
  cadence, which risk 1 below shows is not the binding constraint.
- **Emit JSX.** § 1. The escape hatch is visible in gtkx's own repo: it exports
  every element twice, once as an intrinsic tag and once as a
  `(props: XProps) => ReactNode` const, and the component path never touches
  `IntrinsicElements`. That the workaround exists in-tree is the measurement.

## Risks

1. **Release coupling.** Lower than it looks: `@gjsify/gtk-host@0.41.0` already
   declares **eight** `@girs/*` packages as runtime dependencies at `^4.1.0`. The
   dependency exists; what is new is a contract on it. The real hazard is the
   **caret**: a minor `@girs` release can move the surface under a lockfile-less
   install. `@girs` carries two cadences already — package `version` 4.1.0 (the
   generator) and `libraryVersion` 4.23.0 (the GTK) — so the pin must be exact on
   the former, and gtk-host's committed artifact (ADR 0028 § Implementation) means
   a bad release breaks a regeneration, never a fresh clone.
2. **Curated knowledge leaking back.** It does leak, and the leak is now bounded
   twice: 32 rows over 16 types (Cambalache), 121 GIR candidates with at least one
   false positive that the GIR provably cannot exclude (ours). The design keeps
   the derived candidates in `@girs/*` and the adoption table in gtk-host, so the
   leak has a fixed size and a gate that reports growth.
3. **Making every `@girs/*` consumer pay.** Answered structurally, not by
   promising it is small: the surface is a **separate subpath**, so a consumer
   that never imports it parses **zero** additional bytes — TypeScript reads only
   files a program reaches. For scale, as landed: the Gtk-4.0 surface is 158 KB /
   3 193 lines against a 5.86 MB / 147 574-line base `.d.ts` — 2.8 % if imported, 0 %
   if not.
   The design's refusal to add a `$properties` phantom is what makes this true;
   a phantom would land in the base file and be unavoidable.

## Implementation

**Step 1 is landed in ts-for-gir** (`packages/generator-typescript/src/surface/`, behind
a `widgetSurface` flag that `.ts-for-gir.packages-all.rc.js` turns on). The measurement
from the real generator, against the prototype numbers this ADR was written from:

| | prototype | landed | why it moved |
|---|---:|---:|---|
| Gtk-4.0 widgets / declarations | 102 / 127 | 102 / 123 | four empty bases from namespaces with no surface are dropped |
| Gtk-4.0 enum nick unions | 38 | 105 | a namespace emits a union for EVERY registered enum it declares, not only the ones its own properties reference — see below |
| Gtk-4.0 slot candidates | 59 | 60 | candidates are keyed by SLOT, and two methods can derive one name (`set_child`/`add_child` → `child`); first wins in sorted order, because a duplicate key in a type literal is TS1117 |
| Gtk-4.0 surface lines | 3 259 | 3 193 | — |
| Adw-1 widgets / declarations | 62 / 81 | 62 / 63 | the Gtk half of the chain is IMPORTED from `@girs/gtk-4.0/surface`, not copied |
| Adw-1 enum nick unions | 28 | 25 | the Gtk-owned unions — six in the landed version — are imported rather than copied, and the all-registered rule below adds Adw's own unreferenced enums |
| Adw-1 surface lines | 2 754 | 2 373 | both of the above |

**Why "every registered enum", and why the first count was 38.** Emit-what-you-reference
is what shipped first, and the per-package `tsc --project` failed it:
`GtkSourceView:text-window-type` reaches `Gtk.TextWindowType`, no Gtk-4.0 widget property
does, so `@girs/gtk-4.0/surface` had no `GtkTextWindowTypeNick` for
`@girs/gtksource-5/surface` to import — TS2305, and the same shape for `GtkPackTypeNick`
in Handy-1 against Gtk-3.0. The nick vocabulary of a namespace is a property of the
NAMESPACE, not of which of its own properties happen to use it, and emitting all of them
is also what makes `ENUM_NICKS` a complete answer for a consumer checking nicks against
the installed library. The 38 and 16 in the first version of this table are the
pre-fix numbers; the +67 unions on Gtk-4.0 and +9 on Adw-1 account for the line deltas
above exactly, in the `.d.ts` and in the runtime data alike.

102 + 62 = **164** still matches gtk-host's own concrete-widget count exactly. The
Gtk-4.0 surface is 158 KB / 3 193 lines against a 5.86 MB / 147 574-line base `.d.ts` —
2.8 % if imported, 0 % if not — plus 45 KB / 600 lines of runtime data.

Three corrections this ADR needed, all of them from running the thing:

1. **Cross-namespace declarations are imported, not inlined.** The prototype copied the
   whole Gtk chain into Adw's file, which is what its 81/28 counts measure. Two
   nominally distinct `GtkWidgetProps` in one program is a confusing error waiting for
   the first consumer that mixes them.
2. **A base from a namespace with no surface is inlined when it carries settable
   properties**, not refused — § Consequences, with the one corpus-wide counterexample.
3. **The reader is ts-for-gir's own MODEL, not a second parse** — § 6.

The gate is `tests/widget-surface`: positives over a small fixture toolkit, plus three
controls that must go the other way — the flag off emits nothing and no `./surface`
export, an unmappable property type exits non-zero naming the property, and the `.d.ts`
and `.js` halves are read independently and compared. The emitted surface is also in
each generated package's `tsconfig.json#include`, which is what caught the first real
defect: 9 × TS2304 in Adw-1, because nick unions owned by Gtk were skipped locally
without being imported.

Migration order, each step green before the next:

1. Land the subpath in ts-for-gir behind a per-namespace opt-in, plus the runtime data
   module, `@girs/*` main `.d.ts` untouched — **done**.
2. Verify peachy's `global.d.mts` compiles against `@girs/*` unchanged, with the `props`
   axis reached through `Widgets` standing in for `$readableProperties`. That is the
   "does an outsider benefit" test, and it is falsifiable. Not done.
3. gjsify pins the exact `@girs` version, replaces `generated/props.ts` with the
   consumer dialect, and repoints `generated.spec.ts` at the published runtime data.
   `widgets.ts`, `descriptors/` and `emit.mts` do not move. **Blocked on a published
   `@girs` release**; the probe that says it has arrived is in `status/open-todos.md`.
4. Retire `gir.mts` from the generation path; keep it as the domparser differential
   test. Needs 3.
5. Only then consider deriving `omittedProps` from the curated placement rule.

## Amendment — 2026-09-01: the subpath is `vocabulary`, and steps 3 and 4 have landed

**The subpath shipped as `@girs/<ns>/vocabulary`, not `/surface`.** Everything above
that says `surface` means this. The rename happened before any consumer existed, so
nothing was carried for compatibility. `surface` was the wrong word twice over: it is
one of those abstract metaphor nouns that reads technical and says nothing, and this
repo already spends it on three other things (the type surfaces `check-type-surfaces.mjs`
gates, the widget surfaces `check-vocabulary-alignment.mjs` reads, an `.d.ts` API
surface). `vocabulary` says what the export is — the names a namespace registers, and
what each one is called — and it is already the word ADR 0034 uses for the rule this
data serves.

**Step 3 landed** as `packages/framework/gtk-host/src/generator/girs-vocabulary.mts`.
Both halves of a vocabulary are read: the runtime `.js` for the facts and the `.d.ts`
for the rendered types, the docs and — this one was not foreseen — the namespace
imports. Which namespaces the rendered types reach into cannot be derived from the
source list: `Gdk.RGBA` appears in a Gtk property, and emitting it without reading
`import type Gdk from '@girs/gdk-4.0'` out of the vocabulary's own header produces
TS2503 in a file nobody hand-edits.

Measured against the artefact the GIR route produced: kebab properties 599 → 601,
camelCase 2192 → 2187. The 14 lost are signal handlers off the four bases the
vocabulary declares as dropped (`GObject.Object`, `GObject.InitiallyUnowned`,
`Gio.ActionGroup`, `Gio.ActionMap` — `PROVENANCE.droppedBases` states them, which is how
the loss was attributable rather than mysterious); the 9 gained are real, `GtkSvgWidget`
among them. Two vocabularies read in 28 ms, against a 232 ms parse of one 6.2 MB GIR.

**One consequence the ADR did not anticipate: the vocabulary can describe a NEWER
library than the one installed.** The GIR route read a local file and could never see
this. `@girs` is generated on one machine and consumed on another, so `GtkSvgWidget` is
in the surface and not in the GTK here. Six checks died on it as a bare `can't access
property "$gtype"`, naming nothing. The provenance line now carries the library version
(`Gtk-4.0/4.23.3`) and the suite reads it back, so the gap is judged once, by name,
against the running version — and the two enum nicks in the same position
(`GtkEditableProperties.prop-complete-text` and `prop-input-interceptor`) are listed on
every run instead of silenced. Those checks are SHARP only where the versions match.

**Step 4 dropped `gir.mts` outright, and the differential test it was to become is not
being built.** The plan was to keep it as a domparser differential; the input makes that
impossible in the honest form. A 6.2 MB `Gtk-4.0.gir` is a distro artefact that is not
in this repository and should not be, so the test would either read whatever GIR the
machine happens to have — a test that measures the machine — or read nothing. If
domparser wants the large-document assurance the parse was quietly providing (232 ms,
53 MB RSS), it needs a GENERATED fixture of its own, in its own package, sized on
purpose. Named here rather than left to be rediscovered as a gap.
