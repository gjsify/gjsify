# 88. A `.blp` exports its ids as TYPED names, and the types travel in a committed sidecar

- Status: **Accepted**
- Date: 2026-10-01
- Deciders: Pascal Garber
- Related: [ADR 0053](0053-blueprint-parsed-in-repo.md) (the in-repo parser these exports are
  derived from), [ADR 0070](0070-a-blp-reaches-a-renderer-through-a-second-specifier.md) (why an
  exit is chosen by the SPECIFIER and not by the build target),
  [ADR 0033](0033-declarative-templates-preferred.md) (the tree is declared, the behaviour is
  TypeScript)

## Context

A `.blp` names its objects. `Gtk.MenuButton menuButton { }` is an id the compiled XML carries and
GtkBuilder resolves. Nothing on the TypeScript side knows that, because `*.blp` is declared as one
`string` module, so every id is re-typed by hand at the import site — twice, in two different
languages, with nothing comparing them:

```ts
// the builder shape
const builder = Gtk.Builder.new_from_string(ui, -1);
const button = builder.get_object('download_button') as Gtk.Button;

// the template shape
declare private _menuButton: Gtk.MenuButton;
static { GObject.registerClass({ GTypeName: 'GalleryHeaderBar', Template,
                                 InternalChildren: ['menuButton'] }, this); }
```

Three transcriptions of facts the `.blp` already states — the id, its type, and the class name the
`template` block defines — and every one fails the same way. A `get_object` cast is unchecked by
construction: rename the id in the `.blp` and the cast still compiles, `get_object` returns `null`,
and the failure surfaces as a property access on null at run time. `InternalChildren` is worse,
because the `declare` beside it is a PROMISE with no producer: the two lists are matched by GJS at
`registerClass` time, so a `declare` naming a child the template does not have is a field that is
permanently `undefined` and type-checks everywhere.

The facts are all in the AST already. `ObjectNode` carries `type` and `id`, `TemplateNode` carries
`className`, and the `using` lines carry the namespace versions a `gi://` import needs. ADR 0053
made that AST authoritative for the build; this is the second thing to derive from it.

## Decision

### 1. The `default` export does not move

A `.blp` module's `default` stays the GtkBuilder XML string. Every existing consumer — five DOM
showcases, four templates, two gallery showcases — keeps compiling untouched, and ADR 0070's
property holds one layer further out: the exits are ADDED as named exports, so nothing a build flag
or a new export can do changes what `import Template from './x.blp'` means.

### 2. A builder file exports `build()`

For the objects a file declares at its roots, the plugin generates:

```ts
import { build } from './button-content.blp';
const { download_button, content } = build();
```

`build()` creates the `Gtk.Builder` from the file's own XML and returns `{ builder, …ids }` with
every id typed from the `.blp`'s own type reference — `download_button: Gtk.Button`,
`content: Adw.ButtonContent`. The `builder` is returned beside them because it owns the objects'
lifetime and a caller that wants `get_object` for something derived still has it.

It calls `Adw.init()` where the file writes `using Adw`. Measured: GtkBuilder resolves a class by
GType NAME and a namespace nothing has touched is not registered, so a template using Adwaita
types built before `Adw.init()` fails with `Invalid object type 'AdwHeaderBar'` and hands back
null children. `Adw.Application` does this at startup, which is why an app never sees it and a
headless probe does — `showcases/gtk/adw-blueprint-layout/src/app.ts` carries that measurement
already and had to call `Adw.init()` by hand for it.

### 3. A template file exports `GTypeName`, `InternalChildren` and `Children`

```ts
import Template, { GTypeName, InternalChildren, type Children } from './header-bar.blp';

export interface GalleryHeaderBar extends Children {}
export class GalleryHeaderBar extends Adw.Bin {
    static { GObject.registerClass({ GTypeName, Template, InternalChildren }, this); }
}
```

`InternalChildren` is `as const`, so it is the file's id list and not `string[]`. `Children` is the
`_`-prefixed member shape GJS actually installs, and that spelling is MEASURED rather than assumed:
on gjs 1.88.1, `InternalChildren: ['download-button']` installs `this._download_button` — a dash
becomes an underscore and nothing is camel-cased, so `_downloadButton` and `_download-button` are
both `undefined`. The derivation applies that one transform and no other.

`extends Children` on a declaration-merged interface, rather than fields in the class body, because
the members are installed by `registerClass` and not by the constructor — a class FIELD would be
initialised to `undefined` at construction and shadow the installed property.

### 4. The types reach TypeScript through a committed sidecar

A `.blp` gets an `x.d.blp.ts` beside it, read under `allowArbitraryExtensions`. Spiked before this
ADR was written, on TypeScript 6.0.3, under both `moduleResolution: bundler` and `NodeNext`, and
under `gjsify tsc` as well as Node's `tsc`:

- a sidecar WINS over the ambient `declare module '*.blp'` wildcard — named imports resolve to it;
- a `.blp` with NO sidecar still falls back to the wildcard and keeps typing as `string`, so the
  migration is per-file and never all-at-once;
- without `allowArbitraryExtensions` the sidecar is ignored and the wildcard answers, which is the
  negative control that proves the first bullet is the sidecar being read and not the wildcard
  being permissive.

The sidecars are COMMITTED, not generated into a cache. The reason is the one `gjsify check` runs
into: a type-check is not a build, and `tree-checks` installs the workspace without building it, so
types that only exist after a bundler has run are types the gate cannot see. Committing them also
makes the derivation reviewable — a diff in a sidecar is the `.blp`'s own surface changing.

### 5. The sidecars are held by a drift check, not by discipline

`scripts/check-blueprint-sidecars.mjs` regenerates every COMMITTED sidecar from its `.blp` and
diffs: red on stale, red on orphaned. Two producers write them — the vite plugin during build and
watch, and `gjsify blueprint types` before a check or a `tsc` — and a committed artifact with two
producers and no comparison is the shape ADR 0053's own census table already went stale in.

A sidecar is opt-in per file, and the gate does NOT demand one per `.blp`: most of the tracked
`.blp` are corpus fixtures and gallery sources nothing imports by name, so a sidecar for each
would commit a file per fixture for nothing to read. The third failure — a
named import with no sidecar — is held by the compiler and not here: the import falls back to the
wildcard, which exports only `default`, and `tsc` reports TS2614 naming each missing member. A
grep for `.blp` imports in the gate would be a weaker second reader of a question `gjsify run
check` already answers exactly.

### 6. A sidecar is written in the CONSUMER's format, and it is a REQUIRED argument

A committed sidecar lives in the consumer's tree, where the consumer's `gjsify format --check` holds
it. So the emitter writes the bytes THAT formatter produces, and it asks rather than assumes:
`emitTypedSidecar(file, name, format)` refuses to run without a format, and `emitFormatForTree(dir)`
resolves one from the nearest `.oxfmtrc` — the same two names, the same order, the same 12 levels
`gjsify format` itself walks, so the two cannot answer "which file does the formatter read"
differently. `emitFormatForTree` reaches for `node:fs`, so it sits behind the
`@gjsify/blueprint/oxfmt` subpath rather than the barrel: `adwaita-web` parses a `.blp` in the
BROWSER, and a filesystem polyfill in that bundle would serve nobody.

The options modelled are the ones that change an emitted byte: `tabWidth`, `useTabs`, `semi`,
`singleQuote`, `printWidth`, `quoteProps`, `trailingComma`, `endOfLine`. They are MODELLED rather
than handed to oxfmt's engine at run time, for three reasons in
`packages/infra/blueprint/src/oxfmt-config.mjs` § WHY THE OPTIONS ARE MODELLED — chiefly that
`tree-checks` installs the workspace and does not build it, so a native formatter binding is a
dependency that job cannot load.

**A repo that does not use oxfmt excludes the sidecar from its formatter, and this ADR does not
model that formatter.** Two arrangements, both deliberate:

- **Biome** (`PixelRPG/map-editor`): Biome owns `files.includes`, and its settings are not this
  model's — MEASURED in that repo's own `biome.json`: `indentWidth: 2` and
  `semicolons: "asNeeded"` where oxfmt's flag would say `semi`, so an oxfmt-modelled
  sidecar is a Biome-unformatted one. A `.d.blp.ts` is not TypeScript *source* — nothing authors
  it, nothing imports it as a module — so the repo excludes it: `"!**/*.d.blp.ts"`. Note that the
  `"!**/*.blp"` that repo already carries does NOT cover it: a sidecar ends in `.ts`. The file is
  still typed by `tsc`, still held by `check-blueprint-sidecars.mjs`; only the formatter stops
  holding it.
- **No `.oxfmtrc` anywhere**: `emitFormatForTree` answers oxfmt's OWN defaults. It does not answer
  the last repository's values — that constant is the bug this section exists to remove.

### 7. The browser target is named, not built

`build()`'s signature is a `Gtk.Builder` plus typed objects, which `adwaita-web` cannot produce. The
shape it would implement is the `?shared-tree` exit of ADR 0070 mounted and then indexed by id, and
the signature here is deliberately compatible with that — `build()` takes no arguments and returns
objects keyed by id. Nothing in this ADR implements it, and no `--app browser` consumer asks yet.

## Consequences

- Renaming an id in a `.blp` now breaks the type-check of its consumers instead of returning
  `null` at run time. That is the whole point, and it is a BREAKING change for a file whose
  consumer is migrated — by design, and only on migration.
- Two committed artifacts per migrated `.blp` instead of one. Bounded by the drift check above.
- The generated module gains static `gi://` imports it did not have. On `--app gjs` these are the
  ordinary spelling (ADR 0085 lowers them with every other static `gi://` import); on `--app node`
  they route through node-gi, as every showcase's own `gi://` imports already do.
- **Menus are included; extern types are a declared gap.** Measured: a top-level `menu foo { }`
  and a named `section bar { }` inside it both come back from `get_object` as a `GMenu`, so both
  are exported as `Gio.Menu`. A `$Name` extern type names no GIR type by construction — ADR 0053's
  `TypeRef.extern` says why — so its id is typed `GObject.Object` and narrowing it stays the
  caller's.
- **The emitter asks the project how it formats, instead of assuming this repository's answer.**
  That assumption is what § 6 replaces: `printWidth` was read out of `.oxfmtrc.json` into a
  constant — with a comment saying so — and a FOUR-SPACE indent was hardcoded beside it. Both are
  this repository's values, so every committed sidecar and every `oxfmt --check` run here agreed
  and the emitter looked correct. MEASURED in three `tabWidth: 2` consumers (kurier, Learn6502,
  troedler): a sidecar the formatter reflowed on sight, and `gjsify format --check` red on a file
  nobody hand-wrote. The emitter could not find out, because the only formatter it had ever met was
  the one its constants were copied from. The cost of asking is one required argument at four call
  sites; the cost of assuming was a red gate in someone else's repository.
- **A repo whose formatter is not oxfmt excludes the sidecar rather than being modelled.** The
  model is oxfmt's option set, and a second formatter's option set would be a second model to hold
  exact; § 6 names the Biome exclusion instead. A repo that wants its sidecar FORMATTED by Biome
  gets that by not excluding it, and the emitter's bytes are then a suggestion Biome may reflow —
  which the drift gate would catch on the next run.
- **A `.blp` whose ids cannot be NAMES is refused, and that is a construct the GNOME compiler
  accepts.** Three of them: an id of `builder`, which the key `build()` returns beside the ids
  would collide with; two objects with one id, which `build()` could only return once; and two
  internal children whose MEMBERS coincide — the distinct ids `a-b` and `a_b` both install
  `_a_b`, since § 3's transform replaces dashes. Measured: the parser takes all three and the XML
  emitter writes them through, because GtkBuilder's own answer is last-one-wins at run time. The
  emitted text has no such tolerance (TS2300 twice over, and an object literal that silently
  drops all but the last), so the refusal is here, at the `.blp`'s own line, rather than as a
  `tsc` error inside a generated file. ADR 0053 clause 3 is the shape: an error naming the file
  and the line, never a silent pass-through.
- No `.blp` is ADDED to the tree by this change, and that is deliberate: a new `.blp` obliges a
  reference-compiler golden, a `CORPUS_REAL_FILES` row, ADR 0053's census table and every stated
  corpus count. The builder exit therefore has no in-repo runtime consumer yet — its generated
  module is asserted as text, the way every other assertion in `plugin.spec.ts` is, and the
  template exit is what the migrated showcase proves at run time on GJS and on Node.

## Implementation

- `packages/infra/blueprint/src/typed-exports.mjs` — `deriveExports` (AST → ids, types, template,
  namespace versions) and `emitTypedSidecar` (the `.d.blp.ts` text). In this package because it has
  NO build step, which is what lets the drift check and the CLI reach it after a bare install.
- `packages/infra/vite-plugin-blueprint` — the named exports in the generated module, and sidecar
  writing during `load`.
- `packages/infra/cli` — `gjsify blueprint types [paths..] [--check]`.
- `packages/infra/blueprint/src/oxfmt-config.mjs` — the `.oxfmtrc` model (`emitFormatFor`,
  `parseOxfmtrc`), and `format-node.mjs` behind the `@gjsify/blueprint/oxfmt` subpath for the walk
  (`emitFormatForTree`), which is the only part of the contract that touches the filesystem.
- `scripts/check-blueprint-sidecars.mjs`, wired beside the other Blueprint gates in `main.yml`, and
  `scripts/check-blueprint-sidecar-format.mjs` beside it — the second is the other half of § 6: it
  runs the real oxfmt engine over the emitter's output under this repository's config and fourteen
  others (including kurier and Learn6502's `tabWidth: 2`), so a modelled rule the formatter
  disagrees with is a red gate rather than a silent drift.
- `showcases/gtk/adw-blueprint-layout` — migrated to the template exports.
