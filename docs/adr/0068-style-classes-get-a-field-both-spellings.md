# 68. Style classes get a field, and it carries both of Blueprint's spellings for them

- Status: **Proposed**
- Date: 2026-09-22
- Deciders: Pascal Garber
- Related: [ADR 0033 (declarative templates preferred)](0033-declarative-templates-preferred.md),
  [ADR 0034 (widget vocabulary convergence)](0034-widget-vocabulary-convergence.md) § 8,
  [ADR 0049 (style classes are a list)](0049-style-classes-are-a-list.md),
  [ADR 0051 (one authored tree, rendered)](0051-one-authored-tree-rendered.md),
  [ADR 0053 (Blueprint parsed in-repo)](0053-blueprint-parsed-in-repo.md),
  [ADR 0058 (the translatable marking gets a spelling)](0058-translatable-marking-gets-a-spelling.md),
  [ADR 0062 (the conversion frontier is composition)](0062-the-blueprint-conversion-frontier-is-composition.md),
  [ADR 0066 (composition gets a spelling)](0066-composition-gets-a-spelling-template-and-object-id.md),
  [ADR 0067 (the translatable marking becomes a field)](0067-the-translatable-marking-becomes-a-field.md)

## Context

ADR 0067 § 4 ended with a finding rather than a decision: *"Three files are now blocked by
`styles` ALONE, and that is the finding worth carrying forward."* Before that change no shipped
`.blp` was blocked by style classes alone — the translatable marking always sat beside them, so
closing them would have moved nothing and no measurement could see it.

This ADR takes that finding and closes it, and the reason it is a separate decision is that
0067's own § Alternatives rejected refused to take it in the same PR: *"ADR 0058 § 4 and ADR
0034's ledger say the obstacle is three spellings and two value kinds across three surfaces, not
the shape."* That sentence is answered below, measured rather than argued, and one half of it
turns out to be wrong about what the reference compiler writes.

### How the numbers here were obtained

Read on 2026-09-22 in a worktree of its own, on `feat/shared-node-next-loss`, which sits on
`feat/shared-node-translatable` (#1736) and not on `main`.

- **The loss census** parses every corpus file with `packages/infra/blueprint/src/parser.mjs`,
  projects it with `src/project.mjs` and groups the returned `lost` array by `kind` — the same
  reading stage D of `scripts/check-blueprint-corpus.mjs` holds per line on every run. Taken
  twice in the same tree, once before the change and once after. It also asks a question no
  earlier census asked: **for each kind, how many files does it block ALONE** — files whose whole
  `lost` array is that one kind, so that closing it takes the file to nothing.
- **The bracketed-value census** walks every corpus AST for a property whose value is a
  bracketed list and records it BY PROPERTY NAME, which is what separated the two spellings
  below. A census keyed on the loss kind could not have: the projection named one of them after
  a property and the other after everything else.
- **The oracle half** is `blueprint-compiler` 0.20.4 on PATH and the committed `.ui` goldens,
  with `@girs/{gtk-4.0,adw-1,…}` at the versions `packages/infra/blueprint/package.json` pins —
  5.4.0, from a clean install in this worktree, with `PROP_ENUMS` at the count the published
  tarball ships rather than one a simulation had written to.
- **The shape census** is `scripts/check-shared-tree-shape.mjs`, which sweeps every tracked
  source for the authored-tree shape and holds each declaration to the original field by field.

Read every count below as a date. The harness prints the live ones on every run, and those are
the ones to believe.

### Which family moves the most, asked of every one of them

Every loss kind the projection still produced before this change, over the whole corpus and over
the shipped `.blp` alone. The last column is the one that decided this ADR: how many files have
NO other loss kind, so that closing this one family takes them to zero.

| kind | occurrences | files | of those, shipped | blocks ALONE | of those, shipped |
|---|---:|---:|---:|---:|---:|
| `binding` | 53 | 12 | 3 | 6 | **0** |
| `styles` | 9 | 6 | 3 | 5 | **3** |
| `extern` | 8 | 6 | 0 | 4 | 0 |
| `breakpoint` | 11 | 8 | 3 | 3 | 0 |
| `sibling-object` | 11 | 6 | 0 | 3 | 0 |
| `menu` | 6 | 6 | 0 | 2 | 0 |
| `layout` | 2 | 2 | 0 | 2 | 0 |
| `responses` | 2 | 2 | 0 | 2 | 0 |
| `signal` | 8 | 3 | 0 | 1 | 0 |
| `value-list` | 2 | 1 | 0 | 1 | 0 |
| `inline-template` | 1 | 1 | 0 | 1 | 0 |
| `action-widget` | 3 | 1 | 0 | 0 | 0 |
| `accessibility` · `marks` · `mime-types` · `patterns` · `suffixes` · `items` · `offsets` · `translation-domain` · `internal-child` | 1 each | 1 each | 0 | 0 | 0 |

**`styles` is the only family in the table that moves the headline number at all.** Nothing else
blocks a single shipped file on its own: the other three shipped files with a loss each carry
`binding` AND `breakpoint`, so neither of those two alone would move one either, and both are
refusals ADR 0066 § 3 and ADR 0067 § 3 already decided to keep.

**The raw count points somewhere else, and that is the reason the last column exists.** `binding`
is 53 occurrences to `styles`'s 9 and blocks the most corpus files alone — and it would take six
written rule files to a lossless projection while taking not one shipped file there. A census
that ranks by occurrences would have picked the grammar this repository has twice decided not to
implement.

### The `styles` contradiction, resolved: there are two constructs, and the census saw one

ADR 0053 § Context carries a mapping table with the row `` styles ["flat"] `` → ``
cssClasses: ['flat'] `` marked GIR-derived, and reading it beside 0067's "blocked by `styles`
alone" is a genuine contradiction. It resolves three ways at once, and the third is new.

**First: that table is a PROPOSAL, not a reading.** It was written before `src/project.mjs`
existed, and `corpus/expectations.mjs` finding 2 already records the row as the one ADR 0053 §
Consequences predicted would move — *"the honest expectation is that the first suite moves at
least one row of it"*. `SharedNode` never had a `cssClasses` field.

**Second: the NAME in that row is wrong independently of the field.** ADR 0049 § 1 measured
`cssClasses` fatal on NativeScript: `@nativescript/core`'s `ViewBase` declares it as a live
`Set<string>`, assigns it in its constructor, rebuilds it on every `className` write and reads it
from its CSS engine, so a subclass accessor shadows the assignment and the first write throws
`cssClasses.has is not a function`. 0049 chose `styleClasses` for that reason, and this ADR takes
that name rather than inventing one.

**Third, and this is the part nothing had measured: Blueprint has TWO spellings for this one GTK
property, and the projection named their losses differently, so no census showed the family
whole.**

| what the source writes | what the oracle writes | the loss the projection took | corpus |
|---|---|---|---:|
| `styles ["flat", "circular"]` — a block | `<style><class name="flat"/><class name="circular"/></style>` | `styles` | 9 |
| `css-classes: ["flat", "narrow"]` — a property value | `<property name="css-classes">flat⏎narrow</property>` | `value-list` | 1 |

Both set `GtkWidget:css-classes`. So the family is 10 occurrences over 7 files, and every
sentence written about it so far — including 0067 § 4's — counted 9 over 6. The split is not an
error in the projection: its own comment says a loss is named after the spelling the file used,
which is right for a reader. It is an error in reading a per-kind census as a per-family one.

**And the newline is the measurement that decides the field's TYPE.** ADR 0058 § 4 says the shape
is not the obstacle because *"`props` already holds the space-separated string ADR 0049 § 3 chose
as the write door"*. The oracle joins the property spelling with `\n`, not with a space. A joined
string in `props` would therefore have to pick one join and could not be held against the golden
where the oracle picked the other — so the space-joined `props` key is not merely unappealing,
it is unholdable against half the family. A LIST can be held against both patterns, which is
what § 5 below does.

### 0067's objection, answered where it is right and where it is not

0067 refused this change because it would *"put a fourth spelling into the one artifact whose
admission rule is no alias at all"*. That is a claim about `props`, and about ADR 0051's rule for
admitting a gallery BLOCK to the shared corpus. It does not reach a field.

| | `props` key | a field beside `props` |
|---|---|---|
| what it is | a name all three renderers must read off one node | a named structural fact whose renderer-side spelling is the DRIVER's mapping |
| three spellings on three surfaces are | three aliases, which ADR 0051 refuses | what `slot`, `id`, `template` and `translatable` already are |
| precedent | — | `slot`: GTK writes `<child type="start">`, the web writes `slot="start"`, and nobody called it an alias |

**And the ledger's countdown is measured to be untouched rather than asserted to be.**
`check-generated-website-data.mjs` arm 11 reports the same verdicts after this change as before:
**24 blocks drawn by both renderers, 7 from one authored tree, 17 ledgered as divergent.** No
gallery block authors a style class through this field, so no block is admitted by it, ADR 0034's
ledger loses no entry, and the two halves ADR 0058 § 4 names — a converged NAME and a converged
VALUE KIND on the ported widgets — are exactly as open as they were. What closes here is the
PROJECTION's ability to say what a file wrote, which is ADR 0066's test and not 0051's.

### What the change moves

| | before | after |
|---|---:|---:|
| shipped `.blp` that project with NO loss | 6 of 12 | **9 of 12** |
| corpus files that project with no loss | 25 of 68 | **30 of 68** |
| losses the projection takes, corpus-wide | 125 | **115** |
| loss KINDS a shipped `.blp` still reaches | 3 | **2** |

The three that go clean are `showcases/gtk/adw-blueprint-layout/src/{header-bar,toolbar-view}.blp`
and `templates/gtk-minimal/src/main-window.blp`. **The first two are the pair ADR 0062 named as
its proof case** — the only `.blp` in this repository written as reusable WIDGETS rather than as
windows, and the ones whose TypeScript still composes them by hand. The third is the scaffold ADR
0062 named as teaching the pattern ADR 0033 exists to prevent, and it now projects with nothing
left but its comments, which are the one loss no projection can ever take.

What stops the other three, after this change, is unchanged and is `binding` plus `breakpoint` on
each of `canvas2d-fireworks`, `three-geometry-teapot` and `three-postprocessing-pixel`. Neither
is a spelling: § 3 keeps both refused, on the reasons their own ADRs gave.

### The concrete need is outside this repository, and it was measured rather than relayed

Learn6502's `packages/app-gnome/src/views/preferences.dialog.blp` is meant to be the first
Blueprint in that application to reach a second renderer. Projected with this tree, read-only:

| | before | after |
|---|---|---|
| `template` | `PreferencesDialog` | `PreferencesDialog` |
| markings carried | 10 of 10 | 10 of 10 |
| still lost | `value-list` × 6, `extern` × 3, `binding` × 2 | **`extern` × 3, `binding` × 2** |

**All six of that file's `value-list` losses were `css-classes: [...]`, the property spelling**,
which is the half of the family this repository's own shipped files never write — theirs are 9
blocks and no property. So a change that had closed only the block spelling would have closed the
family for this repository and left it entirely open for the application the work is for. That is
the measurement behind § 2's "one field, both spellings", and it is the reason the bracketed-value
census was keyed on the property name.

Of that file's eleven losses, six close here, three are `extern` and two are `binding`. So this is
the family that brings it nearest, `$extern` is next, and `binding` is the one it will keep.

### The XML exit does not move, and that is measured rather than asserted

`emitGtkBuilderXml` is the authoritative axis: it is what the build compiles and what the oracle
is diffed against. `src/emit-xml.mjs` is untouched by this change, and so are the 68 goldens and
the 68 `.blp`. Every corpus file re-emitted with the in-repo emitter and the concatenation hashed:
**68 files, 81 224 bytes, SHA-256
`672a7835c51c4c45eb1bb4072867eb6aace5262fac29d93b98e3adf08d4a81b6` — byte-identical to the same
hash over the committed goldens, and the same hash ADR 0067 recorded.** Stage C reports the same
thing per file on every run.

## Decision

**Style classes get a field on the authored-tree node, named `styleClasses`, typed as a list, and
filled from BOTH Blueprint spellings of `GtkWidget:css-classes`. `bind` and `breakpoint` stay
losses and stay declared. ADR 0058 § 4's answer is revised; its diagnosis of ADR 0034's ledger is
not.**

### 1. One field, a list, beside `props`

```ts
styleClasses?: readonly string[];
```

In the order the source wrote them, which is the order the golden writes them in.

**A LIST and not a joined string**, because the oracle joins the property spelling with a newline
and the block spelling not at all. ADR 0049's title says a widget carries a list of these and its
§ 3 gives a string-taking DOOR on a widget; those are not in conflict, they are a setter and a
read-back. A tree is neither — it is the authored fact — and the authored fact is the list, which
is the only form comparable against both patterns the oracle writes.

**BESIDE `props` and not inside it**, for the reason § Context measures: a key in `props` is a
name three renderers read off one node, and three surfaces spell this property three ways. A
field's renderer-side spelling is the driver's mapping, which is where those three names already
live, and it is the arrangement `slot` has had since ADR 0051.

**`styleClasses` and not `cssClasses`**, on ADR 0049 § 1's measurement. This introduces no fourth
name: it is the name that decision already chose, and this field is its third reader.

### 2. The field carries both spellings, and that is what makes it worth taking

`styles [ ]` and `css-classes: [ ]` fill the same field through one reader, `styleClassesOf` in
`src/project.mjs`, which both the projection and the loss census ask. **One reader and not two
copies of the condition**: a class the tree KEEPS while the census also declares its line lost
would make stage D's two arms contradict each other about one file, which is a failure mode with
no message that names it.

Measured, this is not symmetry for its own sake: the shipped `.blp` here write 9 blocks and 0
properties, and the outside file this work is for writes 6 properties and 0 blocks. One spelling
would have been a closed family on one side of the boundary and an open one on the other.

Where one node writes both, the classes CONCATENATE in source order. They are one property, so
the node carries the union the file wrote; no corpus file writes both, and declaring a winner
would be a rule nothing holds.

**A non-string item is not a style class.** `styles [ flat ]` parses in this package and
`blueprint-compiler` refuses it outright ("Unexpected tokens"); `css-classes: [flat]` is refused
by this package's own emitter. So an ident in either position is a construct with no oracle
behind it, and it leaves as `value-list` — the kind for a bracketed value the shape cannot hold —
rather than under a `styles` kind that nothing else would ever produce.

### 3. `bind` and `breakpoint` stay losses, unchanged, on their own ADRs' reasons

- **`bind`** — an expression language (lookups, closures, casts, `template` as a source), and the
  one construct of the set with no consumer on either other surface. A field would be a second
  implementation of a grammar, not a spelling. It is the largest family by occurrences and it
  blocks no shipped file alone, which is the shape the table in § Context exists to show.
- **`breakpoint`** — `Adw.Breakpoint` is not a widget, so it has no node form at all, and its
  `condition`/`setters` are a second language on top.

ADR 0053 clause 3's treatment stands for both: a hard error naming its line on any path but
GTK's. So does it for the seven kinds no shipped file reaches, and for the file-level
`translation-domain`, which ADR 0067 § 4 keeps a loss because it is a fact about a FILE.

### 4. `value-list` stays, and it is now the kind to read carefully

The name survives the change and means less than it did. What still leaves through it is a
bracketed value that is NOT a style class: `widgets [ ]` holds object REFERENCES, which are not
values `props` can hold and whose objects leave with the ids they were declared under, and
`strings [ ]` emits as `<items>` rather than as a property at all. One occurrence is left in the
corpus, on `rules/21-value-array.blp`, and it is that file's only remaining loss.

`styles` leaves `LOSS_KINDS` and the `LossKind` typedef, so declaring it is now itself the
failure — the same mechanism ADR 0066 and ADR 0067 used for the three names before it.

### 5. The field is HELD against the oracle, not against a second hand-written copy

Stage D of `check-blueprint-corpus.mjs` gains a style-class arm, built like ADR 0066 clause 4's
addressing arm and ADR 0067 clause 5's marking arm, and for the same reason. **It reads two
patterns**, because the oracle writes one property two ways: `<class name="…"/>` inside a
`<style>` block, and the newline-separated text of a `<property name="css-classes">`. Their union
is the golden's answer for a file, and it is held against the classes the projection carries —
both directions: a class the projection invents is a failure, and one the golden writes that no
node carries is a failure.

**Why the golden and not the expectation.** The hand-written trees of ADR 0053 clause 2 pin which
NODE carries which class, and they are the right first check — but they are written by a human
reading the same file, so the tree and the projection can agree with each other and both be
wrong. Measured twice, by making the projection wrong and then "correcting" the expectations to
match:

| what was broken | hand-written arm | golden arm |
|---|---|---|
| the last class of every list swallowed, all 7 files' expectations "corrected" | **silent, 0 findings** | red on all 7, naming the class left behind on each |
| the `css-classes:` spelling dropped, that file's tree and loss list "corrected" | **silent** | red, naming `[flat, narrow]` |

The second row is the one worth keeping: it is the spelling this repository's own files never
write and the outside target writes six times, so it is precisely the half a hand-written
expectation has the least reason to notice.

**A multiset, and not a position**, for the reason the marking arm already gives: the emitter
re-orders, so pairing the nth class in the golden with the nth in the tree would be a second
implementation of GtkBuilder's ordering. WHERE each class sits is what the hand-written tree
pins; how many there are and which they are is what the oracle pins.

**No escape hatch**, deliberately, as with the marking arm. CDATA is removed first — an inline
`template` is a second document with its own scope. `<accessibility>` is NOT removed, because
GtkBuilder writes no `<style>` and no `css-classes` inside one, and an exemption for a subtree
that cannot hold the thing would be a hole with no subject.

Stage A gains the structural half beside it: a `styleClasses` that is not a non-empty array of
whitespace-free names is a failure naming the node. The empty list is refused because absence is
what says a node carries none — the rule `id`, `template`, `slot` and `translatable` already
follow — and whitespace is refused because ADR 0049 § 3's door is space-separated, so a name with
a space in it is two classes on every surface that writes it.

### 6. Every restatement of the shape grows with it, or the gate says which one did not

`SharedTreeNode` in `packages/web/adwaita-core/src/conformance/shared-trees.ts` is the original,
and `scripts/check-shared-tree-shape.mjs` (#1728) holds every other spelling to it field by
field. This field touches five `holds` restatements, six `apart` deltas and the gate's own
self-test fixtures — and that cost is the point, exactly as ADR 0066 clause 5 and ADR 0067 clause
6 said before it.

`rebuild()` in `scripts/adwaita-gallery-shared-trees.mjs` copies fields by name and is the first
place a new one is silently lost. It copies this one **one level deeper**, like the marking: a
shallow spread would hand both renderers the same class ARRAY, which is the aliasing that
function's own comment exists to prevent.

### 7. ADR 0058 § 4 is revised on its answer and stands on its diagnosis

§ 4 says style classes stay out and that the obstacle is the vocabulary rather than the shape.
**The diagnosis is kept**: the obstacle to a gallery BLOCK joining the shared corpus is still
three names and two value kinds on three surfaces, this change admits no block, and arm 11's
verdicts are measured unchanged. **The answer is revised**, on ADR 0066's test, which 0067
applied before this: the projection direction has readers today, and what blocks them is that a
converted tree cannot say what the file wrote. § 4's one factual claim — that a space-joined
string in `props` would do — is contradicted by the oracle's newline join, and that is recorded
here rather than by editing a dated decision.

Clauses 1, 2, 3 and 5 of ADR 0058 are untouched. Clause 6's list of refusals loses one more name,
leaving eight.

## Consequences

- The last loss any shipped `.blp` in this repository reaches that is not a GRAMMAR is closed.
  What is left on the three files that still lose something is `bind` and `Adw.Breakpoint`, each
  a language rather than a construct, and each refused by a decision of its own.
- **ADR 0062's proof case is unblocked at the shape.** `adw-blueprint-layout`'s two reusable
  widgets now project losslessly, so the thing stopping that showcase from composing them in
  Blueprint is exactly ADR 0062 blocker 1, `$extern`, with nothing else beside it.
- Learn6502's target file stops being blocked on six of its eleven losses and is blocked on two
  named, sized pieces of work: `$extern` and `bind`.
- A THIRD reader of one file's style classes exists. The `.blp`, the `.ui` golden and the
  projection now all state them, and any two of them disagreeing is a failure that names the file.
- **A per-kind census is now known to be able to hide a family.** One construct with two source
  spellings produced two loss kinds, and every count written about `styles` — in this ADR series
  and in `status/open-todos.md` — was one occurrence short because of it. The bracketed-value
  census keyed on the property name is the instrument that found it, and it is the reading to
  repeat before the next family is chosen.
- The authored-tree shape has a fourth field no gallery block uses. That is a cost, paid in
  `rebuild()`, in five restatements, in six `apart` deltas and in the gate's own fixtures — all
  machine-held, none of it prose.
- ADR 0058's title is now half-true: it says twelve losses stay refusals, and eight do. The
  correction is recorded here rather than by editing a dated decision, as ADR 0066 and ADR 0067
  each recorded their own.

## Alternatives rejected

- **`binding`, the largest family.** 53 occurrences, 12 files, and the most corpus files blocked
  alone — and 0 shipped files blocked alone. It is an expression language with lookups, closures
  and casts, and the only construct in the set with no consumer on either other surface. Taking
  it would be implementing a grammar for one renderer inside a shape whose other two readers
  cannot evaluate it.
- **`extern`, ADR 0062's blocker 1.** Four corpus files blocked alone, zero shipped, and it is
  the family the outside target needs NEXT — three of its five remaining losses. It is the right
  next piece of work and it is the wrong one to take here, because its measured effect on the
  headline number is zero: no shipped `.blp` carries a nested `$Extern`. It also is not a
  spelling question the way this one is. The parser and the emitter already handle it — the
  golden for `rules/32-extern-nested.blp` writes `<object class="GalleryHeaderBar">` — so what is
  open is that `SharedNode.tag` promises a GIR class name and an application class is in no GIR.
  That is a decision about what a tag MEANS, and it deserves its own measurement.
- **Put a space-joined string in `props` under some key.** ADR 0058 § 4's own suggestion, and the
  cheapest change available: no shape growth, no restatements, no gate. It is refused on a
  measurement rather than on taste — the oracle joins the property spelling with `\n` and writes
  the block spelling as elements, so a single joined string cannot be held against both, and the
  arm in § 5 could not exist. It would also put a fourth NAME into `props`, which is the objection
  ADR 0067 raised and the one a field does not have.
- **Take only the `styles [ ]` block.** It is the whole family inside this repository — 9 of the
  10 occurrences and all 3 shipped files — and it would leave the property spelling losing as
  `value-list`, which is 6 of the 11 losses on the file this work is for. Closing a family for
  the corpus and leaving it open for the consumer is the shape a per-kind census produces and a
  per-family one prevents.
- **Take only `css-classes: [ ]`, since it is the spelling the outside file uses.** One corpus
  occurrence, one corpus file, zero shipped files, and it would leave `styles` a live loss kind
  on three shipped files. The two are one GTK property; splitting them by source spelling inside
  the shape would make the shape describe Blueprint's syntax rather than the widget.
- **Wait for ADR 0034's ledger to converge the name first.** The position ADR 0058 § 4 and ADR
  0067 took, and the reason it is not taken again: the ledger's subject is a PROPERTY on two
  ported widget surfaces, and this field is not one. Measured — arm 11's verdicts are identical
  before and after, so the countdown neither shortens nor lengthens, and waiting would buy
  nothing while leaving three shipped files and one outside application short.
- **Spell the field `cssClasses`, matching the GIR name and `gtk-host`.** It reads better, it is
  what ADR 0053's table wrote, and ADR 0049 § 1 measured it fatal: `@nativescript/core` owns the
  name as a live `Set` its CSS engine reads, and a subclass accessor throws on the first
  `className` write. A shape field that one of three surfaces cannot map is worse than a name
  that reads slightly less well on the other two.
- **Carry the classes as a `Set` rather than a list.** It matches one surface's read-back and
  loses the ORDER, which the goldens write and which the arm in § 5 compares. The order is also
  the only thing that makes the concatenation rule in § 2 well defined.
- **Do nothing: three shipped files and one outside file is a small number.** It is the scope
  brake, and it was applied to every other family in the table — each of which moves zero shipped
  files. Three of twelve is the largest effect available from any single family, and after this
  change the remaining families' effect on the shipped number is zero until a grammar is
  implemented.

## What this does not decide

- **`$extern`** — ADR 0062 § Decision 3's next piece of parser work, and what `SharedNode.tag`
  means for a class in no GIR. Untouched here, and named as the next family.
- **The style-class NAME or VALUE KIND on the ported widget surfaces.** ADR 0034's ledger and its
  gate's countdown, measured unchanged by this change. ADR 0049 § 1 is implemented on neither
  port yet, and this field does not implement it.
- **Whether any gallery block ever authors a style class.** It would be the first block to, and
  it would then meet ADR 0051's admission rule, `check-generated-website-data`'s attribute kinds
  and ADR 0049 § 3's string door — three things this ADR deliberately leaves where they are.
- **Which notation the shared corpus is authored in.** ADR 0051 Decision 1 stands. The price of
  moving is lower again by one family and is still not zero — `slot` is 12 of 12.
- **When the `.blp` emitter is built.** ADR 0058 § 3 and § 7 stand, and style classes are now one
  of the things it would read rather than one of the things it would have to add.
- **Where `SharedNode` lives.** Still open, still forced by the first PR that publishes a package
  producing the projection.

## Implementation

- The field, the projection change, the one reader both seams ask, the corpus expectations for
  the seven files that declared one of the two losses, the stage-D style-class arm, the stage-A
  structural half and the eleven restatements are one PR.
- `LOSS_KINDS` in `scripts/check-blueprint-corpus.mjs` and the `LossKind` typedef in
  `corpus/expectations.mjs` lose `styles`, so declaring it is now itself the failure.
  `value-list` deliberately stays on both lists, with what it still means written down.
- `corpus/expectations.mjs`'s finding 2 is rewritten where it stands, for the second time: it
  first said the shape was the obstacle, ADR 0058 § 4 corrected that to the vocabulary, and both
  readings are wrong about what the oracle writes. The record keeps both corrections, because a
  finding produced by reading a decision's title rather than its clause reads exactly like a
  measurement.
- The expectation trees keep their hand-written character: each class was placed from the `detail`
  prose the corpus already carried — *"the style class `flat` on the menu button"*, with its line
  — onto the node whose property holds it, and then cross-checked against both the projection and
  the golden before the entry was finished.
- Follow-ups are tracked in `status/open-todos.md` per governance; this ADR records the *why*.
