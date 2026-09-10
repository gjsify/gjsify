# 53. Blueprint is parsed in-repo, into the node shape ADR 0051 already renders

- Status: **Accepted**
- Date: 2026-09-10
- Deciders: Pascal Garber
- Related: [ADR 0002 (bootstrap bundle minimization)](0002-bootstrap-bundle-minimization.md), [ADR 0028 (widget table provenance)](0028-widget-table-provenance.md), [ADR 0029 (girs widget vocabulary)](0029-girs-widget-vocabulary.md), [ADR 0030 (one corpus, GJS as oracle)](0030-one-corpus-gjs-as-oracle.md), [ADR 0033 (declarative templates preferred)](0033-declarative-templates-preferred.md), [ADR 0051 (one authored tree, rendered)](0051-one-authored-tree-rendered.md)

## Context

Two things are true at once in this repo and have not been connected. ADR 0033 enforces that a
widget tree is DECLARED rather than assembled, and on GTK the declarative form is Blueprint.
ADR 0051 authors one tree that both renderers build, and it does NOT use Blueprint: its corpus is
a plain object tree in GIR class names, `SharedNode { tag, slot?, props?, children? }`
(`scripts/adwaita-gallery-shared-trees.d.mts:23-28`), chosen because that spelling is the one both
renderers already carry, and authoring in either renderer's markup would make one of them the
reference and the other a translation.

Read quickly, that reasoning rules Blueprint out. Read carefully, it does not — because it is
about a different LEVEL. GIR is the vocabulary. Blueprint and `SharedNode` are both NOTATIONS
over that vocabulary. `adw-*` elements and GtkBuilder XML are the runtime formats underneath
them. Blueprint is not a runtime format: it compiles TO GtkBuilder XML, which puts it on
`SharedNode`'s level rather than one below it.

### What the eleven `.blp` files actually use

Measured across every `.blp` tracked in this repo, 2026-09-10: `using` 22, `template` 13, child
slots `[start]`/`[end]` 23, `styles` 5, `bind` 6 — and ZERO signal handlers, menu blocks or inline
`Gtk.Adjustment` objects. Against `SharedNode` that census maps almost entirely:

| Blueprint | `SharedNode` | GIR-derived? |
|---|---|---|
| `using Adw 1;` | carried by the class name | yes — namespace and version |
| `Adw.HeaderBar { }` | `tag: 'AdwHeaderBar'` | yes — the GIR type |
| `title: "…"` | `props: { title: '…' }` | yes — a ParamSpec |
| `[start]` | `slot: 'start'` | yes — ADR 0029 § 4 derives slot candidates from GIR |
| `styles ["flat"]` | `cssClasses: ['flat']` | yes — ADR 0049 decided style classes are a list |
| `template $Foo: Adw.Bin` | — | **no** — a GtkBuilder composite-template declaration |
| `bind …` | — | **no** — a GObject property binding |

Two constructs stand outside, and `template` is not even a tree construct: it is a file-level
statement that this tree IS the template of a class. So the distance between the two notations is
two constructs and a packaging concern, not a vocabulary.

The gap runs the other way too. `SharedNode.props` admits `string | number | boolean` and nothing
else, so none of the portable values ADRs 0042, 0046 and 0047 introduced — a menu model, a list
model, an adjustment — can appear in a shared tree today. Blueprint writes all three as inline
objects. Neither notation contains the other.

### What the external compiler costs

Blueprint reaches the build by shelling out to GNOME's `blueprint-compiler`, and that binary is
not placeable on the hosts this project supports. Finding it takes 268 lines
(`packages/infra/vite-plugin-blueprint/src/resolve-compiler.ts`) plus a 237-line spec against a
plugin whose work is 75: on Windows the only route is an MSYS2 install that ships the tool as a
shebang script Windows cannot execute, whose typelibs then collide with the gjsify GTK runtime
bundle's own.

The cost lands where the rule is enforced. Eleven `.blp` exist in the tree and NONE is in a
library package. `packages/framework/adwaita-app/src/loading-stack.ts:12-25` records a `.blp`
written and REVERTED — the compiler is absent on the macOS and Windows runners, and library-mode
Blueprint arrives only in 0.43.0, so a cold bootstrap from the published CLI (ADR 0002) hands the
`.blp` to rolldown's JavaScript parser, where `using Gtk 4.0;` reads as a using declaration with
no initializer. It carries the single `oxlint-disable gjsify/prefer-blueprint-template` in the
repo. `packages/framework/storybook/src/window.ts:13-15` builds its window programmatically for
the same reason. And `scripts/check-doc-fences.mjs` returns `blueprint-compiler is not on PATH`
(`:368-369`) and skips the whole fence class wherever the binary is missing — a gate reporting
green because it could not run.

## Decision

**Blueprint is parsed in this repo, in TypeScript, and it parses INTO `SharedNode` — the node
shape ADR 0051's renderers already consume. `blueprint-compiler` stops being a build dependency
and becomes the oracle the parser is measured against.**

1. **The parser's output is `SharedNode`, not a private AST.** Blueprint becomes a second
   authoring surface over the shape that already exists, rather than a parallel pipeline beside
   it. This is what makes the parser worth more than a toolchain swap, and it is also the
   constraint that keeps it honest: a construct with no `SharedNode` spelling has nowhere to go.

2. **That equivalence is PROVED, not asserted.** The mapping table above is a reading of two
   notations, and a reading is not a measurement. For every `.blp` in the corpus a hand-written
   `SharedNode` tree states what it should parse to, and the parser is held to it. Until that
   suite exists the equivalence is not claimed anywhere — not in docs, not in a review.

3. **Scope is a SUBSET, and an unrecognised construct is a hard error naming its line.** Never a
   silent pass-through: output that looks plausible and means something else is the defect a
   hand-written parser most easily introduces. `template` and `bind` are the two constructs the
   census found outside `SharedNode`; they are accepted only on the GTK path, where GtkBuilder
   gives them meaning, and refused with that reason anywhere else.

4. **`blueprint-compiler` is the oracle for the emitted GtkBuilder XML, and for NOTHING ELSE.** A
   byte-equal XML diff proves the parser and the tree it produced. It is not evidence about
   anything built from that tree afterwards, and it must not be cited as such — in review or in a
   job summary. The claim is narrow, and stating it narrowly now is cheaper than retracting it
   later, when the parser is long correct and something downstream is not.

5. **The parser runs in SHADOW until it is silent.** `blueprint-compiler` stays authoritative for
   the build; the in-repo parser runs beside it and reports every divergence, and becomes
   authoritative when it reports none across the corpus. The shadow run is also what grows clause
   3's subset — each divergence is the next unit of work — and after an upstream release, a
   shadow run that starts reporting again IS the upgrade notice.

6. **The corpus is WRITTEN, not collected.** One small `.blp` per language rule, checked in, no
   third-party licensing to track, complete on every runner — plus the eleven real files as a
   reality probe. A sweep over the vendored `.blp` under `refs/` may be a LOCAL extra; it must
   never become the part of the corpus CI lacks, or the run that gates the merge checks less than
   the run on a laptop. Per ADR 0030 § 5 a tolerated divergence is DATA, never an `if` inside the
   parser.

7. **Done is a deletion, not a feature list.** This work is complete when these are gone:
   `resolve-compiler.ts` and its spec — 505 lines that exist only to find a binary — the
   `oxlint-disable` in `loading-stack.ts`, the programmatic window in `@gjsify/storybook`, the
   `not on PATH` skip in `check-doc-fences.mjs`, and the MSYS2 branch of `gjsify system-check`.
   Until the parser is authoritative no library package gains a `.blp`; porting continues where
   the compiler already runs, in showcases, apps and templates. A parser that adds a package
   without removing those has not finished — it has forked.

## Consequences

- ADR 0028 keeps `blueprint-compiler` as external validation against the installed typelib. That
  role is unchanged, and clause 4 narrows rather than removes it: it stops being something the
  build needs and becomes something the tests need, which is where an oracle belongs.
- `check-doc-fences.mjs` can stop skipping, and the `prefer-blueprint-template` rule becomes
  enforceable where it currently cannot be. Its one suppression is deleted rather than re-argued.
- Clause 1 gives the shared corpus a second front door without touching its source of truth. What
  it does NOT give is a reason to move the corpus: `SharedNode` stays the authored form until
  something measures that Blueprint serves it better.
- Clause 2 will find disagreements. The mapping table is a claim about `[start]` and `styles`
  that nothing has run, and the honest expectation is that the first suite moves at least one row
  of it.
- A parser for a language this project does not own is a maintenance surface, and clause 5 keeps
  its cost continuously visible instead of surfacing it at the next GNOME release.
- The subset is a real limit while it lasts: a `.blp` using a construct the parser has not
  reached fails loudly under clause 3. That is the intended trade against silent wrong output,
  and clause 5 means the build is unaffected until the parser is authoritative.

## Implementation

- The first PR carries the written corpus, the `SharedNode` expectations of clause 2 and the
  shadow harness — not a parser already claiming a subset. A harness with nothing to compare
  reports green while proving nothing.
- The parser is a package of its own; `@gjsify/vite-plugin-blueprint` becomes its consumer and
  keeps its public interface, so no showcase changes when the authority flips.
- No AGENTS.md change lands with this ADR: nothing here changes a rule an agent follows today.
  The rule changes belong to the PR that earns them — the lint suppression and the fence gate's
  skip path both go when clause 7 is satisfied.
- Follow-up work is tracked in `status/open-todos.md` per governance; this ADR records the *why*.

## Alternatives rejected

- **Keep `blueprint-compiler` and install it on every runner.** Consistent, and pays the Windows
  and macOS toolchain cost twice — once now, once again the next time a library package wants a
  template. It cannot fix the cold-bootstrap case at all, where the transform does not exist yet
  regardless of what is installed.
- **A private AST instead of `SharedNode`.** Simpler to write and it makes Blueprint a parallel
  pipeline whose agreement with the shared corpus nothing checks — the arrangement ADR 0029 § 4
  rejects, arrived at from a new direction.
- **Full language parity before anything is usable.** Maximises what the differential test proves
  and delays every deletion in clause 7 behind the language's least-used corners.
- **Passing unknown constructs through unchanged.** Never blocks, always builds, produces output
  that is plausible and wrong — discovered at runtime, in a shipped program.
- **Checking in the compiled GtkBuilder XML beside each `.blp`.** Removes the build dependency
  immediately and puts a generated artifact in the tree that drifts from its source at the first
  forgotten regeneration.
- **Collecting the corpus from the vendored `.blp` under `refs/`.** The largest corpus for no
  authoring effort, and CI does not have those pools.

## What this does not decide

- **Which notation the shared corpus is authored in.** ADR 0051 chose `SharedNode` with a reason
  this ADR does not touch. Clause 1 adds a second reader of that shape; it does not propose
  replacing the first, and a change of the authored form would be a supersession of 0051 with its
  own measurement to bring.
- **The build-from-one-source horizon.** ADR 0051 Decision 6 and ADR 0034 § 8 both leave it open
  deliberately. A parser makes `.blp` READABLE, which is a different question from what a tree is
  written in or what surfaces it reaches.
- **Whether `.blp` becomes an EMITTED dialect of the corpus.** That direction needs no parser and
  is a separate decision; the two are independent and either can land first.
- **Whether `SharedNode` grows to hold the portable values** of ADRs 0042, 0046 and 0047. Its
  props are scalars today, so a Blueprint inline object has no shared spelling — clause 3 refuses
  it, and widening the shape belongs to the ADR that needs it.
- **Whether the parser is ever published for use outside this repo.** It is a build-time tool
  here first; a public contract carries its own upstream question.
