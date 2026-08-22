# 28. GIR-generated widget table, runtime ParamSpec for values

- Status: **Accepted**
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
fifth answer. The machine-INDEPENDENT check is the runtime one that already
exists — `descriptorProblems()` against the installed typelib, plus `tableSkew()`
for classes the installed GTK does not have, which is version skew and not a bug.
