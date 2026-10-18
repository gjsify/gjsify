# 118. A `GLib.Variant` subset runs on the browser and NativeScript, and `Gio.Settings` stores arrays with it

- Status: **Proposed**
- Date: 2026-10-18
- Deciders: Pascal Garber
- Depends on: [ADR 0096 (a GObject subset)](0096-a-gobject-subset-runs-on-the-browser-and-nativescript.md)
- Completes: [ADR 0099 (`Gio.Settings`)](0099-gio-settings-runs-on-the-browser-and-nativescript.md)
  § What this does not decide, first item; amends ADR 0099 § 2 (two rows)
- Related: [ADR 0097 (menus and actions)](0097-menus-and-actions-run-on-the-browser-and-nativescript.md)
  (action parameters), [ADR 0100](0100-file-dialog-and-gio-file-run-on-the-browser-and-nativescript.md)
  (`GLib.Bytes` / `GLib.Error`, the same shape of subset),
  [ADR 0110](0110-real-gobject-becomes-the-android-default-and-the-subset-stays-tested-there.md)

## Rule for every stage

The API is GLib's. A stage may implement a strict SUBSET: the same names with GJS's semantics, and
what is not implemented throws, naming it. Later stages only add; an application written against an
earlier stage is never rewritten. A claim needs a conformance vector; a refusal must throw.

## Context

ADR 0099 gave the browser and NativeScript a `Gio.Settings` subset with the key types `b`, `i`, `u`,
`d` and `s`, and refused `get_value`, `set_value` and `GLib.Variant` by name, deferring them to "its
own decision". This is that decision.

The consumer that needs it exists. Learn6502's schema (`eu.jumplink.Learn6502.gschema.xml`) has one
key outside ADR 0099's types:

```xml
<key name="support-prompt-years" type="ai">
    <default>[]</default>
</key>
```

GIO has no typed getter for `ai`, so the GNOME app reads and writes it the only way GJS offers
(`packages/app-gnome/src/support-prompt.ts`):

```ts
read: () => settings.get_value(SETTINGS_KEY).deepUnpack<number[]>(),
write: (years) => settings.set_value(SETTINGS_KEY, new GLib.Variant('ai', years)),
```

On the web and Android this code cannot run: the build refuses the schema key, and the `Settings`
instance refuses both methods. Learn6502 therefore keeps the setting unpersisted on those targets,
which is the per-platform fork ADR 0099 exists to remove.

Two more places already wait for `GLib.Variant`:

- `Gio.SimpleAction` refuses `activate_action` with a parameter, "needs a GLib.Variant"
  (`adwaita-core/src/gio-actions.ts`).
- ADR 0099 § 4: the `Gio.SettingsBackend` hook exchanges `GLib.Variant`, "so the hook waits for the
  `GLib.Variant` decision".

GJS's `GLib.Variant` is not uniform at its edges, and the subset must copy it, not tidy it. Measured
on GJS (2026-10-18): `new GLib.Variant('ai', [1.5])` stores `[1]`, `new GLib.Variant('ai', ['x'])`
and `new GLib.Variant('ai', 3)` do not throw, `new GLib.Variant('u', -1)` throws "out of range for
uint32", `new GLib.Variant('s', 3)` throws, and an invalid signature throws a `TypeError` naming the
character. `unpack()` of an `ai` returns `GLib.Variant`s; `deepUnpack()` returns numbers.

## Decision

### 1. Where it lives

The behaviour lives once in `@gjsify/adwaita-core` (`glib-variant.ts`), beside `glib-bytes.ts` and
`glib-error.ts`, and reaches no DOM and no NativeScript. Each port's `GLib` barrel re-exports it as
`Variant`, and the `gi://GLib` arm of `GI_RENDERERS` routes it like `Bytes`. The class is a pure JS
value: it is not a GObject, as `GLib.Variant` is not one on GJS either.

This ADR does not change which engine backs `gi://GLib` on Android. Today the NativeScript port's
`GLib` barrel is the JS subset under both GObject engines (ADR 0110), and the `Variant` row joins it.

### 2. The subset

The type strings are the ones a consumer needs: ADR 0099's basic types and arrays of them.

| GJS spelling | on the browser and NativeScript |
|---|---|
| `new GLib.Variant(type, value)` for `b`, `i`, `u`, `d`, `s` | implemented. Coercion, range errors and error messages follow the GJS oracle row by row |
| `new GLib.Variant(type, value)` for `ab`, `ai`, `au`, `ad`, `as` | implemented, the same way per element |
| any other type string (`y`, `n`, `q`, `x`, `t`, `h`, `o`, `g`, `v`, `m…`, tuples, `a{…}`, nested arrays) | refused by name, naming the type string. An invalid signature throws `TypeError` as GJS does |
| `get_type_string()`, `unpack()`, `deepUnpack()`, `deep_unpack()`, `recursiveUnpack()`, `equal(other)` | implemented |
| `print(type_annotate)` | implemented for the subset's types; the output is GLib's text format, byte for byte |
| `get_boolean`, `get_int32`, `get_uint32`, `get_double`, `get_string`, `get_strv`, `n_children`, `get_child_value` | refused by name until a consumer needs them (ADR 0096 § 2) |
| `GLib.VariantType`, `GLib.Variant.parse`, `new_*` constructors, `get_data_as_bytes`, `byteswap`, `hash`, `compare` | refused by name |

`deepUnpack` of an `ai` returns `number[]`, so Learn6502's line runs unchanged.

### 3. `Gio.Settings` gains `get_value` / `set_value` and array keys

ADR 0099 § 2 is amended in two rows:

| GJS spelling | on the browser and NativeScript |
|---|---|
| key types `ab`, `ai`, `au`, `ad`, `as` in the `.gschema.xml` | accepted by the build. The `<default>` is parsed from GLib's text format for these types only; anything else is refused at build time, naming the key and line, as ADR 0099 § 2 already does |
| `get_value(key)`, `set_value(key, variant)` | implemented for every key type of the subset. `set_value` with a `Variant` of another type throws naming key, expected and actual type string, as `set_*` does |
| `get_user_value`, `get_default_value`, `get_strv`, `set_strv` | still refused by name, until a consumer needs them |

Storage follows ADR 0099 § 3 with one added row: an array key is stored as the `Variant`'s
`print(false)` text, under the same `<path><key>` storage key, through `localStorage` on the browser
and `setString` on NativeScript. Reading it back parses that text with the same parser the build
uses for `<default>`, including the `@ai []` annotation `gsettings get` prints for an empty array. An unparsable stored value is treated as unset and logs once, as § 3 already
says for the basic types. One text format means one parser, and a value copied from
`gsettings get` on GNOME is readable on the other targets.

`changed::key` for an array key fires under ADR 0099 § 3's rule. Whether `set_value` of an EQUAL
array emits `changed` is what the GJS oracle records.

### 4. What stays deferred

- Action parameters. `activate_action` with a parameter, `parameter_type` and stateful actions with
  a non-boolean, non-string state stay as ADR 0097 has them. With `Variant` present, lifting them is
  an amendment to ADR 0097 once a consumer needs one, not a new decision.
- The `Gio.SettingsBackend` hook of ADR 0099 § 4. Its vfuncs exchange tuples and dictionaries
  (`a{sv}`) that § 2 refuses; it still waits for a consumer.

## Consequences

- Learn6502's `support-prompt.ts` runs on three targets unchanged, and `support-prompt-years`
  persists on the web and Android.
- `REFUSED_METHODS` in `@gjsify/app-settings` loses `get_value` and `set_value`; `BUILD_TYPES` gains
  the five array types; the `?schema` build step gains a GVariant text parser restricted to them.
- Each port's `GLib` barrel grows one export. The barrel comments ("A TRUE SUBSET: everything else in
  GLib … is absent") stay true; `check-vocabulary-alignment.mjs` learns the new row.
- An app that needs a type outside § 2 gets a refusal naming the type string, and the gap report
  lists it. Widening the subset is an additive amendment.

## Alternatives rejected

- **Keep `ai` unpersisted on the web and Android.** That is the per-platform fork in the app that
  ADR 0099 was written to remove.
- **A JSON-only setter such as `set_json(key, value)`.** A name GIO does not have, reachable through
  `gi://Gio`; it breaks the subset rule.
- **Store arrays as JSON.** A second text format beside the GVariant text the build must parse for
  `<default>` anyway; two parsers drift.
- **Implement the full GVariant type system now.** Tuples, dictionaries, maybe types, handles and
  the binary serialisation have no consumer (ADR 0096 § 2), and each would need its own oracle rows.
- **Back `GLib.Variant` on Android with node-gi's real GLib.** The settings store is JS on every
  target, so the value would be converted twice, and the browser still needs the JS subset. Which
  engine backs `gi://GLib` on Android is ADR 0117's question, not this one.

## What this does not decide

- Action parameters and non-boolean action state (ADR 0097).
- `Gio.SettingsBackend`, relocatable schemas (ADR 0099).
- The binary GVariant serialisation and `GLib.Bytes` interop.
- The engine behind `gi://GLib` on Android (ADR 0117).

## Implementation

Tracked in `status/open-todos/adwaita-core.md` once accepted. One PR, a commit per step:

1. `VARIANT_VECTORS` against GJS first (the oracle), covering every row of § 2, including the
   coercion and refusal edges listed in the Context.
2. `glib-variant.ts` in `@gjsify/adwaita-core` with the text-format printer and parser.
3. The `Variant` export in the web and NativeScript `GLib` barrels and the `gi://GLib` arm.
4. `@gjsify/app-settings`: array key types in the schema step, `get_value` / `set_value`, the
   storage row; `SETTINGS_VECTORS` extended against GJS.

First consumer: Learn6502's `support-prompt.ts`, picked up in its own repository once a release
carries this.
