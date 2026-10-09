# 99. `Gio.Settings` runs on the browser and NativeScript, as `@gjsify/app-settings`

- Status: **Proposed** (2026-10-09)
- Date: 2026-10-09
- Deciders: Pascal Garber
- Depends on: [ADR 0096 (a GObject subset)](0096-a-gobject-subset-runs-on-the-browser-and-nativescript.md)
- Related: [ADR 0097 (menus and actions)](0097-menus-and-actions-run-on-the-browser-and-nativescript.md),
  [ADR 0098 (a minimal Application)](0098-a-minimal-application-runs-on-the-browser-and-nativescript.md),
  [ADR 0100 (`Gtk.FileDialog` and `Gio.File`)](0100-file-dialog-and-gio-file-run-on-the-browser-and-nativescript.md)
- Completes: the `Gio.Settings` item of ADR 0098 § What this does not decide.

## Rule for every stage

The API is GIO's. A stage may implement a strict SUBSET: the same names with GJS's semantics, and
what is not implemented throws, naming it. Later stages only add; an application written against an
earlier stage is never rewritten. A claim needs a conformance vector; a refusal must throw.

## Context

A GNOME app keeps its preferences in GSettings. Learn6502 (`gjsify/easy6502`, `packages/app-gnome`)
shows what that costs when the app must also run on the browser and on Android. Measured, by reading
the source:

- **Schema.** One `eu.jumplink.Learn6502.gschema.xml` with a fixed `path` and nine keys: `s` ×4
  (`ui-font`, `primary-color`, `accent-color`, `font-name`), `i` ×3 (`color-scheme`, `window-width`,
  `window-height`), `b` ×3 (`is-maximized`, `show-line-numbers`, `auto-indent`). Every key has a
  `<default>`, `<summary>` and `<description>`. No `<range>`, `<choices>`, enum, flags or array.
- **Construction.** One module-level `new Gio.Settings({ schema_id, path })` in `src/settings.ts`.
  `ui-font.service.ts` takes the instance as an argument.
- **Methods used.** `get_string`, `set_string`, `get_int`, `set_int`, `get_boolean`, `set_boolean`,
  and `connect(\`changed::${key}\`, () => …)` (four call sites). Nothing else: no `bind`, `get_value`,
  `reset`, `apply`, `delay`, `sync`, `Gio.SettingsBindFlags`.

What gjsify has today, measured in this repository:

- `packages/web/webstorage`: the W3C `Storage`, an in-memory `Map` on GJS and native in the browser.
  Not persistent on GJS, and it knows nothing of NativeScript.
- `packages/framework/devtools/src/gsettings.ts` (`dumpGSettings`) reads an installed schema on GJS
  through `Gio.SettingsSchemaSource`. `packages/infra/cli/src/commands/gsettings.ts` compiles
  `*.gschema.xml` with `glib-compile-schemas`. Both are GJS-only and neither is a runtime.
- `packages/nativescript-bridge/adwaita/src/namespace/gio.ts` and
  `packages/web/adwaita-web/src/namespace/gio.ts` say in a comment that `Gio.Settings` is not their
  business. No package exports `Gio.Settings`, `ApplicationSettings` or a settings schema.

So the capability is new. The three storage backends exist (GSettings, `localStorage`, NativeScript
`ApplicationSettings`); the schema and the `Gio.Settings` class over them do not.

## Decision

**`@gjsify/app-settings` exports a `Settings` class that is a strict subset of `Gio.Settings`. On GJS
it is not used: `gi://Gio` is native GSettings. On the browser it stores in `localStorage`, on
NativeScript in `ApplicationSettings`. Each port's `Gio` barrel re-exports it as `Gio.Settings`. The
schema is the `.gschema.xml` the GNOME app already ships, read at build time. Key types are `b`, `i`,
`u`, `d` and `s`. Everything else is refused by name.**

### 1. The schema

The `.gschema.xml` stays the single source (ADR 0051's rule: no second copy). A build step turns it
into a typed module the runtime imports; the runtime never parses XML.

- **Specifier.** `import schema from './eu.jumplink.Learn6502.gschema.xml?schema'`, a second specifier
  in the sense of ADR 0070 § 1. On GJS the same import resolves to the file's URL, ignored; the
  compiled schema is what GSettings reads, and `gjsify gsettings` already builds it.
- **Registration.** `Settings.register(schema)` is the only addition to GIO's names. It is called
  once, before the first `new Gio.Settings`. A GJS build has no such call, so the line is behind the
  same `?schema` exit as `?template` in ADR 0096 § 4: the import evaluates to a no-op on GJS.
- **Carried.** Per key: `type`, `default`, and nothing else; `summary` and `description` are
  translation material and stay in the XML.
- **Refused at build time, naming the key and line:** a key type outside § 2; `<range>`, `<choices>`,
  `<enum>`, `<flags>`; `<child>`, `<override>`; a schema without `path`, because the browser and
  Android need one to build a storage key.

### 2. The subset

| GJS spelling | on the browser and NativeScript |
|---|---|
| `new Gio.Settings({ schema_id, path? })` | implemented. An unregistered `schema_id` throws naming it (GJS aborts the process; a throw is the portable form). `path`, if given, must equal the schema's |
| `get_boolean`, `get_int`, `get_uint`, `get_double`, `get_string` | implemented. A key of another type throws naming key, expected and actual type. An unknown key throws naming it |
| `set_boolean`, `set_int`, `set_uint`, `set_double`, `set_string` | implemented. Same checks. An out-of-range integer throws. The value is stored immediately; there is no `apply` |
| `connect('changed::key', (settings, key) => …)`, `connect('changed', …)`, `disconnect(id)` | implemented over the GObject signal core of ADR 0096. A signal other than `changed` throws, as `connect` of an unknown signal does on GJS |
| `schema_id`, `path` as properties | implemented, read-only |
| `list_keys()`, `settings_schema` | refused by name. `dumpGSettings` stays a GJS tool |
| `get_value`, `set_value`, `get_user_value`, `get_default_value`, `GLib.Variant` | refused by name. `GLib.Variant` has its own decision (ADR 0097 § 3 owns only the four methods it needs) |
| `reset`, `apply`, `delay`, `revert`, `sync`, `get_has_unapplied`, `is_writable`, `list_children`, `get_child` | refused by name until the gap report lists them for a project being converted (ADR 0096 § 2) |
| `bind`, `bind_with_mapping`, `bind_writable`, `create_action`, `Gio.SettingsBindFlags` | refused by name; see § 4 |
| `Gio.Settings.new(id)`, `new_with_path`, `new_full`, `Gio.SettingsSchemaSource` | refused by name. The constructor with a property object is the form Learn6502 uses |

### 3. Storage and `changed`

| | browser | NativeScript |
|---|---|---|
| backing store | `localStorage` | `ApplicationSettings` (`SharedPreferences` on Android) |
| storage key | `<path><key>`, e.g. `/eu/jumplink/Learn6502/window-width` | the same string |
| value encoding | `b`: `"true"`/`"false"`; `i`, `u`, `d`: decimal; `s`: the string | native `setBoolean` / `setNumber` / `setString` |
| a key never written | the schema default | the schema default |
| `changed` from another instance | in-page registry, so two `Settings` on one schema agree | the same |
| `changed` from another tab | the `storage` event emits `changed::key` | not applicable: one process |

An unparsable stored value (someone edited `localStorage`) is treated as unset and logs once; the
default is returned. GSettings also falls back to the default for a value of the wrong type.

Whether `set_*` of a value EQUAL to the stored one emits `changed` is GJS's answer, not ours: the
vector below records what GJS does and the subset follows it.

Quota or private-mode failures of `localStorage.setItem` throw out of `set_*`, naming the key. GJS
reports an unwritable key through `set_*` returning `false`; the subset does not copy that boolean
until a consumer reads it (Learn6502 does not).

### 4. `bind()`

`bind(key, object, property, flags)` is what a GNOME app uses to avoid writing the `changed` handler
twice. Learn6502 does not call it, so by ADR 0096 § 2 it is refused now. When a consumer does, it
is one export over the binding engine ADR 0096 already has (`SYNC_CREATE`, `BIDIRECTIONAL`), with
`Gio.SettingsBindFlags.DEFAULT/GET/SET/GET_NO_CHANGES` mapped to those; `NO_SENSITIVITY` and the
mapping callbacks stay refused. This ADR does not decide it earlier.

### 5. Proof

- `SETTINGS_VECTORS` in `@gjsify/app-settings/conformance`, run on the web driver, the NativeScript
  driver and real GJS with `GSETTINGS_BACKEND=memory` so no dconf is needed. GJS is the oracle: a
  vector that does not hold on GJS is a wrong vector, not a port bug.
- Vectors, for each of `b i u d s`: a never-written key returns the default; `set` then `get` returns
  the value; a second instance sees it. `changed::key` runs once per set with the key; `changed::other`
  does not run; `disconnect` stops it; a set of the equal value does what GJS does. Wrong-type getter
  and unknown key throw, naming it. The `storage`-event vector is web-only.
- Refusal vectors (every row refused in § 2, an unregistered schema, an unsupported schema key type)
  are subset-only and are not run on GJS.
- The gate is the one ADR 0093 § 4 built. Learn6502's nine keys are a fixture schema in the package.

## Consequences

- `theme.service.ts` and `main.window.ts` in Learn6502 run on three targets with `import Gio from
  'gi://Gio'` unchanged, and the settings code in its web and Android copies can go.
- The `.gschema.xml` is read by the build as well as by GNOME; a key added there reaches all three.
- Each port's `Gio` barrel stops being only "what an Adwaita author constructs" (its comment says so);
  the comment and `check-vocabulary-alignment.mjs`'s expectations change in the implementation PR.
- Settings do not sync between targets. `localStorage` and `SharedPreferences` are per device.

## Alternatives rejected

- **A JSON/TS schema authored by hand.** A second source next to the XML GNOME needs; they drift.
- **Parse the XML at runtime.** Ships an XML parser to the phone to learn what the build knew.
- **`Settings` of our own shape (`settings.get('x')`).** Every GNOME app's settings code would be a
  second source, the thing ADR 0051 exists to remove.
- **Back the browser with the in-memory `webstorage` package.** It is not persistent; the browser
  already has the real `localStorage`.
- **Implement `get_value`/`GLib.Variant` now for completeness.** "GSettings would have it" is not a
  reason (ADR 0096 § 2).

## What this does not decide

- `GLib.Variant` in general, `bind()` before a consumer (§ 4), and `Gio.Settings` relocatable schemas.
- Cross-device sync, and iOS (`NSUserDefaults` is the obvious cell, not reasoned here).
- `Gio.PropertyAction` over a setting (refused by ADR 0097).

## Implementation

Tracked in `status/open-todos/adwaita-core.md`. One PR, a commit per step: the `SETTINGS_VECTORS`
against GJS (the oracle first); the schema step and `?schema` specifier; the browser backend; the
NativeScript backend; the `Gio` barrel rows and the `GI_RENDERERS` arm. First consumer: Learn6502's
`settings.ts`, converted in its own repository once a release carries this.
