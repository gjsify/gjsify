# 70. A `.blp` reaches a non-GTK renderer through a second SPECIFIER, and a lossy one is refused

- Status: **Accepted** (2026-09-22)
- Date: 2026-09-22
- Deciders: Pascal Garber
- Related: [ADR 0027 (GTK host layer)](0027-gtk-host-layer.md),
  [ADR 0033 (declarative templates preferred)](0033-declarative-templates-preferred.md),
  [ADR 0034 (widget vocabulary convergence)](0034-widget-vocabulary-convergence.md),
  [ADR 0051 (one authored tree, rendered)](0051-one-authored-tree-rendered.md),
  [ADR 0053 (Blueprint parsed in-repo)](0053-blueprint-parsed-in-repo.md),
  [ADR 0066 (`template` and `object-id`)](0066-composition-gets-a-spelling-template-and-object-id.md),
  [ADR 0067 (the translatable marking)](0067-the-translatable-marking-becomes-a-field.md)

## Context

ADR 0053 clause 1 made Blueprint a second READER of the node shape ADR 0051's renderers consume:
one AST, GtkBuilder XML out of one exit, a declared-lossy `SharedNode` projection out of the
other. ADRs 0066 and 0067 then grew the node until shipped files survived the projection —
`template`, `object-id`, the `_()` marking. And all three renderers ship a tree builder: PR #1726
for `gtk-host`, #1729 for the NativeScript port, #1733 for `adwaita-web`.

So every part existed and no `.blp` reached any renderer, because nothing carried the projection
across a build:

- `projectToSharedNode` was not on `@gjsify/blueprint`'s surface. `src/index.mjs` said why, in as
  many words: *"Nothing outside this repository asks for it … Exporting it would promise a shape
  whose whole point is that it drops things, to consumers that have not asked."*
- `@gjsify/vite-plugin-blueprint`'s `load()` emitted `export default "<GtkBuilder XML>"` and
  nothing else, on every target that registered it.
- `app/nativescript.ts` did not register it at all: *"NO blueprintPlugin — Blueprint is a
  GTK-specific UI DSL."*
- `app/browser.ts` DID register it, and had since it registered anything, where it emitted an XML
  string a browser has no `Gtk.Builder` to parse. Bytes in every browser bundle, read by nothing.

### How the numbers here were obtained

Read every count as a DATE, not as a constant, and re-derive rather than reconcile. Taken on this
working checkout at `95198adaf6`, with `blueprint-compiler` 0.20.4 as the oracle and the `@girs`
5.4.0 pins the package declares. The corpus figures are what `node scripts/check-blueprint-corpus.mjs`
prints; the per-file ones are `projectToSharedNode` over the twelve entries of
`corpus/real-expectations.mjs`, with the same `gtypeName` seam the gate hands in.

| | measured |
|---|---:|
| shipped `.blp` that project with NO loss | 6 of 12 |
| corpus files that project with no loss | 25 of 68 |
| losses the projection takes, corpus-wide | 125 |

All three are unchanged from ADR 0067's "after" column: the corpus has not moved since, and these
are a re-derivation rather than a new reading.

### What a real `.blp` authors that the shared corpus never did

ADR 0051's corpus is seven blocks in `scripts/adwaita-gallery-shared-trees.mjs`, and they author
**zero `slot`s**. `showcases/gtk/effect-adw-services/src/window.blp` — fourteen nodes — authors
**seven**: `content:` twice, `[top]`, `title-widget:`, and the bracket-free single children.

That matters because `slot` is on the node shape and **no tree builder reads it**. All three read
`tag`, `props` and `children` and nothing else, which nothing noticed while the only source of
trees authored none. A `.blp` is the first source that authors placement, and the cost is measured
in § 7 rather than described.

### What the NativeScript port can spell

The `xmlns` barrels resolve a tag through `namespace/adw.ts` / `namespace/gtk.ts`, and a member
they do not have is a refusal in `elementFor`. Over the six lossless shipped files: **0 of 6** have
every tag in the barrels. Every one roots at `AdwApplicationWindow`, which the Adw barrel has no
member for; two also name `GtkScrolledWindow` and one `GtkSeparator`.

### The failure this decision is really about

A template that is COMPLETE on GTK and quietly PARTIAL somewhere else is worse than a template
that is not shared, because the GTK build keeps saying it works. The projection already declares
what it drops — ADR 0053 clause 1 calls the losses *"named at the seam rather than discovered
downstream"* — so a build path that emitted the tree anyway would be spending that declaration to
produce exactly the defect it was written to prevent.

## Decision

**A `.blp` reaches a non-GTK renderer through a second SPECIFIER, `?shared-tree`, not through a
second build mode; a projection with declared losses is refused at build time; and what a target
needs BEYOND the wiring is named rather than left absent.**

### 1. The exit is chosen at the import site, not by the build target

`./x.blp` is GtkBuilder XML on every target, unchanged. `./x.blp?shared-tree` is the projected
node, on every target that registers the plugin.

The obvious wiring is the other one — an `emit: 'tree'` option set by the non-GTK app targets —
and it is wrong for the reason the whole idea of sharing a template rests on: it would make
`import Template from './x.blp'` a string on `--app gjs` and an object on `--app browser`. One
source, two meanings, chosen by a flag the file cannot see. A consumer would have no spelling for
"the XML, here" on a target whose default had been flipped, and the ambient `*.blp` declaration —
one shape per module pattern — could describe neither honestly.

Three properties follow, and each is worth more than the shorter spelling:

- **The GTK path cannot change.** A bare `.blp` never reaches `projectToSharedNode` at all, so
  "the XML exit did not move" is a fact about reachable code rather than about a default value
  somebody could flip. ADR 0066 § The XML exit does not move made that checkable at the emitter;
  this keeps it checkable one layer out.
- **The refusal in § 2 cannot break a build that did not ask for a tree.** A lossy `.blp` keeps
  compiling to XML exactly as today.
- **Every app target registers one plugin with no options.** There is no target-to-mode table to
  keep in step with the list of targets — which is the drift the `NO blueprintPlugin` comment was
  one half of.

### 2. A declared loss is a build failure, and the failure is the porting task

`BlueprintProjectionError`, thrown from the plugin, carrying the file and every loss by kind and
line:

    templates/gtk-minimal/src/main-window.blp cannot be used as a shared tree: its projection
    drops 1 construct(s) the node shape has no spelling for.
      styles at templates/gtk-minimal/src/main-window.blp:22
    The GtkBuilder-XML exit of the same file is unaffected — import it without `?shared-tree` to
    build it for GTK. To share it, replace the constructs above with ones the shared node
    carries, or render this surface from its own tree.

Declared where it is THROWN and not in `@gjsify/blueprint`, and that division is deliberate: the
parser reads such a file correctly and the projection hands back a tree plus its cost. Deciding
that such a tree may not reach a renderer is the BUILD's decision, and the two error classes the
parser owns stay facts about the language.

### 3. `projectToSharedNode` goes on the surface, and the old justification travels with it

The argument for keeping it internal is quoted in `src/index.mjs` under its own heading, above the
two things that have since paid it off: a consumer exists, and the dropping is no longer silent.
Neither half was refuted, and that is the point of quoting rather than deleting. **A justification
goes stale with its technique, and one left standing beside the thing it no longer describes reads
as a decision nobody has revisited** — this repository has paid for that shape often enough to
treat carrying the old reasoning forward as part of the change rather than as courtesy.

The gate keeps reaching `src/project.mjs` by PATH as well, and that is not redundancy: stage D of
`check-blueprint-corpus.mjs` must be able to report "the file is missing", which a specifier
resolved through `exports` cannot.

### 4. `SharedNode` stays in `@gjsify/blueprint` — ADR 0067's open question, answered

ADR 0067 § What this does not decide left *"Where `SharedNode` lives … still forced by the first
PR that publishes a package producing the projection"*. This is that PR, and the answer is: where
it already is, restated and machine-held, for the two reasons `src/shared-node.d.mts` records.
`@gjsify/blueprint` is tier 1 and `@gjsify/adwaita-core` is tier 2, so the import ADR 0003 would
have to allow runs the wrong way; and this package has no build step on purpose, while
`adwaita-core` publishes its types from build OUTPUT that the `tree-checks` job does not produce.
Publishing the projection changes neither, so the restatement stands and
`scripts/check-shared-tree-shape.mjs` keeps holding it field by field.

What DOES change is that the restatement is now public. `SharedNode` is assignable to
`SharedTreeNode` — mutable to readonly, in that direction only — which is the property that lets
`import tree from './x.blp?shared-tree'` be handed to `mountSharedTree` with no cast, and it is
asserted by the acceptance suite rather than asserted here.

### 5. The plugin is registered on `nativescript`, and the retired comment is quoted where it stood

`NO blueprintPlugin — Blueprint is a GTK-specific UI DSL` was true of the only exit the plugin
had: an XML string no NativeScript runtime can load. It was never true of the NOTATION. The
replacement says both, in the file, so the next reader of that plugin list does not have to
re-derive why the line changed.

`browser` keeps its registration for a reason worth stating: a `--app browser` build of a GJS
app's sources must not start failing on an import that used to resolve. Both exits sit side by
side there, and an unused one is dropped by the bundler.

`gjs` and `node` are unchanged. `--app node` serves the node-gi reverse bridge — REAL GTK on Node
— so XML is the exit it wants; `?shared-tree` remains available there because the exit is chosen
by the specifier, which is § 1 paying for itself.

### 6. A query specifier is not a file to fork, and the platform chain stands down on one

Found by building the new exit for `--app nativescript`, and fixed at the source rather than
worked around: `platformResolvePlugin` appends its suffix to the WHOLE specifier, so
`./window.blp?shared-tree` was probed as `./window.blp?shared-tree.native`. A missed probe is
normally free — `this.resolve` returns null and the chain walks on — and with a query in the
specifier it is not: the miss surfaced as `UNLOADABLE_DEPENDENCY … No such file or directory
(os error 2)` against the ORIGINAL import, and the plugin that would have resolved it was never
asked. So the plugin now stands down on any specifier carrying a `?`: a query names a transform
of ONE file, owned by the plugin serving it, and there is no second file for a platform chain to
prefer. `platform-resolve.spec.ts` pins it on both chains, and the assertion is that NOTHING was
probed — a probe that happens is the defect.

### 7. What a target needs beyond the wiring is NAMED, with its measurement

Two things, and neither is a wiring defect:

- **`slot` has no reader.** A `.blp` renders on `adwaita-web` — measured, in a browser, in
  `packages/web/adwaita-web/src/blueprint-tree.spec.ts`: ten of fourteen nodes land exactly as
  authored, every custom element upgrades, every caption under the unnamed slot reaches the
  screen. The header bar authored `[top]` lands in the toolbar view's CONTENT instead, and the
  `title-widget:` window title is then discarded by `adw-header-bar`'s own build, taking both its
  `_()` captions out of the document. Two `it.failing` cases hold that, so it retires itself the
  day placement lands.
- **The NativeScript barrels cannot spell a window.** 0 of 6, § What the NativeScript port can
  spell. The build seam is wired and MEASURED — a `--app nativescript` bundle of a shipped
  `.blp?shared-tree` builds and carries the projected tree, root tag and composite class intact —
  so what is missing is widget coverage in that port, which is ADR 0034's ledger and not this
  decision's.

Naming them here rather than fixing them is the scope brake, and the reason is in § Alternatives
rejected: a slot READER is a shared-vocabulary decision, and taking it inside one renderer is the
translator ADR 0051 turned down. § 6 is the opposite case and is why the two are not one rule —
that one was a defect in this repository's own build, exposed by this change, so it is fixed here.

## Consequences

- A `.blp` is, for the first time, a source of trees for more than one renderer. What ADR 0027 § 9
  calls the build-from-one-source horizon is no longer only reachable — one lane of it is open.
- `@gjsify/blueprint` gains a published export whose contract includes a warning: read `lost`
  before the tree. The barrel says so and the type says so.
- `@gjsify/vite-plugin-blueprint` gains a `resolveId` hook, which it had no need of before: the
  default resolver stats the specifier and no file is named `x.blp?shared-tree`.
- The `slot` field stops being decoration. It was carried by three restatements and read by
  nothing, which nothing could see while the only trees in existence authored none; now a failing
  case names what it costs, on a real interface.
- `adwaita-web` acquires two devDependencies (`@gjsify/blueprint`, `@gjsify/vite-plugin-blueprint`)
  and a `src/globals.d.ts`, because its `tsconfig.json` sets `"types": []` and an ambient module
  pattern reaches a project only by an explicit reference.

## Alternatives rejected

- **An `emit` mode on the plugin, set per app target.** § 1. Shorter to write, and it makes one
  import mean two things depending on a flag the source cannot see.
- **Two named exports from one module** — `export default "<xml>"` beside `export const tree`.
  Closer, and it fails on the refusal: emitting both always means a lossy `.blp` either fails for
  GTK consumers who never asked for a tree, or is emitted with its losses swallowed. A
  per-importer decision is not expressible in a `load()` hook, and a query specifier is.
- **Refuse `slot` in the plugin, the way `bind` is refused.** `slot` is 12 of 12 on the shipped
  files, so this would refuse every real template and ship a feature that serves nothing. The
  field exists and is correct; what is missing is a reader.
- **Give `adwaita-web`'s builder a slot table now.** It is four entries for this one file and it
  is the per-surface translator ADR 0051 § Alternatives rejected refused on a measurement:
  `content:`/`[top]`/`title-widget:` are GtkBuilder's names, `""`/`top`/`center` are this
  renderer's, and a table inside one renderer is a mapping nothing holds. A `slotOf` beside
  `hostTagOf` in `@gjsify/adwaita-core/tags` — shared, gated, read by all three builders — is the
  shape that would be right, and it is a decision with its own evidence to bring.
- **Publish the projection from a new package.** A package with one implementation is an interface
  fitted to that implementation (ADR 0051 § Alternatives rejected, one level down), and § 4's two
  reasons for the current home are unaffected by who imports it.

## What this does not decide

- **The build-from-one-source horizon itself.** ADR 0051 Decision 6 and ADR 0053 § What this does
  not decide leave it open, and one lane is not the road: ADR 0027 § 9 asks for NativeScript and
  browser BUILDS generated from one native-authored source, and the two gaps in § 7 are between
  here and there.
- **Which notation the shared corpus is authored in.** ADR 0051 Decision 1 stands. This adds a
  second front door, exactly as ADR 0053 clause 1 did, and proposes no move.
- **Whether `slot` gets a shared vocabulary**, or what its entries would be. § 7 measures the gap
  and § Alternatives rejected says why the answer is not a renderer-local table.
- **Whether the NativeScript port grows a window class.** ADR 0034's ledger owns the vocabulary;
  what is settled here is only that the build no longer stands between the port and a `.blp`.
- **`bind` and `breakpoint`.** ADR 0066 § 3's reasons stand unchanged, and § 2 now makes them a
  build failure for a shared tree rather than a silent omission.
- **Whether `.blp` becomes an EMITTED dialect of the corpus.** ADR 0053 left this independent and
  it stays so.

## Implementation

Three changes, in the only order that works, plus the proof:

| # | change | what goes red if it is wrong |
|---|---|---|
| 1 | `projectToSharedNode` on the barrel and on `index.d.mts`, with `ProjectOptions` and the projection types beside it; the old justification quoted and answered. | `surface.conformance.mts`'s exact-surface assertion; `check-blueprint-corpus.mjs`'s runtime name list |
| 2 | `?shared-tree` in the plugin — `resolveId` to carry the query, `load` to project, `BlueprintProjectionError` on any declared loss; a second ambient module pattern. | the plugin suite: both exits on one lossless file, the refusal on one lossy file with every loss in the message, the XML exit still byte-equal to the oracle's golden |
| 3 | `blueprintPlugin()` on the `nativescript` target; the retired comment quoted where it stood; `platformResolvePlugin` stands down on a query specifier. | the platform-resolve suite's query row, on both chains — and, before it existed, every `--app nativescript` build of a `?shared-tree` import |
| 4 | `blueprint-tree.spec.ts` in `adwaita-web`: a shipped, lossless `.blp` mounted in a browser, with two `it.failing` cases for the slot gap. | a node that stops arriving; a caption that stops rendering; and, the day `slot` gets a reader, the two failing cases themselves |

Follow-ups are tracked in `status/open-todos.md` per governance; this ADR records the *why*.
