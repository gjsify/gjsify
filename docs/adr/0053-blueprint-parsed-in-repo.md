# 53. Blueprint is parsed in-repo, into the node shape ADR 0051 already renders

- Status: **Accepted**
- Date: 2026-09-10
- Deciders: Pascal Garber
- Related: [ADR 0002 (bootstrap bundle minimization)](0002-bootstrap-bundle-minimization.md), [ADR 0028 (widget table provenance)](0028-widget-table-provenance.md), [ADR 0029 (girs widget vocabulary)](0029-girs-widget-vocabulary.md), [ADR 0030 (one corpus, GJS as oracle)](0030-one-corpus-gjs-as-oracle.md), [ADR 0033 (declarative templates preferred)](0033-declarative-templates-preferred.md), [ADR 0034 (widget vocabulary convergence)](0034-widget-vocabulary-convergence.md), [ADR 0049 (style classes are a list)](0049-style-classes-are-a-list.md), [ADR 0051 (one authored tree, rendered)](0051-one-authored-tree-rendered.md)

## Context

Two things are true at once in this repo and have not been connected. ADR 0033 enforces
that a widget tree is DECLARED rather than assembled, and on GTK the declarative form is
Blueprint. ADR 0051 authors one tree that both renderers build, and it does NOT use
Blueprint: its corpus is a plain object tree in GIR class names, `SharedNode { tag, slot?,
props?, children? }` (`scripts/adwaita-gallery-shared-trees.d.mts:23-28`), chosen because
that spelling is the one both renderers already carry, and authoring in either renderer's
markup would make one of them the reference and the other a translation.

Read quickly, that reasoning rules Blueprint out. Read carefully, it does not — because it
is about a different LEVEL. GIR is the vocabulary. Blueprint and `SharedNode` are both
NOTATIONS over that vocabulary. `adw-*` elements and GtkBuilder XML are the runtime formats
underneath them. Blueprint is not a runtime format: it compiles TO GtkBuilder XML, which
puts it on `SharedNode`'s level rather than one below it.

### What the eleven `.blp` files actually use

Measured across every `.blp` tracked in this repo, 2026-09-10:

| Blueprint | count | `SharedNode` | GIR-derived? |
|---|---|---|---|
| `using Adw 1;` | 22 | carried by the class name | yes — namespace and version |
| `Adw.HeaderBar { }` | 81 | `tag: 'AdwHeaderBar'` | yes — the GIR type |
| `title: "…"` | 197 | `props: { title: '…' }` | yes — a ParamSpec |
| `[start]`, `[end]`, `[top]`, `[bottom]`, `[center]`, `[breakpoint]` | 23 | `slot: 'start'` | yes — ADR 0029 § 4 derives slot candidates from GIR |
| `content: Adw.ToolbarView { }` | 19 | a child carrying `slot: 'content'` | yes — a ParamSpec, read as a slot |
| `styles ["flat"]` | 5 | `cssClasses: ['flat']` | yes — ADR 0049 decided style classes are a list |
| `template $Foo: Adw.Bin` | 11 | — | **no** — a GtkBuilder composite-template declaration |
| `Gtk.Box canvasContainer { }` | 41 of those | — | **no** — a GtkBuilder object id |
| `_("Back")` | 23 | — | **no** — a `translatable` attribute on the emitted XML |
| `bind …` | 6 | — | **no** — a GObject property binding, addressed by id |
| `condition (…)` + `setters { }` | 6 + 6 | — | **no** — `Adw.Breakpoint`'s own grammar |

Zero signal handlers (`=>`), zero `menu` blocks and zero inline `Gtk.Adjustment` objects.

Six construct classes stand outside `SharedNode`, and they are not all the same kind of
outside. `template` is not even a tree construct: it is a file-level statement that this
tree IS the template of a class. An object id is addressing, and it is what `bind` resolves
against — a notation with no ids cannot express `bind` at all, which is why those two fall
together. `_()` is the one that costs: the VALUE survives as a `SharedNode` string and the
translatable MARKING does not, and that marking is the whole reason ADR 0033 prefers a
template — a caption `xgettext` cannot see is untranslatABLE while merely looking
untranslated.

The gap runs the other way too. `SharedNode.props` admits `string | number | boolean` and
nothing else, so none of the portable values ADRs 0042, 0046 and 0047 introduced — a menu
model, a list model, an adjustment — can appear in a shared tree today. Blueprint writes
all three as inline objects. Neither notation contains the other.

### What the external compiler costs

Blueprint reaches the build by shelling out to GNOME's `blueprint-compiler`, and placing
that binary is platform-shaped work rather than an install line. Finding it takes 268 lines
(`packages/infra/vite-plugin-blueprint/src/resolve-compiler.ts`) plus a 237-line spec
against a plugin whose work is 75: on Windows the only route is an MSYS2 install — the tool
is pure Python but reads typelibs through `GIRepository`, so it needs a PyGObject that
publishes no Windows wheel — which ships it as a shebang script Windows cannot execute, and
whose typelibs then collide with the gjsify GTK runtime bundle's own.

The cost lands where the rule is enforced. Eleven `.blp` exist in the tree and NONE is under
`packages/`. `packages/framework/adwaita-app/src/loading-stack.ts:12-25` records a `.blp`
written and REVERTED — the compiler is absent on the macOS and Windows runners, and
library-mode Blueprint arrives only in 0.43.0, so a cold bootstrap from the published CLI
(ADR 0002) hands the `.blp` to rolldown's JavaScript parser, where `using Gtk 4.0;` reads as
a using declaration with no initializer. It carries the single line-level
`oxlint-disable gjsify/prefer-blueprint-template` in the repo.
`packages/framework/storybook/src/window.ts:13-15` builds its window programmatically for
the neighbouring reason it states itself: the blueprint plugin runs for `--app` bundles and
not for `--library`, so a published library cannot rely on it — and `.oxlintrc.json` scopes
that whole package off the rule rather than suppressing it per line. And
`scripts/check-doc-fences.mjs` returns `blueprint-compiler is not on PATH` (`:368-369`) and
skips the whole fence class wherever the binary is missing. The skip is announced rather
than silent, and the arm is real in exactly one place — the `tree-checks` job, whose
ci-fedora image bakes the compiler — so every other run of that script proves nothing about
the fences.

## Decision

**Blueprint is parsed in this repo, in TypeScript, and it parses INTO `SharedNode` — the
node shape ADR 0051's renderers already consume. `blueprint-compiler` stops being a build
dependency and becomes the oracle the parser is measured against.**

1. **The parser produces a full AST, and `SharedNode` is a DECLARED PROJECTION of it.** One
   representation cannot serve both halves of this ADR: clause 4 wants byte-equal GtkBuilder
   XML, which needs every construct the census found, and `SharedNode` carries none of the
   six. So the AST is the parser's output, the XML is emitted from the AST, and the
   projection is a second, LOSSY exit whose losses are exactly those six — named at the seam
   rather than discovered downstream. Blueprint thereby becomes a second READER of the shape
   ADR 0051's renderers consume, and NOT a second authoring surface: 0051 Decision 1 keeps
   `ADWAITA_GALLERY_SHARED_TREES` the corpus, and no block of it originates from a `.blp`
   while that decision stands.

2. **That equivalence is PROVED, not asserted.** The mapping table above is a reading of two
   notations, and a reading is not a measurement. For every `.blp` in the corpus a
   hand-written `SharedNode` tree states what it should parse to, and the parser is held to
   it. Until that suite exists the equivalence is not claimed anywhere — not in docs, not in
   a review. ADR 0051 § Alternatives rejected turned down a translator between two markup
   vocabularies on a measurement; the projection in clause 1 is a translator in one
   direction, so it carries that burden of proof rather than an exemption from it.

3. **Scope is a SUBSET, and an unrecognised construct is a hard error naming its line.**
   Never a silent pass-through: output that looks plausible and means something else is the
   defect a hand-written parser most easily introduces. `template`, object ids, `_()`,
   `bind` and `Adw.Breakpoint`'s `condition`/`setters` are the constructs the census found
   outside `SharedNode`; they are accepted only on the GTK path, where GtkBuilder gives them
   meaning, and refused with that reason anywhere else.

4. **`blueprint-compiler` proves the emitted GtkBuilder XML, and nothing built from the AST
   afterwards.** A byte-equal diff proves the parser and the AST it produced. It is not
   evidence about the `SharedNode` projection, about a renderer, or about anything else
   downstream, and it must not be cited as such — in review or in a job summary. Stating the
   claim narrowly now is cheaper than retracting it later, when the parser is long correct
   and something downstream is not. What the diff does NOT retire is the other use ADR 0028
   § 6 makes of the same binary: validation against the installed typelib, which a parser
   reading into a tree does not perform. `Gtk.Box { spacinng: 4; }` parses cleanly into a
   prop nothing rejects until a ParamSpec lookup at runtime. The compiler keeps that role
   wherever it is present.

5. **The parser runs in SHADOW until it is silent.** `blueprint-compiler` stays
   authoritative for the build; the in-repo parser runs beside it and reports every
   divergence, and becomes authoritative when it reports none across the corpus. The shadow
   run is also what grows clause 3's subset — each divergence is the next unit of work — and
   after an upstream release, a shadow run that starts reporting again IS the upgrade notice.

6. **The corpus is WRITTEN, not collected.** One small `.blp` per language rule, checked in,
   no third-party licensing to track, complete on every runner — plus the eleven real files
   as a reality probe. A sweep over third-party `.blp` may be a LOCAL extra; it must never
   become the part of the corpus CI lacks, or the run that gates the merge checks less than
   the run on a laptop. Per ADR 0030 § 5 an exemption is DATA, never a code path: a tolerated
   divergence is a ledger entry, never an `if` inside the parser.

7. **Done is a deletion, not a feature list.** This work is complete when these are gone:
   `resolve-compiler.ts` and its spec — 505 lines that exist only to find a binary and
   explain its absence — the line-level `oxlint-disable` in `loading-stack.ts`, and the
   MSYS2 branch of `gjsify system-check`. `check-doc-fences.mjs`'s skip does not vanish but
   becomes TWO-STAGE: the parse arm runs everywhere, the typelib arm wherever clause 4's
   compiler is present, and the report names which of the two ran. `@gjsify/storybook`'s
   programmatic window is a DIFFERENT item — `.oxlintrc.json` scopes that whole package off
   the rule, so what it needs is a scoping decision and not a deletion. Until the parser is
   authoritative no library package gains a `.blp`; porting continues where the compiler
   already runs, in showcases, apps and templates. A parser that adds a package without
   removing the rest has not finished — it has forked.

## Consequences

- ADR 0028 § 6 keeps `blueprint-compiler` as validation against the installed typelib, and
  clause 4 leaves that role untouched. What changes is only its position: it stops being
  something a bundle needs in order to build and becomes something the tests and one CI arm
  need, which is where an oracle belongs.
- `check-doc-fences.mjs`'s blueprint arm becomes real off the ci-fedora image for the half a
  parser can answer, and `loading-stack.ts`'s line-level suppression is deleted rather than
  re-argued.
- Clause 1 gives the shared corpus a second front door without touching its source of truth.
  What it does NOT give is a reason to move the corpus: `SharedNode` stays the authored form
  until something measures that Blueprint serves it better.
- Clause 2 will find disagreements. The mapping table is a claim about slots, object-valued
  properties and `styles` that nothing has run, and the honest expectation is that the first
  suite moves at least one row of it.
- The translatable marker is the sharpest case under clause 3, and it points back at ADR
  0033: parsing a caption into a `SharedNode` string drops the one attribute that made the
  template worth preferring. Either the shape grows a spelling for it or the GTK path keeps
  the marker on its own — decided by the ADR that needs it, not here.
- A parser for a language this project does not own is a maintenance surface, and clause 5
  keeps its cost continuously visible instead of surfacing it at the next GNOME release.
- The subset is a real limit while it lasts: a `.blp` using a construct the parser has not
  reached fails loudly under clause 3. That is the intended trade against silent wrong
  output, and clause 5 means the build is unaffected until the parser is authoritative.

## Alternatives rejected

- **Keep `blueprint-compiler` and install it on every runner.** Consistent, and pays the
  Windows and macOS toolchain cost twice — once now, once again the next time a library
  package wants a template. It cannot fix the cold-bootstrap case at all, where the
  transform does not exist yet regardless of what is installed.
- **An AST with no declared projection.** Simpler to write, and it makes Blueprint a
  parallel pipeline whose agreement with the shared corpus nothing checks — a second truth
  of exactly the kind ADR 0030 § 2 refuses, arrived at from a new direction. Clause 1 keeps
  the AST and makes the projection the thing that is tested.
- **Full language parity before anything is usable.** Maximises what the differential test
  proves and delays every deletion in clause 7 behind the language's least-used corners.
- **Passing unknown constructs through unchanged.** Never blocks, always builds, produces
  output that is plausible and wrong — discovered at runtime, in a shipped program.
- **Checking in the compiled GtkBuilder XML beside each `.blp`.** Removes the build
  dependency immediately and puts a generated artifact in the tree that drifts from its
  source at the first forgotten regeneration.
- **Collecting the corpus from third-party `.blp` under `refs/`.** Authoring effort near
  zero, and those pools are read-only submodules a CI checkout does not initialise. Measured
  on this working checkout: 95 pool directories, none of them Blueprint's, and not one
  `.blp` between them.

## What this does not decide

- **Which notation the shared corpus is authored in.** ADR 0051 chose `SharedNode` with a
  reason this ADR does not touch. Clause 1 adds a second reader of that shape; it does not
  propose replacing the first, and a change of the authored form would be a supersession of
  0051 with its own measurement to bring.
- **The build-from-one-source horizon.** ADR 0051 Decision 6 leaves it open deliberately.
  ADR 0034 § 8 is not neutral about the neighbouring translator question, and this ADR does
  not overturn it either: write the tree ONCE in the vocabulary that runs and emit the
  dialects, rather than translating between two hand-written surfaces. A parser makes `.blp`
  READABLE, which is a different question from what a tree is written in or what surfaces it
  reaches.
- **Whether `.blp` becomes an EMITTED dialect of the corpus.** That direction needs no parser
  and is a separate decision; the two are independent and either can land first.
- **Whether `SharedNode` grows to hold the portable values** of ADRs 0042, 0046 and 0047, or
  a translatable marker. Its props are scalars today, so a Blueprint inline object has no
  shared spelling — clause 3 refuses it, and widening the shape belongs to the ADR that
  needs it.
- **Whether the parser is ever published for use outside this repo.** It is a build-time tool
  here first; a public contract carries its own upstream question.

## Implementation

- The first PR carries the written corpus, the `SharedNode` expectations of clause 2 and the
  shadow harness — not a parser already claiming a subset. A harness with nothing to compare
  reports green while proving nothing.
- The parser is a package of its own; `@gjsify/vite-plugin-blueprint` becomes its consumer
  and keeps its public interface, so no showcase changes when the authority flips.
- **Where `SharedNode` lives is the first unresolved question, and it comes before any
  parser code.** Today the type is a hand-written `scripts/adwaita-gallery-shared-trees.d.mts`
  whose own header refuses a second transcript of the tree. A package that produces the
  projection needs that type somewhere a package can import, and neither copying it nor
  moving it out of `scripts/` is free.
- ADR 0028 § 6 turned down an in-repo Blueprint VALIDATOR, on the measured grounds that
  building one would duplicate a better tool for no gain. This is a compiler replacement and
  clause 4 explicitly leaves validation to the tool 0028 chose — but it is an adjacent
  question 0028 closed, and a reviewer should find that named here rather than discover it.
- No AGENTS.md change lands with this ADR: nothing here changes a rule an agent follows
  today. The rule changes belong to the PR that earns them — the lint suppression and the
  fence gate's skip path both go when clause 7 is satisfied.
- Follow-up work is tracked in `status/open-todos.md` per governance; this ADR records the
  *why*.

## Amendment 1, 2026-09-11 — emission needs introspection too, and it comes from `@girs`

**Clause 4 reserved the installed typelib for VALIDATION. That reservation was too narrow:
EMISSION needs a lookup of its own, and it is answered from the `@girs` vocabulary — a pinned
npm dependency — not from a typelib. The typelib keeps validation; the GIR takes emission.**

Clause 4 said validation is "what a parser reading into a tree does not perform", which is
true and does not cover the other exit. `orientation: vertical` does not reach the XML as
`vertical`: the reference compiler writes `<property name="orientation">1</property>`, and
`halign: center` is `3` (`corpus/rules/03-property-enum.ui`). Nothing in the syntax carries
those numbers. Written as the ADR's own cost estimate had it, the emitter could only pass the
identifier through, and eleven of the corpus files diverged on twenty-three lines under that
one cause.

**Two lookups, and only one of them was available.** The integer behind a nick was readable
from the installed typelib, and `packages/framework/gtk-host/src/generated/enum-values.mts`
already held all three numbers these files needed. The lookup that was missing is the one
before it: WHICH enum `GtkBox.orientation` is. Searching the nick lists for an enum with a
member called `never` finds several, and guessing between them is the silent-wrong-output
clause 3 exists to prevent — so the divergences stayed, with the ledger recording that they
were waiting on a fact and not on effort.

**The fact shipped upstream.** `ts-for-gir`
[#465](https://github.com/gjsify/ts-for-gir/pull/465) put `ENUM_VALUES` in the vocabulary
(`@girs` 4.8.0) and [#467](https://github.com/gjsify/ts-for-gir/pull/467) added `PROP_ENUMS`,
the join from a property to its enum type (4.9.0). `PROP_ENUMS` is keyed by the type that
DECLARES the property, the way `OWN_PROPS` is, so the walk goes through `DECLS` — the
flattened ancestry and interface list the vocabulary already ships — which is how
`GtkBox.orientation` is found on `GtkOrientable`. `packages/infra/blueprint/src/resolve-ident.mjs`
performs both lookups and the emitter takes it through the one seam it already had.

**Why `@girs` and not the typelib, now that the emitter needs introspection at all.** The
shadow run of clause 5 has no skip path and runs on EVERY runner, including the ones with no
GNOME on them — that property is the reason the goldens are committed. A resolver reading a
typelib would have needed a GNOME runtime and would have reintroduced exactly the hole
`--require-oracle` closes one stage over: a gate reporting green because it could not run.
The vocabulary is a dependency, present wherever `gjsify install` has run, and it is generated
from the same GIR as the nicks, so the artifact carries one provenance instead of two.

**Measured, both directions.** With the resolver in place every corpus file is byte-equal —
the silence clause 5 names — and `corpus/divergences.mjs` is an empty list with its rules
intact. The numbers were also read back against the independent oracle: of the 737 values in
gtk-host's typelib-read table, 736 agree with `@girs` 4.9.0 and the single disagreement is the
documented version gap (`GtkEditableProperties.num-properties` is 8 on the installed GTK
4.22.4 and 10 in the GIR of 4.23.3), while `@girs` fills the two entries the generating host
had to declare unavailable. Two independent readings of the library agree; where they do not,
the reason is named.

**What the corpus learned on the way, each one measured on 0.20.4 and none of it guessed.**
A member is spelled with UNDERSCORES in Blueprint and with hyphens in the GIR, so
`halign: baseline_fill` is `4` and `halign: baseline-fill` is an error. A flag set is NOT
numbered: `input-hints: word_completion | lowercase` stays `word-completion|lowercase`, which
is why the seam returns text rather than a number. And neither `layout { }` nor
`accessibility { }` resolves through the widget — the first belongs to the layout child, the
second to the ARIA table — so both pass the source spelling through and the a11y half is a
declared gap rather than a decision.

**What this changes for clause 4, exactly.** Its first sentence stands: a byte-equal diff
proves the parser and the AST, and nothing downstream. Its last paragraph gains a second
half — the compiler keeps validation, and the GIR, reached through `@girs`, answers emission.

**What it does not change.** Clause 6 still holds: the resolver is DATA plus one seam, not an
`if`. An unknown member of a known enum throws, naming the line, the property, the enum and
the member, because passing it through would be output that looks plausible and means
something else. And clause 7's deletion list is now due rather than done: every corpus file
being byte-equal is the condition clause 5 sets, so the demotion of `blueprint-compiler` to
oracle-only is the next piece of work and is tracked in `status/open-todos.md`.
