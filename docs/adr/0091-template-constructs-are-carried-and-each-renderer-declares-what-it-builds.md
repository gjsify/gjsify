# 91. Template constructs are carried as fields, and each renderer declares which it builds or refuses

- Status: **Proposed**
- Date: 2026-10-04
- Deciders: Pascal Garber
- Related: [ADR 0042 (portable menu model)](0042-portable-menu-model.md),
  [ADR 0051 (one authored tree, rendered)](0051-one-authored-tree-rendered.md),
  [ADR 0053 (Blueprint parsed in-repo)](0053-blueprint-parsed-in-repo.md),
  [ADR 0058 (the translatable marking gets a spelling)](0058-translatable-marking-gets-a-spelling.md),
  [ADR 0066 (`template` and `object-id`)](0066-composition-gets-a-spelling-template-and-object-id.md),
  [ADR 0069 (accessibility is a grouped prop)](0069-accessibility-is-a-grouped-prop-relations-are-a-gap.md),
  [ADR 0070 (a second specifier)](0070-a-blp-reaches-a-renderer-through-a-second-specifier.md),
  [ADR 0071 (a slot is a placement)](0071-a-slot-is-a-placement-a-renderer-answers-to.md),
  [ADR 0072 (typed `extensions`)](0072-value-lists-become-a-typed-extensions-field.md),
  [ADR 0088 (typed ids)](0088-a-blp-exports-its-ids-as-typed-names.md),
  [ADR 0090 (`layout`)](0090-layout-placement-becomes-a-node-field.md)
- Supersedes (the named clauses only, not the ADRs): ADR 0053 clause 3 for `breakpoint`; ADR 0058
  § 6; ADR 0066 § 3 for `bind` and `breakpoint`; ADR 0070 § 2 as a GLOBAL rule; ADR 0072 § 3.
  ADR 0090 stands: it is the first instance of the rule this ADR states.

## Context

Every ADR since 0053 handled a Blueprint construct the same way: refuse it for ALL renderers until
a consumer needs it, then give it a field, then make each renderer build it or refuse it by name.
ADR 0066 § 3 states the test — "a field lands when a consumer needs it and not before" — and
refused `bind` and `breakpoint` because exactly one surface, GtkBuilder, had a use for them.

That test now passes. Learn6502 (`easy6502/packages/app-gnome/src`, a few dozen `.blp`) is a GNOME
app, a web app and an Android app, and its goal is ONE `.blp` rendered by GTK, `adwaita-web` and
`adwaita-nativescript`. The files use, beyond what the projection carries today:

- `bind template.x` and `bind someId.x` on properties, one of them `bidirectional`;
- `toggled => $_onX()` signal handlers;
- `$SourceView id { }` — app-registered classes as children, beside `template $Name : Adw.Bin`;
- `accessibility { label: _("…"); }`;
- a root `menu name { … }` referenced by `menu-model:`;
- three `Adw.Breakpoint { condition (…) setters { … } }` that switch a view stack between a one-
  and a three-column layout. On an Android tablet the three-column layout is the point.

The refusals were never judgements that a renderer COULD not do these. Each renderer has most of
the machinery already: `adwaita-core` has the full `AdwBreakpointBin` state machine, with
libadwaita's last-match-wins and restore rules; the web has `addBreakpoints`; the NativeScript port
has `addBreakpoints` and a GJS-shaped `connect(name, cb)` on every widget (ADR 0034 § Amendment 15);
the portable menu value of ADR 0042 exists on both. What was missing was a way to say "this
renderer does this" without every other renderer being forced to do it too.

### What the projection declares today

The kinds `projectToSharedNode` returns in `lost` (`packages/infra/blueprint/src/project.mjs`),
grouped by what this ADR decides:

| loss kind | construct | decided here |
|---|---|---|
| `binding` | `prop: bind …`, `expr …` | simple forms carried as `bindings`; expression forms stay a loss |
| `signal` | `name => $handler() flags` | carried as `signals` |
| `breakpoint` | `[breakpoint] Adw.Breakpoint { … }` | carried as `breakpoints` on the parent |
| `extern` | `$Name` as a type, `template $Name` with no GIR parent | carried as `extern` |
| `accessibility` | `accessibility { … }` | carried as `accessibility` |
| `menu` | root `menu id { }`, an inline menu value | shape in its own ADR; field name fixed here |
| `sibling-object` | a second widget root in the file | carried as `siblings` |
| `internal-child` | `[internal-child name]` | carried as `internalChild` |
| `action-widget` | `[action response=…]` | carried as `actionResponse` |
| `value-list` | `widgets [ ]` (object references) | carried as `extensions.widgets` |
| `items`, `marks`, `offsets`, `mime-types`, `patterns`, `suffixes` | the other list/block extensions | carried as `extensions.<name>` |
| `inline-template` | a nested `template { }` document | stays a loss (deferred) |
| `translation-domain` | file-level gettext domain | stays a loss |
| `comment` | never produced | — |

`_()` is no loss since ADR 0067, `styles` none since 0068, `responses` and string lists none since
0072, `layout` none since 0090. They belong in the table below because their refusals are
renderer-local already, in prose.

### The refusal already is per-renderer, and nothing says so

ADR 0090 writes the shape: the projection carries `layout`; `adwaita-nativescript` builds it;
`adwaita-web` and `gtk-host` refuse it by name. ADR 0072 did the same for `extensions`. Those are
three renderers each answering for itself — while ADR 0070 § 2 still says the build refuses any
tree with a declared loss. The two rules coexist because a carried field is not a loss. This ADR
makes the per-renderer rule the rule, so that carrying a construct and refusing it somewhere stop
being two mechanisms.

## Decision

**The projection carries every construct it can spell as a field. A construct is a loss only when
it is genuinely out of reach of every renderer. Each renderer declares, in a table, which carried
constructs it builds; a tree that uses one it refuses fails for THAT renderer, naming the construct
and where it is — and a renderer that cannot build something keeps today's refusal and its own
template engine.**

### 1. Fields, one per construct

All optional, in source order, spelled as the source wrote them (ADR 0090's rule: values are not
resolved through the widget).

```ts
bindings?: Record<string /* target property */, {
    source: string;               // an object id, or the literal 'template' for the component itself
    property: string;             // a single property name; no lookup chain
    flags?: ('bidirectional' | 'inverted' | 'no-sync-create')[];
}>;
signals?: { name: string; detail?: string; handler: string; object?: string;
            flags?: ('swapped' | 'after')[] }[];
breakpoints?: { condition: string;
                setters: { object: string; property: string;
                           value: string | number | boolean;
                           translatable?: { context?: string } }[] }[];
extern?: true;                    // `tag` is a class the application registers, not a GIR class
accessibility?: …;                // shape fixed in its PR; constraints below
internalChild?: string;
actionResponse?: { response: string; default?: boolean };
```

`siblings?` and `menus?` sit on the projection result beside `node`, keyed by id, because a second
root is not a child of the first. `menu-model: id` and any id-valued property stay scalar props,
resolved by the builder as references, as the NativeScript builder already does for
`builderReferences`.

Four rules that apply to all of them:

- **`breakpoints` lives on the PARENT, not as a child.** `Adw.Breakpoint` is not a widget (ADR 0066
  § 3 said so). Keeping `children` widgets-only is what lets every existing `children` reader stay
  correct.
- **`accessibility` is its own field, never folded into `props`.** A name in the block collides
  with a widget property of the same name (ADR 0090, ADR 0072 on `layout`). The `_()` marking
  travels beside each value; a relation (`labelled-by`) carries the ids it names.
- **A signal handler is a name, never code.** The tree carries `_onFollowToggled`; the builder
  resolves it against a scope object it is handed (§ 3), as `Gtk.BuilderScope` does.
- **`bind` is the simple form only.** One source (an id or `template`), one property, the flags.
  A lookup chain, a closure `$fn(…)`, a cast, `try`, `expr`, or a binding with no single source
  stays the loss `binding-expression` — on EVERY renderer, and GTK's XML exit still builds it.
  ADR 0066 § 3's reason holds for these: a field would be a second implementation of a grammar.

### 2. Refusal moves from one global rule to a per-renderer capability table

Each renderer package exports, from a pure-data `./capabilities` subpath, a TOTAL table over the
construct kinds:

```ts
export const capabilities: Readonly<Record<ConstructKind, 'implemented' | { refused: string }>>;
```

`ConstructKind` is the loss-kind vocabulary plus `layout`, `strings` and `responses`, so the three
refusals that exist in prose today become rows. The projection returns `uses: { kind, line }[]`
beside `lost`: every occurrence of a carried construct, by kind and line.

Two places check a tree against the table, with one function shared from `adwaita-core`:

- **At build time, when the importer names its renderer:** `import tree from
  './x.blp?shared-tree&for=adwaita-nativescript'`. The plugin resolves the renderer's
  `./capabilities` from the importer, intersects it with `uses`, and throws
  `BlueprintProjectionError` listing each refused construct with the file and line:

      main-window.blp cannot be rendered by adwaita-nativescript: 2 construct(s) it refuses.
        accessibility at main-window.blp:41 — NativeScript has no accessibility-reference door
        internal-child at main-window.blp:57 — no consumer; not built
      The GtkBuilder-XML exit of the same file is unaffected.

  `for=` follows ADR 0070 § 1: the exit and what it is checked against are chosen at the import
  site, not by a build flag the file cannot see. A target does not determine a renderer (`--app
  gjs` hands a tree to `gtk-host` or to nothing), so the plugin cannot guess.
- **At build of the widget tree, always:** each `buildSharedTree` runs the same check before it
  creates anything. This is the net for an import without `for=`; it names the construct and the
  node (`AdwViewStack`, the path to it), since a tree carries no lines.

What a table row means: `'implemented'` — the renderer builds every form the projection can
produce for that kind, or refuses the form it cannot by name inside the builder (a half-built
construct is the silent drop ADR 0071 § 3 forbids). `{ refused }` — the reason is a sentence a
human can act on, and it is the text the error prints.

ADR 0070 § 2 stays, narrowed: a non-empty `lost` is still a build failure on every renderer. What
moves is that most of what `lost` held becomes `uses`.

### 3. What each renderer does with each construct

"GTK" is the XML exit through `Gtk.Builder`: it is the oracle and builds everything,
`binding-expression` and `translation-domain` included. `gtk-host` is the tree builder over the
host element model (ADR 0027), which is a different door and keeps its ADR 0072/0090 stance: a GTK
app loads the `.blp` through `Gtk.Builder`; the tree path refuses until a consumer needs it.

Cells: **native** (GTK itself), **port** (implemented by the renderer, with the mapping),
**refused** (with the reason). `UNVERIFIED` marks a mapping nobody has run; the implementing PR
verifies it or turns the cell into a refusal.

| construct | GTK | `gtk-host` | `adwaita-web` | `adwaita-nativescript` |
|---|---|---|---|---|
| `layout` (0090) | native | refused | refused | port |
| `strings`, `responses` (0072) | native | refused | port | port |
| `signal` | native | refused | port | port |
| `bind` (simple) | native | refused | port, UNVERIFIED | port, UNVERIFIED |
| `breakpoint` | native | refused | port | port, UNVERIFIED on a tablet |
| `extern` / `$Name` | native | refused | port | port |
| `accessibility` | native | port (0069) | port | refused until mapped |
| `menu` | native | refused | port (0042 value) | port (0042 value) |
| `sibling-object` | native | refused | port | port |
| `internal-child` | native | refused | refused | refused |
| `action-widget` | native | refused | refused | refused |
| `extensions.widgets`, `.items`, `.marks`, `.offsets`, file filters | native | refused | refused | refused |
| `binding-expression`, `inline-template`, `translation-domain` | native | loss | loss | loss |

The mapping behind each `port` cell:

- **`signal`.** Web: `addEventListener(name, e => scope[handler](e))`. A GTK signal name is not a
  DOM event name, so the element declares which GTK signals it dispatches, the way it declares
  `slots` (ADR 0071 § 3), and the builder refuses a signal the element does not declare, after
  mount, like a slot. NativeScript: `connect(name, cb)`, the GJS-shaped door that
  `withSignals` already gives each widget; a signal a class does not emit is refused by name before
  the write. `swapped`, `after` and `object:` are refused by name until each is verified — the
  first slice is plain handlers. The handler comes from the scope object: the instance of the
  registered template class when the tree has a `template`, else a `scope` option on the builder.
  A missing handler is a refusal, as GtkBuilder refuses it.
- **`bind`.** Target tracks source; `sync-create` is the default, as in GTK. Web: the source
  element must be observable, by a `notify`-style event it dispatches or by a reflected attribute
  (`MutationObserver`); one that is neither is refused by name. Writes use the same prop writer the
  builder already uses (§ the `false` rule in `buildSharedTree`). NativeScript: a port property
  registered through `Property` emits change events; a plain accessor does not, and that source is
  refused by name. Whether the port's properties split that way is UNVERIFIED and is the first thing
  the implementing PR measures. `bind template.x` reads the template instance, so it depends on
  `extern`. `bidirectional` needs both ends observable; `inverted` is boolean negation.
- **`breakpoint`.** Both renderers feed `adwaita-core`'s `AdwBreakpointBin`, which owns the
  libadwaita semantics (last match wins, restore of values captured at registration, no restore of
  a property the incoming breakpoint sets again). The builder resolves each setter's `object` to
  the node built for that id, and the property write is the builder's ordinary prop write. Web:
  `addBreakpoints` off a `ResizeObserver` of the host. NativeScript: `addBreakpoints` off the bound
  view's post-layout size. The port's own header says it cannot observe the window; binding it to
  the root view of an Android tablet window is UNVERIFIED, and it is the claim this whole ADR is
  worth checking on a device. A setter on a property the target does not declare is refused before
  any breakpoint runs, as an unknown attribute already is.
- **`extern`.** Each renderer has its own `registerTemplateClass(name, ctor)`, taking the name as
  the `.blp` spells it (`SourceView` for `$SourceView`). The stored thing is renderer-specific — a
  `View` constructor on NativeScript, a custom-element class on the web, a registered GType for
  `gtk-host` — so there is no shared registry in `adwaita-core`. On the web the registry also
  answers which tag the class is defined under, because a one-word name (`Display`) is not a valid
  custom-element name and a case rule cannot invent one. An unregistered name is a refusal naming
  it. The registered class builds its own internals, typically from its own `.blp?shared-tree`;
  that is how `$ThemeModeSelector` and `template $MainButton : Adw.Bin` already work on GTK.
- **`accessibility`.** Web: `aria-*`, with GTK's property names mapped to ARIA's by a table
  generated from the same source as `gtk-host`'s `generated/accessibility.ts` (ADR 0069), not
  written by hand; a relation maps to `aria-labelledby`/`aria-describedby` over the ids. `gtk-host`:
  its existing `accessibility` route. NativeScript: `accessibilityLabel` and `accessibilityHint`
  exist on a `View`; whether the rest has a door is UNVERIFIED, and until a PR maps a property it
  is refused by name, so the row stays `refused` for now.
- **`menu`, `sibling-object`.** Value objects and menus are built once, registered by id, and
  referenced by any id-valued property — the NativeScript builder's `builderReferences`
  machinery, extended to siblings. Web and NativeScript take a menu as the ADR 0042 portable
  value. The item shape (`label`, `action`, `target`, sections, submenus) is its own decision and
  its own ADR, because the existing field shapes are flat and a menu is a tree.

`internal-child`, `action-widget` and the list extensions are carried and refused everywhere
except GTK. They name GTK-specific parent mechanisms (`GtkDialog` action areas, a combo's items)
with no widget on web or NativeScript that consumes them. Carrying them still pays: the refusal
reads "this renderer has no `[action]` door" instead of "this file has a loss".

Why `binding-expression`, `inline-template` and `translation-domain` stay losses, each for its own
reason: **expressions** are a language, not a spelling; **`inline-template`** is a second document
with its own id scope, which a flattened tree would corrupt (the reason `project.mjs` already
gives), and a renderer needs a factory concept (a cloned `<template>`, an `itemTemplate`) that is
its own decision; **`translation-domain`** is a fact about the loader, not a node, and no renderer
here translates against a catalog. The first and third are the only constructs that stay GTK-only;
the second is deferred, not GTK-only.

### 4. The conformance story: a claim needs a test, a refusal needs a test

Two vocabularies, restated and held by `check-shared-tree-shape.mjs` as `SharedTreeNode` is: the
construct kinds, and the new fields. A fourth spelling nobody declared fails the sweep.

`check-blueprint-corpus.mjs` stage D gains one arm per new field, compared with the oracle's golden
as the layout and extensions arms are: `<signal name handler swapped after object>`, a binding's
source/property/flags, `<setter object property>` under the breakpoint's `<condition>`,
`<accessibility>`, `<menu>`. The golden is the denominator for `uses` too: the number of `<signal>`
elements in a golden equals the signal uses the projection reports. The corpus files that declared
these losses declare none; the digest in `check-blueprint-corpus-counts.mjs` moves with them.

`@gjsify/adwaita-core/conformance` gains `CONSTRUCT_VECTORS`: per kind, a `.blp` source and what
each renderer's realised tree must show (the shape of `VALUE_LIST_VECTORS`). A shared helper,
`driveConstructVectors(renderer)`, runs inside each renderer's tree driver and enforces both
directions:

- every kind the renderer declares `implemented` has at least one vector, and the vector's
  observable holds in the realised tree — a claim with no test fails;
- every kind declared `{ refused }` is built through the real builder and must THROW an error
  naming the kind — a CONTROL, as ADR 0071 § 5 uses one. A renderer that gains a door and forgets
  to flip its row fails here, so a refusal retires itself the way an `it.failing` does;
- a table that lacks a kind fails, so a new construct cannot arrive at a renderer unclaimed.

A new `scripts/check-construct-capabilities.mjs` holds what the helper cannot see from inside one
suite: that each renderer's spec actually calls it, and that the table's key set equals the shared
vocabulary for plain-JS consumers that bypass the type.

### 5. Implementation order

One large PR with a commit per step (the repo's rule), because steps 2–5 are what Learn6502 needs
and share their machinery:

1. **The mechanism, behaviour unchanged.** The vocabulary, `uses`, `./capabilities` on the three
   renderers (rows for `layout`, `strings`, `responses` only, all matching what they do today),
   `for=`, the builder pre-check, `CONSTRUCT_VECTORS`, the gate. ADR 0090 is the proof that it
   changes nothing. Pointer notes land in ADRs 0053, 0058, 0066, 0070 and 0072 at the clauses
   this one supersedes.
2. **`extern` and `registerTemplateClass`.** Every later construct hangs from a template instance.
3. **`signal`**, plain handlers, with the `scope` option.
4. **`bind`**, simple form, ids and `template`. The first step where a cell is UNVERIFIED.
5. **`breakpoint`**, verified on the Android tablet before the row says `implemented`.

A second PR: `accessibility`, `sibling-object`, then `menu` after its own ADR. The refused-everywhere
group (`internal-child`, `action-widget`, the list extensions) is carried in the same PR: each
lands with its projection, its stage-D arm and a refusal row per renderer, and no builder. That
revises ADR 0058 § 2's "a field lands WITH its reader" for these kinds, on purpose: the oracle is
the reader, and the refusal is what a renderer does until it has a consumer.

Follow-up decisions, each its own ADR or amendment: the `bind` expression language; the menu item
shape; `inline-template` as a factory; a typed `Handlers` export in ADR 0088's sidecar, so a
handler a `.blp` names is checked against the component class by `tsc`.

## Consequences

- One `.blp` serves GTK, the web and NativeScript for the constructs in § 3. Learn6502's
  responsive layout is expressed once, through `Adw.Breakpoint`, instead of a hand-authored tree
  per renderer.
- A renderer that cannot build a construct still works for every file that does not use it, and
  fails the file that does, naming the construct. It keeps its own template engine for the rest.
- The projection grows by several optional fields; every restatement grows with it, held by
  `check-shared-tree-shape.mjs`. `lost` shrinks to the three losses of § 3, plus a list with a
  non-string item.
- The loss kind `binding` is renamed `binding-expression`, and `value-list` narrows to its
  non-string-item case. Corpus expectations move.
- The `./capabilities` subpaths are pure data, so the plugin can read one at build time without
  importing a renderer. The NativeScript one in particular must not reach `@nativescript/core`
  (the reachability rule in `packages/nativescript-bridge/AGENTS.md`).
- A tree's `uses` carry lines only to the build-time check. The runtime net names the node, not
  the line. That is a weaker message, accepted for the import that skipped `for=`.

## Alternatives rejected

- **Keep the global refusal and author a second tree per renderer.** What Learn6502 does today:
  two sources for one screen, which is the defect ADR 0051 exists to remove.
- **Translate constructs into each renderer's native dialect** (NativeScript `{{ }}` bindings,
  web `data-` wiring). ADR 0051 refuses a translator between vocabularies on a measurement, and a
  translator would hide the cases it cannot translate.
- **A "lenient" mode that ignores what a renderer cannot build.** A tab bar that never collapses
  and a signal that never fires both look finished; ADR 0071 § 3 and ADR 0072 refuse the silent
  drop for exactly that.
- **Runtime-only checking.** It reports after the app is built and shipped. Kept as the net, not
  as the mechanism.
- **Deriving capabilities by trying to build and catching the throw.** The table has to be
  declarative to be machine-checked; a probe would make every throw a capability claim.
- **`Adw.Breakpoint` as a child node.** It is not a widget, and every reader of `children` would
  have to learn to skip it.
- **One template-class registry in `adwaita-core`.** The stored value differs per renderer, and a
  shared registry would be a type parameter nobody reads.
- **Carrying bind expressions as JavaScript closures now.** A second implementation of GtkBuilder's
  expression grammar, with its type rules, for a handful of uses; the simple form covers the
  consumer.

## What this does not decide

- **The `bind` expression language**, in any form beyond a single id-or-`template` source and one
  property. They stay refused on every non-GTK renderer.
- **The menu item shape**, the `inline-template` factory, and the field shape of `accessibility`
  beyond the constraints in § 1.
- **Whether the web renderer gains `layout` through CSS grid**, which would flip a cell of ADR
  0090's table.
- **Whether the build-time check should require `for=`.** Recommended optional; the runtime net
  keeps the unchecked path safe either way.
- **i18n against a gettext catalog** on web or NativeScript. `translation-domain` is a loss until
  a renderer translates.
- **iOS.** The NativeScript cells above were reasoned for the Android path; iOS is unverified
  (issue #1051 for icons) and inherits every UNVERIFIED mark.
- **Hot reload and live re-projection** of a changed `.blp`.

## Implementation

Tracked in `status/open-todos/README.md`; this ADR records the *why*. Order and proof, per § 5:

| # | change | what goes red if it is wrong |
|---|---|---|
| 1 | vocabulary, `uses`, `./capabilities`, `for=`, builder pre-check, `CONSTRUCT_VECTORS`, gate | the shape gate; a missing row; a vector with no claim; a refusal that no longer throws |
| 2 | `extern` field and `registerTemplateClass` on three renderers | the stage-D addressing arm; a refused unregistered name |
| 3 | `signals` | the stage-D `<signal>` arm; a handler the scope lacks |
| 4 | `bindings` | the stage-D binding arm; an unobservable source |
| 5 | `breakpoints` | the stage-D `<setter>` arm; a device run on a tablet that switches layout |
