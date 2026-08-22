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

1. The widget table — tag, GType, property names, construct-only set, signals — is
   generated at build time from the GIR, through `ts-for-gir` in the established
   `build:gir-types` subprocess form. It travels with the package.
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
   template), and a tag/property validator usable against Blueprint and its
   GtkBuilder XML — so a widget name cannot mean different things in different
   dialects. This is the alignment mechanism ADR 0027 § 9 names.

   It is consumable from outside this repository **on purpose**. Peachy and gtkx
   already author GTK UIs in TSX and generate their own types; one GIR-derived
   surface is worth more to the ecosystem than three private copies, and it costs
   nothing to share — the generator's input is the GIR and the installed typelib,
   not anything gjsify-specific.

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

Until the generator lands, the table is curated in full under
`packages/framework/gtk-host/src/descriptors/` and held to the same check. The
generator and its four gates (every gtype present in the GIR; curated may add,
never contradict; every named method exists on that GType; no vacuous descriptor)
are tracked in `status/open-todos.md`.
