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
