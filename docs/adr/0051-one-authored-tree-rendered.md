# 51. One authored tree, rendered: ADR 0027 § 9's criterion becomes a suite

- Status: **Accepted** (2026-09-10) — amended, see § Amendment 1: the second driver is
  `adwaita-web` and not the NativeScript port, because the port has no widget an
  off-device suite can build. What was actually built is § What landed.
- Date: 2026-09-09
- Deciders: Pascal Garber
- Related: [ADR 0004 (headless Adwaita core)](0004-headless-adwaita-core.md), [ADR 0027 (GTK host layer)](0027-gtk-host-layer.md), [ADR 0028 (widget table provenance)](0028-widget-table-provenance.md), [ADR 0030 (one corpus, GJS as oracle)](0030-one-corpus-gjs-as-oracle.md), [ADR 0034 (widget vocabulary convergence)](0034-widget-vocabulary-convergence.md)

## Context

ADR 0027 § 9 makes one widget vocabulary a goal and states the one thing that would
turn it into a decision:

> the same authored tree, rendered through this host and through `adwaita-web`,
> satisfies the same `@gjsify/adwaita-core/conformance` vectors with no per-surface
> markup branch.

Until that is measured the goal is a direction. This ADR is about the rung that is
missing, and only about that rung.

### Three questions that keep being read as one

**Do the surfaces NAME the same widgets?** Held. `scripts/check-vocabulary-alignment.mjs`
is a step of the required `Detect runtime-triplet drift` job, reads every surface that
declares itself one, and prints the distance every run. ADR 0034 owns that half.

**Do the gallery's own sources DESCRIBE the same UI?** Held since
`scripts/adwaita-gallery-shared-trees.mjs`. Arm 11 of
`scripts/check-generated-website-data.mjs` derives the partition and prints it; run on
`origin/main` at `c8ae146b84`, 2026-09-09:

```
23 block(s) drawn by both renderers — 7 from one authored tree,
16 ledgered as divergent; 7 agree today
```

**Do the renderers BEHAVE the same on that tree?** Held by nothing. `status/open-todos.md`
already says it in the entry that census wrote: *"the shared source is compared as DATA
rather than as a rendered tree"*. Seven blocks are authored once, and nothing builds them.

### What already exists, so the remaining work is the driver and not the corpus

- **The corpus.** `ADWAITA_GALLERY_SHARED_TREES` — `{ tag, slot?, props?, children? }` nodes
  authored in **GIR class names**, which that file chose deliberately: it is the one
  spelling both renderers already carry (ADR 0034 clause 1), it is the `gtype` column of
  `gtk-host`'s generated table and it is the NativeScript widget's class name. Authoring in
  either renderer's markup spelling would make one of them the reference and the other a
  translation.
- **The single declared transform.** `hostTagOf` is `gtk-host`'s own `tagOf`
  (`packages/framework/gtk-host/src/tags.ts`), and arm 11 runs it against every row of that
  package's generated table, so it cannot drift into a private second spelling. One
  transform, not an alias table — both gallery generators refuse an alias table in their
  headers, and this ADR does not weaken that refusal.
- **Per-dialect emitters.** `gtkHostTree(widget)` and `nativeScriptTree(widget)`, in that
  same file.
- **The expectations.** `@gjsify/adwaita-core/conformance` — 32 vector tables, each citing
  the C function it derives from — and `scripts/check-adwaita-conformance-drivers.mjs`,
  which already refuses a table no renderer drives. Its header carries three incidents
  worth re-reading before extending it, all of the same shape: a prose claim of coverage is
  worse than no claim at all.
- **Renderer drivers, but per WIDGET.** 60 files under `packages/web/adwaita-web/src` and
  `packages/nativescript-bridge/adwaita/src` import those vectors today. Every one of them
  drives a table from that renderer's own spec, on a widget it constructs itself. None
  drives one from a tree neither renderer authored.

### The measurement that prices the second driver

Read over `packages/framework/gtk-host/src` at `c8ae146b84`:

| | |
|---|---|
| runtime `gi://` imports in `adapters/{solid,vue,react}.ts` | **none** |
| their entire toolkit coupling | `import type Gtk from '@girs/gtk-4.0'` — 15 type references, 12 of them `Gtk.Widget` |
| files carrying a runtime `gi://` import | 18, none of them an adapter |

`policies.ts` holds the literal `new Gtk.Box()` the Vue adapter used to own, and its own
header names what that was: *"the ONE runtime toolkit import and the ONE concrete widget
class in any adapter, i.e. exactly the widget knowledge ADR 0027 § 7 forbids one"*. The
claim is about the ADAPTERS and not about the package — nine other files here import
`gi://Gtk` at runtime, which is the point: the toolkit knowledge is concentrated where the
table is, and absent where the reconciliation is. So a second renderer behind the same ops
is a **parameterisation of the node type**, not a rewrite of the reconciliation.

That parameterisation has a precedent in this tree with three renderers already on it.
`packages/framework/storybook-core/src/story-view-base.ts` declares
`StoryViewBase<TNode>` and documents `TNode` as *"the renderer's view-node type
(`Gtk.Widget`, `HTMLElement`, …)"*, with exactly ONE abstract seam, `createChrome`. ADR
0004's headless core does the same one layer down: the derivation is renderer-free and each
renderer supplies the bridge. Neither was a rewrite of its consumers.

### What blocks going wide, stated so no stage below promises it

Most of the generated table has no measured placement rule. A widget outside the curated
set can be created, given properties and given handlers, and inserting a child into it
raises an error naming the tag that needs a policy. That is the honest state and not a
defect — guessing an adder is what `uncurated` exists to refuse, because `add`, `append`
and `set_child` all exist somewhere in GTK and calling the wrong one is a warning at exit
0. The split is derived by `tableProvenance()` and the backlog is
`status/open-todos.md`'s own entry; no figure is repeated here, because the one that entry
carried was already behind the table when it was read. Curating is driven by a real window
that needs one, with its vector, never by walking the table.

### One correction to § 9's own wording, made rather than inherited

§ 9 names `adwaita-web` as the second renderer. The corpus that actually exists pairs
`gtk-host` with the NativeScript port, because those are the two the gallery authors from
one source. The web surface's tree on a gallery block is its `preview` fence, authored per
block and derived from nothing. That is a gap in the corpus, not a reason to re-aim the
criterion, and it gets a stage of its own below.

## Decision

### 1. The criterion becomes a suite, and its corpus is the authored tree that already exists

No new authoring surface. `ADWAITA_GALLERY_SHARED_TREES` is the corpus; a block joins it
under the rule it already states — the same widget names, the same property names, the same
values, in the same order, needing no alias at all.

### 2. One corpus, two drivers — ADR 0030's shape, one level up

ADR 0030 settled that a claim gets ONE test corpus parameterised by runtime, so a
green-here / red-there diff is attributable. The same reasoning binds here: one authored
tree, one set of expectations, a driver per renderer. A second corpus written for the
second renderer would be two claims that can disagree about what they are testing while
both stay green — the failure `scripts/gir-scalar-properties.mjs` was extracted to prevent
one axis over.

### 3. The expectations stay `adwaita-core`'s

A tree-level suite invents no new expectation. It builds the tree and asserts the vectors
that already exist, which is what makes a failure attributable to the RENDERER rather than
to a freshly written assertion. Where a block's tree reaches no vector table, that block
proves nothing and must say so — it is not evidence, and it must not be counted as any.

### 4. The remainder is declared per block, and it is self-retiring

`ADWAITA_GALLERY_TREE_DIVERGENCES` already carries a `kind` naming what would close each
divergence, and arm 11 already fails a ledgered block that has CONVERGED. The suite
inherits both properties: a block that is in the corpus and reaches no vector is declared,
and a declaration that has stopped being true fails. Same shape as arm 5b's stale refusals.

### 5. The seam is the node type, and nothing more is extracted than the second driver needs

`StoryViewBase<TNode>`'s shape, applied to the host ops. `gtk-host` stays the reference
implementation and keeps its name, its table and its published subpaths; what moves is the
node type in the signatures the driver crosses, and only where a second driver actually
crosses it. Extracting the full op set into a package before a second renderer needs it
would be the guard-watching-a-mechanism smell the root AGENTS.md names — and the adapters,
which are the expensive part, do not move at all.

### 6. This ADR does not decide the build-from-one-source horizon

ADR 0027 § 9 says generating NativeScript and browser builds from one native-authored
source *"becomes reachable only if the criterion above is met"*. This ADR is how the
criterion gets measured. It is deliberately not that decision, and meeting the criterion on
seven blocks would not be either.

## Consequences

- The repository gains a number for the thing it has only ever had a direction for: how
  many authored trees survive being rendered by two renderers against one spec.
- A ledgered divergence acquires a second way to be wrong. Today a block is ledgered
  because its two authored trees differ; after this it can also be in the corpus and still
  fail, which is the finding the census could not produce.
- `check-adwaita-conformance-drivers.mjs` gains a third kind of driver — a TREE driver
  beside the per-widget specs — and its "driven or say why not" rule has to learn the word,
  the way `nativescript-xml-doors.mjs` had to learn the third door in ADR 0034 § Amendment 13.
- Two renderers run in two runtimes. The suite is one corpus and two jobs, not one job.
- The seven blocks are a floor, not a claim about the widget set. Whatever the suite proves,
  it proves about seven trees.

## Alternatives rejected

**Assert the two authored trees against each other and stop.** That is arm 11, it is done,
and the open-todo it wrote says exactly what it does not close. Comparing data to data is
the half that cannot see a renderer.

**Write a translator between the two markup vocabularies.** Refused twice already, in the
headers of both gallery generators, and refused on a measurement rather than on taste:
across the gallery's preview fragments, a large minority of elements spell a tag
`gtk-host` does not have, and among the attributes that DO sit on a matching tag, a dozen
distinct ones diverge — *"and none of them is a spelling difference"*: an icon name against
a symbolic, an array against a `Gio.ListModel`, three scalars against a `Gtk.Adjustment`, a
boolean against a `present()` call. (`adwaita-gallery-trees.mjs` carries the figures and
says itself that they predate ADR 0034 § Amendment 5, so the gap is narrower today and the
kinds are unchanged — which is the half the refusal rests on.) A translator would map
behaviour, and nothing could hold it. Writing the tree once in a vocabulary that runs is
the standing answer, and this ADR is an application of it.

**Extract a `host-core` package first, then find a consumer.** The adapters are already
runtime-toolkit-free, so the extraction buys nothing until a second driver exists; and a
package with one implementation is an interface fitted to that implementation. The second
driver comes first and decides the shape.

**Grow the corpus before building the suite.** The 16 ledgered blocks each need a decision
before they need code — two are content drift, two are the slot spellings, five are renderer
properties, seven are compositions forced by one renderer. Growing the corpus first would
spend those decisions to make a suite that does not exist yet look better.

## Risks

- **The suite proves less than its name.** Seven blocks, and a block whose tree reaches no
  vector table proves nothing at all. Decision 3 makes that a declaration rather than a
  silent zero, and the printed number has to name its denominator or it is a claim wider
  than its measurement.
- **A green suite on a corpus chosen for agreement.** A block joins the shared source only
  when it needs no alias, so the corpus is selected for the property being tested. That is
  a real bias and it is why the ledger of what is NOT in the corpus has to be printed
  beside the pass count, never behind it.
- **The node-type seam grows past what a driver needs.** Decision 5 is the bound; the review
  question on any PR under this ADR is what the change lets us DELETE.

## Implementation

Each stage is independently useful and breaks nothing that ships.

| # | stage | what goes red if it is wrong |
|---|---|---|
| 1 | A tree driver for `gtk-host`: build `gtkHostTree(widget)` for each corpus block into real widgets, with `installDiagnosticsGate()` on, and assert the `adwaita-core` vectors the tree reaches. | a block that cannot be built; a GTK diagnostic during a build; a vector that disagrees; a block reaching no vector and not declared |
| 2 | ~~The same for the NativeScript port over `nativeScriptTree(widget)`~~ — **withdrawn, see § Amendment 1.** The port's widget classes extend `@nativescript/core` bases that no runtime here has, so there is no off-device tree to build. The second driver is `adwaita-web`, over the same corpus. | the same four, plus a block whose two drivers disagree — which is the finding the whole ADR exists to produce |
| 3 | Teach `check-adwaita-conformance-drivers.mjs` the tree driver, so a table driven only from a tree is not read as undriven, and a tree claiming a table it does not reach fails. | a false coverage claim — the exact class that gate's three incidents are about |
| 4 | Print the distance: blocks in the corpus, blocks reaching a vector, blocks declared, per renderer. Derived every run; no count in a header or in prose. | any figure that is written down rather than derived |
| 5 | Put `adwaita-web` on the corpus: emit the gallery `preview` fence from `ADWAITA_GALLERY_SHARED_TREES` instead of authoring it per block, then drive it in `tests/browser`. This is the stage that closes § 9 in its own words. | a preview fence that is not what the shared tree emits; a web tree that fails a vector its two siblings pass |

Stages 1–4 need no new package and no change to any adapter. Stage 5 is the only one that
touches the website's authored fences, and it is last because the two stages before it are
what make its result readable.

Follow-up is tracked in `status/open-todos.md` per governance; this ADR records the *why*.

## Amendment 1 — the second driver is `adwaita-web`, and stage 2 as written cannot exist

Stage 2 asked for the NativeScript port "off-device against the port's own classes, the way
the port's specs already run on GJS and Node". The measurement says the second half of that
sentence is not what the port's specs do, and the first half is not available at all.

Every widget module under `packages/nativescript-bridge/adwaita/src/widgets/` opens with a
bare `@nativescript/core` import at module scope (`import { Button, GridLayout, ItemSpec,
Label } from '@nativescript/core'` in `adw-banner.ts`, and the same shape in each sibling),
because each class EXTENDS an NS view. `@nativescript/core` is an OPTIONAL peer dependency
and the workspace install does not bring it in — `node_modules/@nativescript` holds
`types`, `types-android` and `types-ios` and nothing else — so the specifier is
unresolvable on GJS and on Node. The port's own suites say so in their headers and act on
it: *"this file must NOT import `./widgets/adw-banner.js` (nor the package root) … the
behaviour is exercised through `./widgets/chrome.js`, the pure sibling the widget
composes"*. So what runs off-device is the port's PURE derivations, never its widgets, and a
"tree driver" over those would build no tree at all — it would compare data to data, which
is arm 11 and is precisely what this ADR exists to go past.

**Installing the peer would not repair it either, and that is the part worth writing down:
the absence is structural, not a state of this checkout.** `@nativescript/core` ships no
platform-neutral module for a widget class at all. In 9.1.1, `ui/label/`, `ui/core/view/`
and `ui/layouts/grid-layout/` each hold `index.android.js`, `index.ios.js` and a
`*-common.js` — and no `index.js`. Choosing between the two flavours is NativeScript's own
platform-aware module resolution, not Node's and not a bundler's; a plain
`import('@nativescript/core/ui/label/index.js')` fails with `Cannot find module`, and the
package root fails one step earlier still, on a directory specifier ESM does not resolve.
So `class AdwBanner extends GridLayout` has no base class to extend in any runtime that is
not a device, whatever the manifest says. Adding the devDependency buys nothing.

A device would not repair it from the other side. An Android emulator can host the real
classes, but a driver that needs one is not a CI guard: it cannot be the check that fails a
PR, which is the only thing this rung is for. So the second driver is `adwaita-web` — the renderer § 9 named
before this ADR re-aimed it — and the § "One correction to § 9's own wording" above is
withdrawn. The correction it made is still true about the CORPUS: `gtk-host` and the
NativeScript port are the two the gallery authors from one source. It was wrong to carry
that fact over into the choice of DRIVER, because who authors a gallery block and who can
build a tree in a test are two different questions.

Stage 5's remaining half — emitting the gallery `preview` fence from
`ADWAITA_GALLERY_SHARED_TREES` — is untouched and stays open: this amendment moves
`adwaita-web` into the DRIVER position, not the website's authored fences.

## What landed

- **The corpus is read, never transcribed.** Both drivers import
  `ADWAITA_GALLERY_SHARED_TREES` from `scripts/adwaita-gallery-shared-trees.mjs` itself. A
  hand-written `scripts/adwaita-gallery-shared-trees.d.mts` beside it is what lets a
  TypeScript spec do that without the corpus moving: `tsc` resolves the declaration and
  never puts the `.mjs` in its program, so no package's `rootDir` is crossed, and each test
  bundler inlines the module like any other relative import. The corpus stays where its two
  plain-Node generators can reach it in a CI job with no `node_modules`.
- **The join is renderer-free** — `packages/web/adwaita-core/src/conformance/shared-trees.ts`,
  exported from `@gjsify/adwaita-core/conformance`. `sharedTreeExpectations(root)` returns
  the vector ROWS an authored node instantiates, by matching the authored value against the
  row's own input. It writes no expected value, which is decision 3 made structural rather
  than promised.
- **Two drivers.** `packages/framework/gtk-host/src/shared-trees.spec.ts` builds each block
  through `createElement`/`setProp`/`insert` with `installDiagnosticsGate()` on;
  `packages/web/adwaita-web/src/shared-trees.spec.ts` builds it out of custom elements in
  Firefox. Each asserts, on the REAL tree its renderer produced, that the authored nodes
  appear in the authored order — the libadwaita revealers and listboxes between them are the
  renderer's business, the nesting is not — and then reads the reached rows off them.
- **Each driver has exactly ONE seam**, a `read(expectation, node)` over a closed observable
  vocabulary. Everything above it is shared; the per-surface transforms are `hostTagOf` on
  both sides plus a camelCase→kebab ATTRIBUTE rule on the web, both total over the corpus.
  There is no per-block branch on either side, which is the half of § 9's criterion that a
  reviewer has to be able to see rather than be told.
- **The gate learned the tree driver** (stage 3). `check-adwaita-conformance-drivers.mjs`
  reads the join's table list out of its CODE, refuses a listed table no import backs and an
  imported table left off the list, refuses a driver spec no entry hands to `run({…})`, and
  refuses a binding no live suite drives. The one half it cannot decide statically — a
  listed table no corpus node REACHES — the drivers assert themselves against
  `reachedTables`, derived from the trees.
- **The distance is printed and not written down** (stage 4): the gate reports the live tree
  drivers and the joined tables, arm 11 still reports the partition, and the drivers name
  every block that reaches no row.

## What the drivers measured, that nothing else had

Three limits are structural, and each is a fact about the criterion rather than a backlog
item. They are in the binding's header where a reader of it will look; here is why they
matter to the decision.

- **A `GParamSpec` default is not a constructed default, and a tree driver reads the second
  one.** `BANNER_DEFAULT_VECTORS` states that `AdwBanner:use-markup` defaults to TRUE, and
  the pspec agrees: `Adw.Banner.find_property('use-markup').get_default_value()` is `true`
  on libadwaita 1.9.3. A freshly constructed `Adw.Banner` answers FALSE — `get_use_markup()`
  and `get_property('use-markup')` agree with each other — and the MECHANISM is measured, not
  guessed: the banner's getter reads its template `GtkLabel`, whose own `use-markup` default
  is FALSE and which nothing writes the banner's pspec default into. Setting that internal
  label's property directly moves what the banner reports, which is what identifies the
  getter as a delegation. `gtk-host`'s README already names the class (construction and the
  pspec disagree in a hundred-odd places) and the host's own contract sides with
  construction. Both Adwaita ports implement the pspec default, so the same authored banner
  is markup-on in the browser and markup-off in GTK. A tree driver therefore cannot read a
  pspec-default table off a built widget; what the ports should do about the divergence is a
  rendering change with its own blast radius and is tracked in `status/open-todos.md`.
- **A localized rendering is a fact about the runner.** `SHORTCUT_LABEL_VECTORS` spells
  `<Control>C` as `[Ctrl][C]`; `Adw.ShortcutLabel` draws `gtk_accelerator_get_label`, which
  is translated — measured as `["Strg","C"]` on this de_DE host and `["Ctrl","C"]` under
  `LC_ALL=C`. The locale cannot be moved from inside the process: `GLib.setenv('LANGUAGE')`
  and `GLib.setenv('LC_ALL')` after `Gtk.init` change neither. So the GTK renderer cannot be
  held to that table by a tree driver at all, which is why `Adw.ShortcutLabel` is a declared
  block rather than a passing one.
- **A notify table's `emitted` half has nowhere to come from.** An authored tree writes a
  property; it cannot attach a listener before the write. Only the END STATE of such a row is
  reachable, and the binding takes only that.

The consequence for decision 4 is the one worth keeping: two of the seven blocks reach no row
at all, and the reason each reaches none is a measurement rather than an omission.
