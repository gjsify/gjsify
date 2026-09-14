# 58. The translatable marking gets a spelling; the other twelve losses stay refusals

- Status: **Proposed**
- Date: 2026-09-14
- Deciders: Pascal Garber
- Related: [ADR 0033 (declarative templates preferred)](0033-declarative-templates-preferred.md),
  [ADR 0034 (widget vocabulary convergence)](0034-widget-vocabulary-convergence.md) § 8,
  [ADR 0042 (portable menu model)](0042-portable-menu-model.md),
  [ADR 0046 (portable list model)](0046-portable-list-model.md),
  [ADR 0047 (portable adjustment)](0047-portable-adjustment.md),
  [ADR 0049 (style classes are a list)](0049-style-classes-are-a-list.md),
  [ADR 0051 (one authored tree, rendered)](0051-one-authored-tree-rendered.md),
  [ADR 0053 (Blueprint parsed in-repo)](0053-blueprint-parsed-in-repo.md)

## Context

ADR 0053 made Blueprint a second READER of `SharedNode` and said, twice, that it was not
deciding what the shape should hold: *"whether `SharedNode` grows to hold the portable
values of ADRs 0042, 0046 and 0047, or a translatable marker … belongs to the ADR that
needs it"*. `status/open-todos.md` has carried the question since, with the standing rule
beside it — deciding the authored form belongs to whoever brings a measurement.

This is the measurement, and the decision it makes cheap to take.

### How the numbers here were obtained

Everything below is read at `702470a628` (v0.50.0), on 2026-09-14, and every table says what
it counted and over what.

- **The corpus half** parses each of the 38 files with
  `packages/infra/blueprint/src/parser.mjs`, projects it with `src/project.mjs`, and groups
  the `lost` array that seam returns by `kind`. It is not a fresh reading:
  `corpus/expectations.mjs` and `corpus/real-expectations.mjs` declare the same losses by
  hand, per line, and stage D of `scripts/check-blueprint-corpus.mjs` already holds the two
  against each other on every run. The two agree exactly — 120 hand-declared, 119 produced,
  the difference being the single `comment` entry the projection deliberately never
  produces. So the corpus tables restate a gate's data rather than adding an unheld reading.
- **The gallery half** lifts every ` ```blueprint ` fence out of
  `<Fragment slot="blueprint">` in `website/src/content/docs/{adwaita,gtk}/*.mdx` and runs
  the same parse and projection over it. Nothing holds these today; that is one of the
  findings.
- **Widget-property questions** are answered from
  `packages/framework/gtk-host/src/generated/props.ts`, which is GIR-derived, in-tree, and
  states its own provenance (`Gtk-4.0/4.23.3 Adw-1/1.10.0`) in its header. Deliberately NOT
  from `node_modules/@girs`: this worktree has none installed, and `packages/infra/blueprint`'s
  README already records what one stale copy of it cost — two readings agreed with each
  other and with nothing else.

One live count drifted while this was being read, which is why the method is written out
rather than assumed. `src/project.mjs`'s own header says the expectations hold *"36
hand-written `SharedNode` trees and 119 declared losses"*. They hold 38 and 120: #1644 added
`27-property-flags.blp` after #1635 wrote that sentence, and nothing compared the two. The
corpus harness prints both figures on every run; the comment restating them is the copy that
went stale.

### What the projection actually loses, over 38 files

27 written rule files plus the 11 real `.blp` the build compiles. "real" is the subset of
"files" — the two columns are different facts and must not be added together.

| loss kind | occurrences | files (of 38) | of those, real (of 11) |
|---|---|---|---|
| `object-id` | 53 | 15 | 10 |
| `translatable` | 25 | 4 | 3 |
| `template` | 12 | 12 | 11 |
| `breakpoint` | 8 | 5 | 3 |
| `binding` | 7 | 4 | 3 |
| `styles` | 6 | 3 | 2 |
| `menu` | 2 | 2 | 0 |
| `signal` | 2 | 2 | 0 |
| `accessibility` | 1 | 1 | 0 |
| `layout` | 1 | 1 | 0 |
| `sibling-object` | 1 | 1 | 0 |
| `value-list` | 1 | 1 | 0 |
| `comment` | (never produced) | — | — |
| **total** | **119** | **26 distinct** | **11 distinct** |

**Six of the twelve produced kinds are unreachable from the eleven shipped files.** `menu`,
`signal`, `accessibility`, `layout`, `sibling-object` and `value-list` exist in this census
only because ADR 0053 clause 6 wrote a corpus per LANGUAGE RULE rather than collecting one
from real files. That is the clause earning its keep, and it is also a warning about the
other direction: a construct no real file uses is a construct whose SECOND case nobody has
seen, which is exactly how `accessibility { }` sat inside the parser's subset while emitting
the wrong element.

### Round-tripping: nine files of thirty-eight, and none of the eleven

A file round-trips if its `.blp` can be reconstructed from its `SharedNode` alone. A
declared loss blocks that; so does a `slot`, which cannot say which of two constructs it
came from.

| what is asked | files |
|---|---|
| project with no declared loss AND carry no `slot` | **9 of 38** |
| project with no declared loss, `slot` resolved by a lookup (below) | **12 of 38** |
| of the 11 real files, either way | **0 of 11** |

The nine are `01-object-minimal`, `02-property-scalars`, `03-property-enum`,
`04-children-implicit`, `15-comments`, `16-string-escapes`, `17-numeric-forms`,
`24-unqualified-type` and `27-property-flags`. The three the lookup adds are
`05-child-slot-named`, `06-property-object-valued` and `18-multiple-imports` — slot-only
files that lose nothing else.

What stops each of the eleven real files, exactly:

| file | what stops it |
|---|---|
| `showcases/dom/canvas2d-fireworks/src/gjs/fireworks-window.blp` | template, object-id, slot, binding, breakpoint |
| `showcases/dom/excalibur-jelly-jumper/src/gjs/jelly-jumper-window.blp` | template, object-id, slot |
| `showcases/dom/three-geometry-teapot/src/gjs/teapot-window.blp` | template, object-id, slot, binding, breakpoint |
| `showcases/dom/three-loader-ldraw/src/gjs/ldraw-window.blp` | template, object-id, slot |
| `showcases/dom/three-postprocessing-pixel/src/gjs/pixel-window.blp` | template, object-id, slot, binding, breakpoint |
| `showcases/gtk/adw-blueprint-layout/src/header-bar.blp` | template, object-id, slot, styles, translatable |
| `showcases/gtk/adw-blueprint-layout/src/toolbar-view.blp` | template, slot, styles, translatable |
| `showcases/gtk/effect-adw-services/src/window.blp` | template, object-id, slot, translatable |
| `templates/adw-canvas2d/src/main-window.blp` | template, object-id, slot |
| `templates/adw-game/src/main-window.blp` | template, object-id, slot |
| `templates/adw-webgl/src/main-window.blp` | template, object-id, slot |

`template` stops all eleven, `slot` all eleven, `object-id` ten. Those three are the wall,
and none of them is a field anybody has asked for.

### The `slot` conflation is real, and it is decidable — by a lookup, not by a field

`slot` carries two GtkBuilder constructs: `[start]` is `<child type="start">`, a placement on
the child wrapper, and `content:` is `<property name="content">`, an object as a property
value. Measured over the corpus: **53 slot uses, 26 bracket-derived and 27
property-derived**, on 46 of 165 projected nodes across 17 of 38 files, and 7 files carry
both constructs at once.

What the ADRs had not asked is whether the two populations can be told apart at all:

- Six distinct bracket names (`start`, `end`, `top`, `bottom`, `center`, `breakpoint`) and
  five distinct property names (`child`, `content`, `model`, `sidebar`, `title-widget`).
  **The intersection is empty.**
- The distinguishing question — *is this name a property of the parent class?* — answers the
  **17** distinct (construct, name, class) triples that cover all 53 uses, with **0**
  disagreements and no class missing from the table it is asked of.
- And it is not a coincidence of eleven files: across all **191 interfaces / 169 widgets** of
  the in-tree GIR-derived property surface, **not one class declares a property named
  `start`, `end`, `top`, `bottom`, `center` or `breakpoint`**.

That lookup is not new machinery. ADR 0053 § Amendment 1 already put exactly this kind of
`@girs` question inside the emitter, for enum members and flag sets, for exactly this reason
— the resolution is in the vocabulary rather than in the syntax.

### Three source kinds land on one string, and the same lookup separates them

`SharedNode['props']` holds `string | number | boolean`, and the projection's `scalarOf`
sends three different Blueprint values into the first of those: a string literal, an
enum-or-flag member, and an object-id REFERENCE. Measured over the 231 scalar props that
reach a shared node: **28 ident-valued, 107 string, 65 number, 31 boolean** — and **no
property name in the corpus carries both an ident and a string value anywhere**.

The property's own GIR type is what separates them, not the shape: `orientation` is
enum-typed, `menu-model` is object-typed (so `menu-model: mainMenu` is a reference), `label`
is string-typed. This is the same answer as the slot question, one grain smaller.

What the lookup does NOT restore is the object the id names, which leaves with the id — and
that is a `template`/`object-id` problem, not a props problem.

### Style classes: the shape is not what blocks them, and the record here was wrong

`corpus/expectations.mjs`'s header states that `styles [...]` has nowhere to go because *"ADR
0049 decided style classes are a LIST"* and *"a space-joined string would be a lie about the
shape 0049 chose"*. Read against 0049 § 3, that is backwards. 0049 chose a string-taking
door, in as many words:

```ts
get styleClasses(): string[]
set styleClasses(value: string | null | undefined)   // space-separated, as in XML
```

— and rejected an array-taking door on a measurement of what it would do to
`check-generated-website-data`'s attribute kinds. The LIST is the read-back; the WRITE is a
space-separated string, which `props` already holds. The title of 0049 is not its § 3.

So the shape is not the obstacle. The vocabulary is, and it is measured elsewhere: the three
surfaces spell this property three ways today — `cssClasses` on `gtk-host` (the GIR name,
`props.ts:5772`), `styleClasses` on the NativeScript port (0049 § 1: the GIR name is taken by
`@nativescript/core`'s own `ViewBase`), and boolean attributes on `adwaita-web` (0049 §
*What this does not decide*: `<gtk-button flat suggested>` stays). ADR 0051's rule for joining
the shared corpus is that a block needs *"no alias at all"*, and three spellings is three
aliases. Three of the 17 ledgered divergences name this property as half of their reason.

### Prop key spelling is not an obstacle either, and it looked like one

The projection produces prop keys in the source's spelling — **91 kebab-case, 140
single-word, 0 camelCase** over the corpus — while the seven authored shared trees are
camelCase: **1 camel (`buttonLabel`), 23 single-word, 0 kebab**. Two populations, two
spellings, on the same field.

It costs nothing. `gtk-host`'s generated prop surface declares BOTH spellings for every one
of its **418 multi-word property names** (`centeringPolicy` and `'centering-policy'` side by
side), and `attributeOf` — the camelCase→kebab rule both the web driver and arm 13 import —
is the identity on a key that is already kebab. A suspected obstacle that measures to zero is
worth writing down, because an argument would have assumed it.

### The gallery already authors 40 `.blp` files by hand, and that is the emit direction's consumer

`ADWAITA_GALLERY_SHARED_TREES` is not the only artifact a `.blp` emitter would serve. Every
gallery block carries a hand-written ` ```blueprint ` fence beside its `preview`, `gjs` and
`nativescript` ones — **40 fences over 40 blocks on 9 pages** — and those are the files an emitter
would produce. Run through the same parse and projection:

| what the fence uses | fences (of 40) |
|---|---|
| at least one `_()` (165 calls in total) | **37** |
| a `slot` | 19 |
| at least one `styles [...]` (30 blocks in total) | 13 |
| an object id | 6 |
| a value list | 4 |
| an inline `menu` | 2 |
| **nothing the projection loses** | **2** |
| refused by the parser outright | 1 |

The two clean ones are `Adw.Avatar` and `Adw.Spinner`. The refusal is `Adw.AlertDialog`,
whose `responses` block carries a response flag the AST has no field for — already a named
refusal in `status/open-todos.md`, and reached here from a second direction.

**And the seven shared blocks say it in one line.** Of the seven blocks whose tree is
authored once, **six are blocked by `translatable` and by nothing else** — `Adw.Banner`,
`Adw.SwitchRow`, `Adw.EntryRow`, `Adw.ExpanderRow`, `Adw.ShortcutLabel`, `Adw.WindowTitle`.
The seventh, `Adw.PreferencesGroup`, adds `styles`, a value list and a slot, and is the block
ADR 0051 § Amendment 2 already measured as an emitter casualty for an unrelated reason: its
fence teaches a CSS-classed HTML `<button>` and an `<adw-combo-row model=…>`, neither of
which is a node `SharedNode` can name at all.

### The two directions do not cost the same, and they never did

| | emit `.blp` FROM the corpus (ADR 0034 § 8) | make `.blp` the AUTHORED form |
|---|---|---|
| what it needs the shape to hold | whatever the fence it replaces already says | whatever both drivers consume, over app-shaped files |
| measured requirement | `translatable` — 6 of the 7 shared blocks, sole blocker | `template` 11/11, `slot` 11/11, `object-id` 10/11, then translatable/binding/breakpoint/styles |
| what closing `translatable` buys the other column | — | **0 of 11 real files** |
| governance cost | none: ADR 0051 Decision 1 keeps the authored form | a supersession of ADR 0051, with its own measurement |

The three constructs that block every real file are GtkBuilder's ADDRESSING model, and the
other two surfaces have no use for it: a web custom element has no composite template and no
builder id, and the NativeScript port resolves a class through an `xmlns` module barrel. So
the authored-form direction is not "a few more fields". It is carrying one runtime's
addressing into a shape whose other two consumers cannot read it — which is the shape of
claim ADR 0051 rejected a translator for.

## Decision

**One loss gets a spelling in `SharedNode`. Twelve stay refusals. The shape does not grow
for the two ambiguities, because a lookup decides both — and the claim that it does is HELD
or it is not made.**

### 1. The translatable marking gets a field, and it mirrors the AST it comes from

```ts
translatable?: Readonly<Record<string, { readonly context?: string }>>;
```

Keyed by the prop name it marks; a present key means marked; `context` carries `C_()`'s
msgctxt. That is `StringValue['translatable']` from `src/ast.d.mts` verbatim, so the
projection fills it at the seam that currently pushes the loss, and the corpus needs one
entry per marked property rather than a new value language.

**Beside `props`, not inside it.** GtkBuilder agrees: `translatable="yes" context="noun"` is
an ATTRIBUTE next to the value, not a different value
(`corpus/rules/09-translatable.ui`). Widening `props` to a marked-value union would touch
every reader of `props` in both drivers, in `rebuild()`, and in arm 13, to carry something
that is not a value.

**Three named consumers, none of them hypothetical.** The 37 gallery fences with 165 `_()`
calls, which an emitter would otherwise rewrite without their markings. ADR 0033, whose
entire reason for preferring a template is that a caption `xgettext` cannot see is
untranslatABLE while merely looking untranslated. And ADR 0053 § Consequences, which named
this as the sharpest case under clause 3 and deferred it to *"the ADR that needs it"*.

### 2. The field lands WITH its reader, never before it

ADR 0051 Decision 5 bounds this: nothing is extracted before a second driver needs it. The
two drivers that exist today translate nothing, so the consumer of this field is the `.blp`
emitter, and the field ships in the PR that builds the emitter. A field with no reader is
the failure mode `adwaita-gallery-shared-trees.d.mts`'s own header names for itself — *"a
claim about the module that can quietly stop being true"*.

Its check comes with it, and it is the containment arm one notch over: every `_()` in a
shared block's ` ```blueprint ` fence corresponds to a marked prop in that block's tree, and
every marked prop to an `_()`. Arm 13 already holds the `preview` fence that way; the
blueprint fence has never been held by anything, which is why 37 of 40 could carry a marking
the corpus cannot express without a single check going red.

### 3. `slot` does not split, and the lookup that decides it gets a guard

The projection is invertible on `slot` with one GIR question, measured correct on all 17
triples the corpus's 53 uses reduce to and free of collisions across all 169 widgets. A
second field would buy nothing a lookup does not already answer, and ADR 0051 Decision 5 is
the bound.

**But an empty intersection is a fact about today's GTK, not a law.** The day a widget
declares a property named like a child type it accepts, an inverter picks the wrong construct
and emits output that is plausible and wrong — the exact failure ADR 0053 clause 3 exists to
prevent, arriving through the one door that clause does not watch. So the inverter's
precondition is a check over the widget table that no class declares a property named like a
child type, failing loudly when GTK adds one. No inverter without that check.

### 4. Style classes stay out, and the reason is the vocabulary

Not the shape: `props` already holds the space-separated string ADR 0049 § 3 chose as the
write door. What blocks them is three spellings on three surfaces, and ADR 0051 admits a
block to the shared corpus only when it needs no alias. This is ADR 0034's ledger, already
counted down by `check-vocabulary-alignment.mjs`; when that name converges,
`props: { <the agreed name>: 'flat suggested-action' }` needs no field and no decision.

The record in `corpus/expectations.mjs`'s header, which says the shape is the obstacle, is
wrong and should be corrected where it stands.

### 5. The portable values of ADRs 0042 / 0046 / 0047 stay out, because no block is waiting on them

The reason is not that a menu, a list or an adjustment is unwelcome in a tree. It is that
widening `props` to hold an object would move **zero** blocks into the shared corpus: all 17
ledgered divergences are ledgered as `property` (5), `composition` (7), `content` (3) or
`vocabulary` (2), and **none as a shape limit**. `Adw.SpinRow` is the one that looks closest
and is the clearest case against — its own ledger entry records that the framework tree
authors `adjustment` as an object and the NativeScript template as the JSON string its XML
door parses, *"one value, two spellings, one per surface's own door"*. A shared node cannot
be authored in two doors at once whatever `props` admits.

So this stays exactly where ADR 0053 left it: evidence, not an answer, and the answer comes
from the first block that is blocked by the shape and by nothing else.

### 6. The remaining ten stay refusals, on ADR 0053 clause 3's own terms

`template`, `object-id`, `binding`, `signal`, `breakpoint`, `menu`, `layout`,
`accessibility`, `value-list` and `sibling-object` keep the treatment clause 3 gave them: a
hard error naming its line on any path but GTK's. Nothing in this measurement argues for a
spelling — six of them are unreachable from every shipped file, and the three that block
every shipped file are GtkBuilder addressing the other two surfaces cannot consume.

### 7. This is Proposed, and it supersedes nothing

ADR 0051 Decision 1 keeps `ADWAITA_GALLERY_SHARED_TREES` the authored form and this ADR does
not touch it. The decision above is what the shape should hold when a `.blp` EMITTER is
built; the authored-form question stays open in `status/open-todos.md` with the price
measured above, which is the first time it has had one.

## Consequences

- The open question ADR 0053 left twice acquires an answer with a number behind it: one
  field, six of seven shared blocks, and a governance cost of nothing.
- The emit direction becomes a one-field change rather than an open-ended shape question,
  and the authored-form direction becomes visibly expensive rather than merely undecided.
- **A record in the tree is corrected.** `corpus/expectations.mjs`'s finding 2 says `styles`
  is blocked by the shape; § 4 above says it is blocked by the vocabulary, and 0049 § 3 is
  the evidence. A finding written while reading a decision's TITLE rather than its clause is
  a class worth naming, because it reads exactly like a measurement.
- Two conflations move from "the projection cannot be inverted" to "the projection cannot be
  inverted without the GIR" — which is a different, smaller claim, and it is the claim the
  emitter already lives with for enum members.
- Clause 3 adds a guard rather than a field, so the cost is a check that can only be paid
  once. Clause 2 adds a check beside the field, so the field cannot become decorative.
- The gallery's 40 blueprint fences are named as an unheld artifact. That is a finding this
  ADR produces and does not close.

## Alternatives rejected

- **Grow `props` to `string | number | boolean | object` and take the portable values.**
  The obvious move, and it moves no block: § 5's ledger census is 17 entries and zero shape
  limits. It would also widen the type every reader of `props` narrows, to serve a consumer
  that does not exist — ADR 0051 Decision 5's own shape, one field over.
- **Split `slot` into `childType` and `propertySlot`.** Honest about the conflation and
  pays for a distinction the GIR already carries, measured free of collisions over 169
  widgets. It would also make every authored tree choose between two fields where today it
  chooses nothing, and 0 of the 14 authored shared nodes carry a slot at all.
- **Add `styleClasses` now and let the vocabulary catch up.** It would put a fourth spelling
  of a property that already has three into the one artifact whose admission rule is "no
  alias at all", and make the shared corpus the place the vocabulary disagreement is
  resolved instead of the place it is exposed.
- **Make `.blp` the authored form and delete the question.** Priced above: 0 of 11 real files
  round-trip, and the three constructs that stop them are GtkBuilder addressing. It needs a
  supersession of ADR 0051 and a measurement this one does not provide.
- **Mark translatability by convention instead of by field** — e.g. treat every `title` and
  `label` as translatable. Silent, unenforceable, and wrong on `Adw.EntryRow`'s `text:
  "Grace Hopper"`, which the gallery's own fence deliberately leaves unmarked beside a marked
  `title:` on the same node.
- **Do nothing until the emitter exists.** Defensible, and it is what clause 2 does with the
  CODE. What it must not do with the DECISION is leave it to be taken inside the emitter's
  PR, where the shape question would be answered by whatever that PR found convenient.

## What this does not decide

- **Which notation the shared corpus is authored in.** § 7. The price of moving is now
  measured; the move is not proposed.
- **When the `.blp` emitter is built**, or by whom. This ADR says what it may add to the
  shape, not that it is next.
- **Whether the gallery's blueprint fences become generated.** Clause 2 asks only that they
  be HELD against the corpus, in ADR 0051 § Amendment 2's direction — the fence is the
  authority and is free to teach more.
- **The style-class name.** That is ADR 0034's ledger and its gate's countdown; § 4 only
  removes the shape from the list of reasons it has not converged.
- **Where `SharedNode` lives.** Still open, still forced by the first PR that publishes a
  package producing the projection, and unchanged by adding a field to it.

## Implementation

- Nothing lands before the emitter. The field, the projection change, the corpus
  expectations for the four files that declare a `translatable` loss, and the fence
  containment check of clause 2 are one PR.
- `rebuild()` in `scripts/adwaita-gallery-shared-trees.mjs` copies `tag`, `slot`, `props` and
  `children` explicitly, so it drops an unknown field silently. It is one line and it is the
  first place a new field is lost; both driver specs read the corpus through it.
- Clause 3's guard is independent of all of that and can land alone, since it makes a claim
  about the widget table rather than about the projection.
- Follow-up is tracked in `status/open-todos.md` per governance; this ADR records the *why*.
