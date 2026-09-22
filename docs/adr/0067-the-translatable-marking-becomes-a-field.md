# 67. The translatable marking becomes a field, on ADR 0058's own spelling

- Status: **Proposed**
- Date: 2026-09-21
- Deciders: Pascal Garber
- Related: [ADR 0033 (declarative templates preferred)](0033-declarative-templates-preferred.md),
  [ADR 0049 (style classes are a list)](0049-style-classes-are-a-list.md),
  [ADR 0051 (one authored tree, rendered)](0051-one-authored-tree-rendered.md),
  [ADR 0053 (Blueprint parsed in-repo)](0053-blueprint-parsed-in-repo.md),
  [ADR 0058 (the translatable marking gets a spelling)](0058-translatable-marking-gets-a-spelling.md),
  [ADR 0062 (the conversion frontier is composition)](0062-the-blueprint-conversion-frontier-is-composition.md),
  [ADR 0066 (composition gets a spelling)](0066-composition-gets-a-spelling-template-and-object-id.md)

## Context

ADR 0058 § 1 already wrote this field down, in TypeScript, and § 2 then held it back: *"The
field lands WITH its reader, never before it … the consumer of this field is the `.blp`
emitter, and the field ships in the PR that builds the emitter."*

This ADR takes the spelling unchanged and takes the deferral back. What changed is not the
spelling — it is which direction has a reader.

### How the numbers here were obtained

Read on 2026-09-21 in a worktree of its own, on `feat/shared-node-translatable`, which sits on
`feat/shared-node-template-and-ids` (#1734) and not on `main`.

- **The loss census** parses each corpus file with `packages/infra/blueprint/src/parser.mjs`,
  projects it with `src/project.mjs` and groups the returned `lost` array by `kind` — the same
  reading stage D of `scripts/check-blueprint-corpus.mjs` holds per line on every run. Taken
  twice in the same tree, once before the change and once after.
- **The marking census** walks the whole AST of every corpus file — 56 rule files, 12 shipped
  `.blp`, 21 refusals — for a `StringValue` carrying a `translatable`, and records the
  STRUCTURAL PATH of each. A generic walk and not a list of named fields on purpose: a census
  that looks where it expects markings cannot report one where it does not.
- **The oracle half** is `blueprint-compiler` 0.20.4 on PATH and the committed `.ui` goldens,
  with `@girs/{gtk-4.0,adw-1,…}` at the versions `packages/infra/blueprint/package.json` pins.
  Stage C re-emits every corpus file with the in-repo emitter and diffs the bytes.
- **The shape census** is `scripts/check-shared-tree-shape.mjs`, which sweeps every tracked
  source for the authored-tree shape and holds each declaration to the original field by field.

Read every count below as a date. The harness prints the live ones on every run, and those are
the ones to believe.

### The marking occurs in seven places and the projection can reach exactly one

43 marked strings over the 89 corpus files, by where they sit:

| where the marking sits | occurrences | what the projection does with the construct |
|---|---:|---|
| a scalar property of a surviving node | **26** | keeps the value, dropped the marking |
| an `extensions` entry (`responses`, `accessibility`, breakpoint `setters`) | 6 | loses the whole block by its own kind |
| a `menu` attribute | 4 | loses the whole menu (`menu`) |
| an `items` entry of a value list | 2 | loses the whole list (`value-list`) |
| a literal inside a closure argument | 2 | loses the whole binding (`binding`) |
| an `extension-list` item (`marks`, `items`) | 3 | loses the whole list by its own name |
| **total** | **43** | |

**So the field's reach is 26 and not 43, and the other 17 are not waiting on it.** A marking
inside a construct that leaves whole is not a marking the shape is missing — it is a marking
whose HOST the shape cannot hold, which is a different decision with a different price. This is
the same split ADR 0058 measured over the gallery fences (137 of 165 on a scalar property) at
one grain finer, and it lands the same way.

The 26 sit on 5 files: `rules/09-translatable.blp` and four shipped ones.

### The `C_()` context occurs once where it matters, and six times where it does not

Seven of the 43 carry a message context. **Exactly one of those seven is reachable** —
`09-translatable.blp` line 9, the rule file written to isolate the construct. The other six are
inside a menu, a value list, a `responses` block, a closure and a `marks` list.

That is an argument for carrying `context` and not against it. A one-occurrence field would be
decoration if the construct were rare; it is not rare — it is COMMON in the language and the
corpus reaches it once because six of its seven uses are behind a construct that leaves whole.
The alternative, a `Set` of marked names with no context, would be a shape that cannot express
what the one file this corpus wrote for the purpose says, and the file would have to be changed
to fit the shape.

### What the change moves

| | before | after |
|---|---:|---:|
| shipped `.blp` that project with NO loss | 5 of 12 | **6 of 12** |
| corpus files that project with no loss | 23 of 68 | **25 of 68** |
| losses the projection takes, corpus-wide | 151 | **125** |
| loss KINDS a shipped `.blp` still reaches | 4 | **3** |

**One file, and the honest reading of that number is the point of the next table.** Four
shipped files reach the marking; `showcases/gtk/effect-adw-services/src/window.blp` is the one
whose ONLY loss it was, and it is now the largest shipped `.blp` that projects losslessly — 12
markings on a file whose own header says it exists so that every caption is reachable by
`xgettext`.

What stops the other six, after this change:

| file | what is left |
|---|---|
| `showcases/gtk/adw-blueprint-layout/src/header-bar.blp` | `styles` |
| `showcases/gtk/adw-blueprint-layout/src/toolbar-view.blp` | `styles` |
| `templates/gtk-minimal/src/main-window.blp` | `styles` |
| `showcases/dom/canvas2d-fireworks/src/gjs/fireworks-window.blp` | `binding`, `breakpoint` |
| `showcases/dom/three-geometry-teapot/src/gjs/teapot-window.blp` | `binding`, `breakpoint` |
| `showcases/dom/three-postprocessing-pixel/src/gjs/pixel-window.blp` | `binding`, `breakpoint` |

**Three files are now blocked by `styles` ALONE, and that is the finding worth carrying
forward.** Before this change no shipped file was blocked by `styles` alone — it always had the
marking beside it, so closing `styles` would have moved nothing and the measurement could not
see it. ADR 0058 § 4 already decided that `styles` is blocked by the VOCABULARY and not by the
shape (`props` holds the space-separated string ADR 0049 § 3 chose as the write door, and three
surfaces spell the property three ways). That decision now has three shipped files behind it
instead of none, which makes ADR 0034's ledger countdown the next thing between this repository
and a lossless projection of half its `.blp`.

### The concrete need is outside this repository, and it was measured rather than relayed

Learn6502's `packages/app-gnome/src/views/preferences.dialog.blp` is meant to be the first
Blueprint in that application to reach a second renderer. Projected with this tree, read-only:

| | |
|---|---|
| `template` | `PreferencesDialog` |
| markings carried | **10 of 10** |
| still lost | `value-list` × 6, `extern` × 3, `binding` × 2 |

Two corrections to what that file was said to hold, both from the measurement. A `grep` for
`_(` returns 11; the eleventh is inside a COMMENT, so ten is the live count and all ten are
carried. And the file does NOT project losslessly with the marking closed: its six
`css-classes: [...]` are style classes written as a property rather than as a `styles [ ]`
block, so they leave as `value-list` rather than as `styles` — the same vocabulary gap of § 4
above, reached through a second spelling — and its three `$ThemeModeSelector`-style children
are ADR 0062's blocker 1, `$extern`. So the marking is one of three named pieces between that
file and a second renderer, not the last one.

### The XML exit does not move, and that is measured rather than asserted

`emitGtkBuilderXml` is the authoritative axis: it is what the build compiles and what the
oracle is diffed against. `src/emit-xml.mjs` is untouched by this change, and so are the 68
goldens. Every corpus file re-emitted with the in-repo emitter and the concatenation hashed:
**68 files, 81 224 bytes, SHA-256 `672a7835c51c4c45eb1bb4072867eb6aace5262fac29d93b98e3adf08d4a81b6`
— byte-identical to the same hash over the committed goldens.** Stage C reports the same thing
per file on every run.

## Decision

**The marking gets the field ADR 0058 § 1 wrote, verbatim. ADR 0058 § 2's deferral is taken
back, on ADR 0066's test. `bind` and `breakpoint` stay losses and stay declared, and so does
the file-level `translation-domain`.**

### 1. The field is ADR 0058's, unchanged, and this ADR follows it rather than re-deciding it

```ts
translatable?: Readonly<Record<string, { readonly context?: string }>>;
```

Keyed by the prop name it marks; a present key means marked; `context` carries `C_()`'s
msgctxt. That is `StringValue['translatable']` from `src/ast.d.mts` per key, so the projection
COPIES what the parser read instead of inventing a second value language, and it fills the
field at the exact seam that used to push the loss.

**Beside `props`, not inside it**, for the reason 0058 gave and the corpus confirms: GtkBuilder
writes `translatable="yes" context="noun"` as ATTRIBUTES next to the value
(`corpus/rules/09-translatable.ui`), and a marked value is the same value. Widening `props` to a
marked-value union would make every reader of a value narrow past something that is not one —
in both drivers, in `rebuild()`, and in arm 13.

`{}` is `_()` and `{ context }` is `C_()`. The empty object is "marked, nothing more", never
"unmarked": absence is what says unmarked, which is the same rule `id`, `template` and `slot`
already follow, and it is why `translatable: { label: {} }` beside `props: { label: '…' }` reads
as a claim rather than as a leftover.

Three alternatives were weighed against it and are in § Alternatives rejected. None of them is
better than the one 0058 reached; the field is taken as written.

### 2. ADR 0058 § 2's deferral is taken back, and the test is ADR 0066's

0058 § 2 bounds the field with ADR 0051 Decision 5: nothing is extracted before a second driver
needs it, and neither of the two tree drivers translates anything, so the reader was to be the
`.blp` emitter. ADR 0066 then applied the same rule to `template` and `object-id` and reached
the opposite answer, because it had measured a consumer 0058 had not: **the projection
direction, over real applications.** The reasoning is quoted rather than paraphrased — *"the
projection direction has readers today, and the thing that blocks them is that a converted tree
cannot say what it is."*

That is this field's situation too, and one step worse. A tree whose `template` is missing is
visibly unusable; a tree whose markings are missing is **visibly finished and quietly
unshippable**. ADR 0033's entire reason for preferring a declarative template is that a caption
`xgettext` cannot see is untranslatABLE while merely looking untranslated, and
`templates/gtk-minimal/src/main-window.blp` carries that sentence in its own comments about the
one `_()` it was converted for. A projection that drops the marking turns that conversion back
into the thing it replaced — which is the one loss in this corpus that makes a SUCCESSFUL
conversion wrong rather than incomplete.

**So the field lands with a reader, and it is the same reader ADR 0066 named.** What 0058 § 2
was right about is the failure mode it feared, a field nothing holds; that is answered by § 5
rather than by waiting.

### 3. `bind` and `breakpoint` stay losses, unchanged, and the reasons are ADR 0066 § 3's

- **`bind`** — an expression language (lookups, closures, casts, `template` as a source), and the
  one construct of the set with no consumer on either other surface. A field would be a second
  implementation of a grammar, not a spelling. It is also where the 2 closure-literal markings
  of the census above sit, and they leave with it.
- **`breakpoint`** — `Adw.Breakpoint` is not a widget, so it has no node form at all, and its
  `condition`/`setters` are a second language on top. One marking of the census sits in a
  setter and leaves with the block.

ADR 0053 clause 3's treatment stands for both: a hard error naming its line on any path but
GTK's.

### 4. `translation-domain` is not a node fact and stays a loss

`translation-domain "app";` is at most one per FILE, in one position between the imports and the
first root, and it becomes `domain="…"` on `<interface>`. It occurs once in the whole corpus,
in `rules/54-internal-child-menu-domain.blp`, and that file loses `internal-child` and `menu`
besides — so nothing is unblocked by spelling it.

**But the count is not the reason; the scope is.** The authored-tree shape is a TREE, and the
only place a file fact could go is the root node, where it would be wrong in a way nothing
catches: a subtree lifted into another tree would carry a domain that belongs to a file it is no
longer in, and a renderer translating against the wrong domain is wrong SILENTLY. A field whose
meaning depends on the node it happens to be attached to is the class of mistake ADR 0066 § 1
refused for `tag`, one level up. If a domain is ever needed it belongs beside the tree and not
inside it, which is a decision for whoever brings a consumer for it.

### 5. The field is HELD against the oracle, not against a second hand-written copy

Stage D of `check-blueprint-corpus.mjs` gains a marking arm, built like ADR 0066 clause 4's
addressing arm and for the same reason. For every corpus file it collects the
`translatable="yes"` and `context="…"` attributes the reference compiler wrote on a
`<property>`, and holds them against the markings the projection carries — both directions: a
marking the projection invents is a failure, and a marking the golden writes that the tree does
not carry is a failure.

**Why the golden and not the expectation.** The hand-written trees of ADR 0053 clause 2 pin
which NODE carries which marking, and they are the right first check — but they are written by a
human reading the same file, so the tree and the projection can agree with each other and both
be wrong. This was measured twice rather than assumed, by making the projection wrong and then
"correcting" the expectations to match:

| what was broken | hand-written arm | golden arm |
|---|---|---|
| the `C_()` context dropped, expectation "corrected" | **silent** | red, naming the file and `label (context "noun")` |
| every `tooltip-text` marking swallowed, both trees "corrected" | **silent** | red on both affected files, 5 markings |

**A multiset, and not a position.** The emitter re-orders — GtkBuilder's order for properties
and children is not the source's — so pairing the nth marking in the golden with the nth in the
tree would be a second implementation of that ordering. WHERE each marking sits is what the
hand-written tree pins, node by node; how many there are and with which contexts is what the
oracle pins. Neither arm covers for the other, which is why there are two.

**No escape hatch, and that is deliberate.** The addressing arm has one — an id the golden
writes may be missing if a declared loss NAMES it — because three files need it. No file needs
one here: every marking the goldens write on a `<property>` is one the projection reaches, once
two subtrees are removed first. CDATA goes, for the reason the addressing arm already gives (an
inline `template` is a second document with its own scope), and `<accessibility>` goes, because
it is the ONLY other element GtkBuilder writes a `<property>` inside — measured, 1 of the 27 —
and the projection loses that whole block by its own kind. A hatch beyond those would be a hole
nobody has ever walked through, which passes the first file that needs it instead of making
someone decide.

Stage A gains the structural half beside it: a marking that names no prop of its own node, or
marks a prop whose value is not a string, or carries a field other than `context`, is a failure
naming the node. A marking is ABOUT a value, and one that is about nothing marks nothing.

### 6. Every restatement of the shape grows with it, or the gate says which one did not

`SharedTreeNode` in `packages/web/adwaita-core/src/conformance/shared-trees.ts` is the original,
and `scripts/check-shared-tree-shape.mjs` (#1728) holds every other spelling to it field by
field. This field therefore touches five `holds` restatements, six `apart` deltas and the gate's
own self-test fixtures — and that cost is the point, exactly as ADR 0066 clause 5 said: it is
the proof the shape is one shape rather than a family of near-copies.

`rebuild()` in `scripts/adwaita-gallery-shared-trees.mjs` copies fields by name and is the first
place a new one is silently lost. It copies this one **one level deeper** than the others: a
shallow spread would hand both renderers the same `{ context }` object, which is the aliasing
the function's own comment exists to prevent.

### 7. ADR 0058 is followed on the shape and revised on the timing, and stands everywhere else

Clause 1 is taken verbatim — the spelling, the keying, the position beside `props`, and every
reason given for them. Clause 2 is revised: the field ships now, with the projection as its
reader, on ADR 0066's measurement. Clauses 3 (`slot` stays one field, decided by a lookup with
a guard), 4 (style classes are blocked by the vocabulary, not the shape) and 5 (the portable
values wait for a block blocked by nothing else) are untouched; § 4 above adds three shipped
files to clause 4's evidence without changing its answer. Clause 6's list of refusals loses one
more name, leaving nine.

**Clause 2's fence arm is not superseded, it is not yet reachable.** 0058 asked for a
containment check holding each block's ` ```blueprint ` fence against the markings in the
authored tree. No gallery block authors a marking today, so that arm would be vacuous now; the
oracle arm above holds the field where the field actually occurs. The fence arm stays what 0058
made it — the check for the day the gallery corpus authors one — and the gallery's 40 blueprint
fences stay the unheld artifact 0058 named.

## Consequences

- The loss that made a successful conversion WRONG rather than incomplete is closed. A tree
  converted from a `.blp` now says which of its captions are translatable, so re-emitting it
  cannot silently produce an interface `xgettext` reads as finished.
- `styles` becomes the single remaining cause for three shipped files, where before this change
  no file was blocked by it alone. That moves ADR 0034's vocabulary ledger from "the next thing
  after the shape" to the next thing, full stop — and ADR 0058 § 4 already says the shape is not
  what is in the way.
- A THIRD reader of one file's markings exists. The `.blp`, the `.ui` golden and the projection
  now all state which properties are translatable and with which context, and any two of them
  disagreeing is a failure that names the file.
- The authored-tree shape has a third field no gallery block uses. That is a cost, paid in
  `rebuild()`, in five restatements, in six `apart` deltas and in the gate's own fixtures — all
  machine-held, none of it prose.
- Learn6502's target file stops being blocked on the marking and is blocked on two named,
  sized pieces of work: `$extern` (ADR 0062 blocker 1) and style classes written as a property.
  Measuring it also corrected two claims about it, which is the cheaper half of measuring.
- ADR 0058's title is now two-thirds true: it says twelve losses stay refusals, and nine do.
  The correction is recorded here rather than by editing a dated decision, the same way ADR
  0066 recorded its own.

## Alternatives rejected

- **Wait for the `.blp` emitter, as ADR 0058 § 2 decided.** Defensible for a field whose only
  consumer is the emitter, and it is not this field's situation: the projection direction has
  readers today and this is the one loss under which their output is wrong rather than short.
  Waiting would also leave the shape's THIRD grow-the-shape decision to be taken inside the
  emitter's PR, which is the outcome 0058 § Alternatives rejected warns about in its own last
  line.
- **A list of marked prop names (`translatable?: readonly string[]`).** Smaller and it cannot
  say `C_("noun", …)`. `09-translatable.blp` exists to isolate exactly that construct, so the
  shape would have to be satisfied by changing the corpus file written to test it — and six
  more contexts are already in the corpus behind constructs that leave whole, so the construct
  is common and its reachable count is small for an unrelated reason.
- **`Record<string, string | true>`, the context as the value.** One field shorter to write and
  it conflates two kinds on one key: `true` and `"noun"` are not two values of one thing, and
  every reader would have to `typeof` before using it. It also has nowhere to put a second
  attribute, where the object form does.
- **Fold the marking into `props` as a marked-value union.** The shape 0058 rejected, for the
  reason it gave: it would touch every reader of `props` in both drivers, in `rebuild()` and in
  arm 13, to carry something that is not a value. GtkBuilder's own spelling is an attribute
  beside the value, and the corpus's goldens are 27 examples of that.
- **Carry `translation-domain` on the root node while the shape is open anyway.** Priced in § 4:
  one occurrence, nothing unblocked, and a field whose meaning breaks the moment a subtree is
  lifted — a silent wrongness rather than a visible gap.
- **Take `styles` in the same PR, since three files now need only it.** Tempting and it is a
  different decision with a different owner: ADR 0058 § 4 and ADR 0034's ledger say the obstacle
  is three spellings and two value kinds across three surfaces, not the shape. Putting a fourth
  spelling into the one artifact whose admission rule is "no alias at all" would make the shared
  corpus the place that disagreement is resolved instead of the place it is exposed.
- **Hold the markings against the hand-written trees alone.** It is the check that already
  exists and it cannot catch a marking the projection swallows, because the person correcting
  the expectation is reading the same file. Measured twice in § 5, both times silent.

## What this does not decide

- **Which notation the shared corpus is authored in.** ADR 0051 Decision 1 stands. The price of
  moving is lower again by one loss and is still not zero — `slot` is 12 of 12.
- **`$extern`** — ADR 0062 § Decision 3's next piece of parser work, untouched here.
- **The style-class name or its value kind.** ADR 0034's ledger and its gate's countdown. § 4
  only puts three shipped files behind it.
- **Whether a translation DOMAIN ever gets a home**, and if so whether beside the tree or in the
  artifact that carries it. § 4 refuses the root node and proposes nothing.
- **When the `.blp` emitter is built.** ADR 0058 § 3 and § 7 stand, and the marking is now one
  of the things it would read rather than one of the things it would have to add.
- **Where `SharedNode` lives.** Still open, still forced by the first PR that publishes a
  package producing the projection.

## Implementation

- The field, the projection change, the corpus expectations for the five files that declared a
  `translatable` loss, the stage-D marking arm, the stage-A structural half and the eleven
  restatements are one PR.
- `LOSS_KINDS` in `scripts/check-blueprint-corpus.mjs` and the `LossKind` typedef in
  `corpus/expectations.mjs` lose the name, so declaring the marking as a loss is now itself the
  failure. `translation-domain` deliberately stays on both lists.
- The expectation trees keep their hand-written character: each marking was placed from the
  `detail` prose the corpus already carried — *"the `_()` marking on `Back`"*, with its line —
  onto the node whose prop holds that string, and then cross-checked against both the projection
  and the golden before the entry was finished.
- Follow-ups are tracked in `status/open-todos.md` per governance; this ADR records the *why*.
