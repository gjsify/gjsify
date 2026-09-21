# 66. Composition gets a spelling: `template` and `object-id` become fields

- Status: **Proposed**
- Date: 2026-09-21
- Deciders: Pascal Garber
- Related: [ADR 0033 (declarative templates preferred)](0033-declarative-templates-preferred.md),
  [ADR 0051 (one authored tree, rendered)](0051-one-authored-tree-rendered.md),
  [ADR 0053 (Blueprint parsed in-repo)](0053-blueprint-parsed-in-repo.md),
  [ADR 0058 (the translatable marking gets a spelling)](0058-translatable-marking-gets-a-spelling.md),
  [ADR 0062 (the conversion frontier is composition)](0062-the-blueprint-conversion-frontier-is-composition.md)

## Context

ADR 0058 decided that the authored-tree shape does not grow: *"One loss gets a spelling in
`SharedNode`. Twelve stay refusals. The shape does not grow."* This ADR revises that for
exactly two of them, and says what changed.

**What changed is that a need arrived.** 0058 measured the shape against the two consumers it
had — the `adwaita-web` and `gtk-host` tree drivers, which render gallery BLOCKS: single
widgets with no composite class and no addressing. Against those, `template` and `object-id`
are GtkBuilder trivia. ADR 0062 then measured the shape against the other direction, real
applications, and found a wall: **no `.blp` this repository ships projects without loss**, and
the sentence it put on that wall is the reason this ADR exists — *"Declaring a widget works
today; placing one inside another does not."*

The concrete need is outside this repository and is the size of the problem. Learn6502 has 24
`.blp`; **all** of them are composite templates, 18 of them `template $X : Adw.Bin`. Nothing
about that application can reach a second renderer while the shape has no word for the class a
file defines.

### How the numbers here were obtained

Read on 2026-09-21 in a worktree of its own, on `feat/shared-node-template-and-ids`, which sits
on `feat/shared-tree-one-shape` (#1728) and not on `main`.

- **The loss census** parses every corpus file with `packages/infra/blueprint/src/parser.mjs`,
  projects it with `src/project.mjs` and groups the returned `lost` array by `kind`. It is the
  same reading stage D of `scripts/check-blueprint-corpus.mjs` holds per line on every run, so
  the tables restate a gate's data rather than adding an unheld one. Taken twice: once before
  the change and once after, in the same tree.
- **The id-reader census** walks the AST of each shipped `.blp` for `ObjectNode.id` and asks,
  per id, whether the sibling `.ts` names it as a string. That sibling is where
  `GObject.registerClass({ …, InternalChildren: [...] })` lives.
- **The oracle half** is `blueprint-compiler` 0.20.4 on PATH and the committed `.ui` goldens,
  with `@girs/{gtk-4.0,adw-1}` at the version `packages/infra/blueprint/package.json` pins.
  Stage C recompiles every corpus file with the in-repo emitter and diffs the bytes.
- **The shape census** is `scripts/check-shared-tree-shape.mjs`, which sweeps every tracked
  source for the authored-tree shape and holds each declaration to the original field by field.

Read every count below as a date. `check-blueprint-corpus.mjs` prints the live ones on every
run, and they are the ones to believe.

### `template` and `object-id` are ONE construct read twice

A composite template class is "root type plus named children". Split, neither half is usable: a
`template` with no ids defines a class whose parts nothing can reach, and ids with no
`template` name parts of a class nobody declared. That is why these two are decided together
and why a PR that took only one would have closed nothing.

Measured over the shipped `.blp`, every one of them carries a `template` and eleven of the
twelve carry ids — the twelfth, `toolbar-view.blp`, is the exception that shows the pairing,
because its single child is reached by position rather than by name.

### The objection 0058 raised, measured rather than argued

0058 § Context rejects the authored-form direction with a claim about consumers: *"a web custom
element has no composite template and no builder id, and the NativeScript port resolves a class
through an `xmlns` module barrel."* Read as a claim about GtkBuilder's ADDRESSING model it is
right, and it is the reason `bind` stays out below. Read as a claim about these two fields it
is not, and the difference is measurable:

| construct | GTK | web | NativeScript |
|---|---|---|---|
| the class a tree defines | `<template class="X" parent="…">` | the name a custom element registers as | the component class a view file declares |
| the name a node answers to | `<object id="y">`, `get_template_child` | `id` on the element, `getElementById` | `id` on the view, `getViewById` |
| a binding's expression language | `bind`, `lookup`, closures | — | — |

Two of those rows exist on all three surfaces. The third does not, and that is the line this
ADR draws.

### The scope brake fired and did not catch: ids are not read by bindings

The obvious way this could have been the wrong change is if an id were only ever an input to
`bind` — in which case a field carrying ids into a shape with no binding language would be
decoration. So it was measured before it was built, over every id in every shipped `.blp`:

| where the id is read | ids |
|---|---:|
| the sibling TypeScript, through `InternalChildren` | **all of them** |
| a `bind` expression inside the `.blp` | **none** |

Not one id in this repository's shipped Blueprint is read by the binding language. Every one is
read from OUTSIDE the file, by the TypeScript half of the same component. So the id is the
component's PUBLIC addressing surface — the thing `get_template_child`, `getElementById` and
`getViewById` each answer — and it does not wait on `bind`.

### What the change moves

| | before | after |
|---|---:|---:|
| shipped `.blp` that project with NO loss | **0 of 12** | **5 of 12** |
| corpus files that project with no loss | 14 of 68 | 23 of 68 |
| losses the projection takes, corpus-wide | 245 | 151 |
| loss KINDS a shipped `.blp` still reaches | 6 | 4 |

The five that go clean are `excalibur-jelly-jumper`, `three-loader-ldraw` and the three
`templates/adw-*/src/main-window.blp`. What stops the other seven is exactly what this ADR
leaves as a refusal: `translatable` on four, `binding` + `breakpoint` on three, and `styles` on
three of the four the marking already stops — so no file is blocked by `styles` alone.

**The `slot` column is unchanged and is deliberately not claimed.** All twelve still carry a
slot, so "round-trips" in ADR 0058 § 3's stricter sense is still 0 of 12 until the inverter and
its guard exist. What moved is the LOSS count, which is the thing a conversion would destroy.

### The XML exit does not move, and that is checked rather than asserted

`emitGtkBuilderXml` is the authoritative axis: it is what the build compiles and what the
oracle is diffed against. It is untouched by this change — not one byte of `src/emit-xml.mjs`
— and stage C re-emits every corpus file and reports all of them byte-equal to the committed
goldens, which are themselves untouched. The two exits read one AST and only the lossy one
moved.

## Decision

**`template` and `object-id` get a field each on the authored-tree node. `_()`, `bind` and
`breakpoint` stay losses and stay declared. ADR 0058's clause 6 is revised for those two names
and stands for the rest.**

### 1. Two fields, named for what they are rather than for GtkBuilder

```ts
id?: string;
template?: string;
```

`id` is the name a node answers to. `template`, on the ROOT node only, is the class the tree
DEFINES, where `tag` is the type it extends: `template $GalleryHeaderBar : Adw.Bin` is
`{ tag: 'AdwBin', template: 'GalleryHeaderBar' }`.

**Two fields and not one**, although a parentless template makes them coincide: `template
$CorpusOrphan { }` projects with `tag` and `template` saying the same word. That coincidence is
a fact about a file that names no parent, not a redundancy — `08-template.blp` and
`50-template-orphan.blp` are the pair that pins it, and a single field could not say which of
the two a file was.

**Beside `tag`, not inside it.** A tag is what a renderer LOOKS UP; a template class is what it
REGISTERS. Overloading the tag would make the root of `header-bar.blp` say `GalleryHeaderBar`,
a class in no GIR, and every renderer would then have to guess which of the two meanings it was
handed.

### 2. `template` is spelled as the XML writes it, and that is what makes it checkable

The value is exactly what `<template class="…">` carries: the `$Name` verbatim, or the GType
where the file named a type (`template ListItem` is `GtkListItem`). Not the source spelling.

This is not a formatting preference, it is the defect this repository already paid for once:
`findTemplateClass` in `emit-xml.mjs` carries a comment about `issue_187_dec.blp`, where
reading the SPELLING in one place and the GType in another produced `<template
class="GtkListItem">` beside `<lookup … type="ListItem">` — silently different, and a class
GtkBuilder cannot find. Choosing the same rule for the projection means the two exits are
comparable, which clause 4 then uses.

### 3. The other three stay refusals, each for its own reason

- **`_()` / `translatable`** — already decided, by ADR 0058 § 1, which gives it a field and
  ships it WITH the `.blp` emitter that reads it. Nothing here moves that; taking it now would
  be landing a field with no reader, which is the failure mode 0058 § 2 argued against.
- **`bind`** — a whole expression language (lookups, closures, casts, `template` as a source),
  and the only one of the three that is genuinely GtkBuilder-only: neither other surface has a
  consumer for it. A field would be a second implementation of a grammar, not a spelling.
- **`breakpoint`** — `Adw.Breakpoint` is not a widget, so it has no node form at all, and its
  `condition`/`setters` are a second language on top. ADR 0053 clause 3's treatment stands.

**Why the line falls here and not one construct further.** The test applied is the one ADR 0051
Decision 5 already sets: a field lands when a consumer needs it and not before. `template` and
`object-id` have three consumers with a native form each, measured in the table above.
`bind` and `breakpoint` have exactly one. `translatable` has three and already has an ADR.

### 4. The new spelling is held against the ORACLE, not against a second hand-written copy

Stage D of `check-blueprint-corpus.mjs` gains an addressing arm. For every corpus file it
compares the projection's `template` against the `<template class="…">` the reference compiler
wrote, and the projection's ids against the `id="…"` attributes in the same golden: an id the
projection invents is a failure, and an id the golden writes that the projection does not carry
is a failure unless a declared loss NAMES it.

**Why the golden and not the expectation.** The hand-written trees of ADR 0053 clause 2 already
pin which node carries which id, and they are the right first check — but they are written by a
human reading the same file, so the tree and the projection can agree with each other and both
be wrong. The oracle's own bytes are a third opinion that cannot make that mistake. This was
measured, not assumed: swallowing one id and then "correcting" the expectations to match leaves
the hand-written arm silent on all five affected files and the golden arm red on all five.

### 5. Every restatement of the shape grows with it, or the gate says which one did not

`SharedTreeNode` in `packages/web/adwaita-core/src/conformance/shared-trees.ts` is the original,
and `scripts/check-shared-tree-shape.mjs` (#1728) holds every other spelling to it field by
field. Growing the shape therefore touches every `holds` entry and every `apart` entry's
declared delta, and that cost is the point: it is the proof that the shape is one shape rather
than a family of near-copies. Measured by leaving one restatement behind — the gate names the
file, the declaration, the line and the missing field.

`rebuild()` in `scripts/adwaita-gallery-shared-trees.mjs` copies fields by name and is the first
place a new one is silently lost; ADR 0058 § Implementation named it before there was a second
field to lose. It copies both.

### 6. ADR 0058 is revised where it is wrong and stands everywhere else

Clause 6's list of refusals loses two names. Clauses 1 (the marking), 3 (`slot` stays one
field, decided by a lookup with a guard), 4 (style classes are blocked by the vocabulary, not
the shape) and 5 (the portable values wait for a block that is blocked by nothing else) are
untouched — none of them rests on `template` or `object-id`, and the measurement above does not
reach them.

**What 0058 got right and is worth preserving as a rule**: it refused to grow the shape for
ambiguities a LOOKUP can resolve, and refused to grow it for consumers that did not exist. Both
tests are applied above and both are passed here rather than waived.

## Consequences

- ADR 0062's frontier sentence is answered for half of its blocker 3: placing a widget inside
  another can now be WRITTEN in the shape, and the `$extern` half (blocker 1) is still open.
- The projection stops being a one-way door for five of the twelve shipped files: a tree
  converted from one of them can be carried into the shared shape and back out without the
  conversion inventing anything.
- The conversion question for an outside application — Learn6502's 24 composite templates —
  stops being blocked on the shape and becomes blocked on `$extern` and on the marking, which
  are two named, sized pieces of work.
- The authored-tree shape now has two fields no gallery block uses. That is a cost, and it is
  paid in `rebuild()`, in five restatements and in three `apart` deltas — all of them
  machine-held, none of them prose.
- A THIRD reader of one file's addressing exists. The `.blp`, the `.ui` golden and the
  projection now all state the composite class and the ids, and any two of them disagreeing is
  a failure that names the file.
- ADR 0058's title is now half-true: it says twelve losses stay refusals, and ten do. The
  correction is recorded here rather than by editing a dated decision.

## Alternatives rejected

- **Take `object-id` alone.** It is the bigger number by far. It is also unusable alone: ids
  address the parts of a class the shape still could not declare, so the files would go on
  projecting with a `template` loss and nothing would reach a second renderer.
- **Take `template` alone.** Cheaper and it moves fewer files — the shipped `.blp` would go
  from 0 to 0, since eleven of the twelve carry ids as well. A change that moves the headline
  number by nothing is a change whose consumer has not been found yet.
- **Overload `tag` with the template class.** One field instead of two, and it destroys the
  fact the table exists to carry: `header-bar.blp` is a `GalleryHeaderBar` whose root type is
  `AdwBin` because `AdwHeaderBar` is final. Both halves are load-bearing and a renderer needs
  both.
- **Spell `template` with the source name (`ListItem`) rather than the GType.** It reads better
  and it is the mistake `issue_187_dec.blp` already cost: the two exits would then describe one
  file differently, and the corpus could not hold them against each other at all.
- **Take `bind` too, so the addressing model is complete.** It is a grammar, not a field, and
  it is the one construct of the three that has no consumer on either other surface. Growing
  the shape for it would be carrying one runtime's expression language into a shape whose other
  two readers cannot evaluate it — the claim ADR 0058 § Context rejects, correctly.
- **Wait for the `.blp` emitter, as ADR 0058 § 2 does with the marking.** Defensible for a
  field whose only consumer is the emitter. It is not this field's situation: the projection
  direction has readers today, and the thing that blocks them is that a converted tree cannot
  say what it is.
- **Do nothing and keep 0058's "the shape does not grow".** That is a rule about cost, and the
  cost is paid above: three gates, five restatements, three deltas, one new stage-D arm. What
  it would buy is a shape that is cheap and that no application can be authored in.

## What this does not decide

- **`$extern`** — ADR 0062 § Decision 3's next piece of parser work, untouched here. A
  `$MyWidget { }` nested in a tree is still refused by the parser, and that is blocker 1.
- **When the `.blp` emitter is built**, or whether the `slot` inverter and its guard land with
  it. ADR 0058 § 3 and § 7 stand.
- **Whether the shared corpus's authored form moves to `.blp`.** ADR 0051 Decision 1 stands.
  The price of moving is lower than 0058 measured it and is still not zero.
- **Where `SharedNode` lives.** Still open, still forced by the first PR that publishes a
  package producing the projection.

## Implementation

- The two fields, the projection change, the corpus expectations for every file that declared
  one of the two losses, the stage-D addressing arm and the five restatements are one PR.
- `LOSS_KINDS` in `scripts/check-blueprint-corpus.mjs` and the `LossKind` typedef in
  `corpus/expectations.mjs` lose both names, so declaring either as a loss is now itself the
  failure.
- The expectation trees keep their hand-written character: the id VALUES and the template class
  names come from the `detail` prose the corpus already carried, and each one was cross-checked
  against what the projection produces before it was written into a tree.
- Follow-ups are tracked in `status/open-todos.md` per governance; this ADR records the *why*.
