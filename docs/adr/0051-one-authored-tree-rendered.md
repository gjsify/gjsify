# 51. One authored tree, rendered: ADR 0027 § 9's criterion becomes a suite

- Status: **Proposed**
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
| 2 | The same for the NativeScript port over `nativeScriptTree(widget)`, off-device against the port's own classes, the way the port's specs already run on GJS and Node. | the same four, plus a block whose two drivers disagree — which is the finding the whole ADR exists to produce |
| 3 | Teach `check-adwaita-conformance-drivers.mjs` the tree driver, so a table driven only from a tree is not read as undriven, and a tree claiming a table it does not reach fails. | a false coverage claim — the exact class that gate's three incidents are about |
| 4 | Print the distance: blocks in the corpus, blocks reaching a vector, blocks declared, per renderer. Derived every run; no count in a header or in prose. | any figure that is written down rather than derived |
| 5 | Put `adwaita-web` on the corpus: emit the gallery `preview` fence from `ADWAITA_GALLERY_SHARED_TREES` instead of authoring it per block, then drive it in `tests/browser`. This is the stage that closes § 9 in its own words. | a preview fence that is not what the shared tree emits; a web tree that fails a vector its two siblings pass |

Stages 1–4 need no new package and no change to any adapter. Stage 5 is the only one that
touches the website's authored fences, and it is last because the two stages before it are
what make its result readable.

Follow-up is tracked in `status/open-todos.md` per governance; this ADR records the *why*.
