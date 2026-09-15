# 62. The Blueprint conversion frontier is composition, not `.ui` files

- Status: **Proposed**
- Date: 2026-09-15
- Deciders: Pascal Garber
- Related: [ADR 0029 (girs widget vocabulary)](0029-girs-widget-vocabulary.md),
  [ADR 0030 (one corpus, GJS as oracle)](0030-one-corpus-gjs-as-oracle.md),
  [ADR 0033 (declarative templates preferred)](0033-declarative-templates-preferred.md),
  [ADR 0051 (one authored tree, rendered)](0051-one-authored-tree-rendered.md),
  [ADR 0053 (Blueprint parsed in-repo)](0053-blueprint-parsed-in-repo.md),
  [ADR 0058 (the translatable marking gets a spelling)](0058-translatable-marking-gets-a-spelling.md)

## Context

ADR 0033 prefers a declared widget tree over an assembled one, and ADR 0053 made Blueprint a
format this repository reads for itself. Neither says how much of the tree is still assembled,
and the question "what should we convert next" has been answered by impression since.

This is the count. It changes what the question is: **there is nothing left to convert in the
format the question assumes.** No `.ui` file in this repository is hand-authored, so the
frontier is TypeScript assembly — and the construct that stops it is not a loss ADR 0058
enumerated. It is a refusal, and the oracle compiles it.

### How the numbers here were obtained

Read at `3c07b817b9` on 2026-09-15, in a worktree of its own, and re-measured against `1bd3159d4b`
in a second worktree before merge: the corpus and loss numbers are unchanged between the two, and
the inventory and assembly tables carry the corrections that second reading produced.

- **The file inventory** is `git ls-files` over the tracked tree, `refs/` excluded by path. The
  five reference pools are other people's repositories and are never a conversion candidate.
- **The shadow run** is `scripts/check-blueprint-corpus.mjs`, all five stages, against
  `blueprint-compiler` 0.20.4 on PATH, with `@girs/{gtk-4.0,adw-1}` at the version
  `packages/infra/blueprint/package.json` pins.
- **The loss census** re-parses all 42 corpus files with `src/parser.mjs` and projects them with
  `src/project.mjs`, grouping the `lost` array by `kind`. ADR 0058 measured 38 files and told its
  reader to re-derive rather than reconcile once #1681 landed. This is that re-derivation.
- **The assembly census** counts, per tracked `.ts`/`.mts`/`.mjs`/`.js` file outside `refs/` and
  outside `*.spec.*`/`*.test.*`/`test/`/`tests/`, constructions matching `new (Gtk|Adw).X(` and
  calls to the 24 parenting methods `prefer-blueprint-template` already lists. Both signals are
  required, for that rule's own stated reason: either alone is ordinary code.
- **The extern-nesting census** (blocker 1) counts `new <C>(` where `<C>` is a class this
  repository registers with `GObject.registerClass`, in a file that also makes one of the same 24
  parenting calls. **Its file scope is NOT the assembly census's**: it spans every tracked
  `.ts`/`.mts`/`.mjs`/`.js`/`.tsx` outside `refs/`, tests and specs INCLUDED, because a test that
  nests a widget needs the same construct a showcase does. Read with tests excluded the same
  measure gives 42 files / 45 sites — so the two censuses below must not be added together.
- **The lint census** runs `gjsify/prefer-blueprint-template` over `packages`, `showcases` and
  `templates` with **every `.oxlintrc.json` override lifted**, which is the only way to see what
  the exemptions are hiding.

**One pin drifted while this was read, and it is the trap the blueprint README already records.**
The root `node_modules` of a long-lived checkout carried `@girs` 4.1.0, which has no
`./vocabulary` subpath at all, while the package pins 5.1.0. A census taken there would have
agreed with itself and with nothing else. Every number below comes from a clean install at the
pinned version.

**And it happened a second time, from the measurement itself.** Simulating #474 below appends one
line to `node_modules/@girs/gtk-4.0/gtk-4.0-vocabulary.js`, and a simulation left in place is
indistinguishable from a release: re-measured in that tree, stage C reports 42 of 42 and the
ledger demands its own deletion, both correct for a version npm does not serve. The pinned
vocabulary is 67 `PROP_ENUMS` rows; a tree that reads 68 has been written to. **Diff the installed
file against the published tarball before believing any number on this page** — the simulation is
undone by restoring that one file, not by re-running the gate.

### The inventory: 42 `.ui`, and not one of them is a template

| what | count | where |
|---|---:|---|
| tracked `.ui` | 42 | **all** under `packages/infra/blueprint/corpus/` — 31 rule goldens, 11 reality-probe goldens |
| tracked `.blp` | 57 | 31 `corpus/rules`, 15 `corpus/refused`, 11 shipped |
| shipped `.blp` (the build compiles) | 11 | see below |
| inline GtkBuilder XML in `.ts`/`.mjs` | 9 files | 6 `packages/node-gi` template tests, `node-gi/example-gtk`, `tests/integration/minify-xml`, `tests/e2e/text-loader` |
| hand-authored `.ui` outside the corpus | **0** | — |

The 11 shipped `.blp`, per package:

| package | `.blp` |
|---|---:|
| `showcases/dom/{canvas2d-fireworks,excalibur-jelly-jumper,three-geometry-teapot,three-loader-ldraw,three-postprocessing-pixel}` | 1 each |
| `showcases/gtk/adw-blueprint-layout` | 2 |
| `showcases/gtk/effect-adw-services` | 1 |
| `templates/{adw-canvas2d,adw-game,adw-webgl}` | 1 each |

Every `.ui` in the tree is a golden the corpus compares against, and the 9 inline-XML sites exist
to TEST GtkBuilder — converting them would delete what they measure. **So the answer to "how many
`.ui` files could convert" is zero, and it is zero because the work is already done.**

### The real frontier is TypeScript, and it is 127 files

| area | files | `new Gtk/Adw.X` | parenting calls | has `.blp` |
|---|---:|---:|---:|---:|
| `showcases/gtk/adwaita-storybook` | 31 | 169 | 98 | 0 |
| `showcases/dom/adwaita-storybook-nativescript` | 24 | 112 | 85 | 0 |
| `examples/dom` | 21 | 81 | 58 | 0 |
| `packages/framework/storybook` | 3 | 51 | 29 | 0 |
| `showcases/gtk/node-gi-window` | 1 | 31 | 23 | 0 |
| `packages/framework/adwaita-app` | 3 | 24 | 18 | 0 |
| `scripts` | 6 | 23 | 30 | 0 |
| `packages/nativescript-bridge/*` | 3 | 14 | 14 | 0 |
| `packages/framework/{gtk-host,react-native,devtools-browser,video,webgl,event-bridge}` | 14 | 46 | 39 | 0 |
| everything else (15 areas) | 21 | 62 | 48 | 5 |
| **total** | **127** | **613** | **442** | **5** |

**And the rule that guards this reports two findings in the whole tree with every exemption
lifted** — `packages/framework/storybook/src/window.ts` and
`packages/framework/video/src/video-bridge.ts`, both library code the rule's own header exempts by
nature. Read naively that says the tree is clean. It says something narrower, and the difference
is the next section.

### `prefer-blueprint-template` visits a class, and the scaffold is not one

`prefer-blueprint-template.ts:243` returns `{ ClassDeclaration: check, ClassExpression: check }`.
A file that assembles a whole window inside a callback is invisible to it, whatever it builds.

**PR #1690 is this finding being closed while this ADR is in review**, so read the paragraph as
the state that produced the decision below rather than as the state of the tree. It teaches the
rule a module-level entry point, converts `templates/gtk-minimal`, and reports a second blindness
this survey did not reach: an `Application` subclass assembling its window in `vfunc_activate`
went unseen as well. Clause 2 of the Decision is therefore already being executed, not proposed.

`templates/gtk-minimal/src/index.ts` is exactly that file: 5 constructions and 3 parenting calls
inside `app.connect('activate', …)`, building a `Gtk.ApplicationWindow` around a `Gtk.Box` with
two labels, one of them the literal `'Hello from gjsify!'`. It is the only one of the four GTK
scaffolds under `templates/` with no `.blp` beside it, and `templates/**` is NOT in the rule's
override list — the rule is enabled there and sees nothing.

**A scaffold is the highest-leverage file in the tree, because a stranger copies it.** This one
teaches hand-assembly and an untranslatable caption, in the repository whose ADR 0033 exists to
prevent both, and it does so under a green lint.

### What a conversion would hit: three constructs, and the first is a refusal

Of the 15 files under `corpus/refused/`, the manifest records the oracle's verdict on each.
**Seven are constructs `blueprint-compiler` COMPILES and the in-repo parser refuses** — those are
gaps, not language errors. The other eight are errors both compilers share and are not obstacles
to anything.

Held against the assembly census, three constructs account for the frontier:

| # | construct | status | what it costs |
|---|---|---|---|
| 1 | `$MyWidget { }` — an extern type as a nested object | **refused**; oracle compiles | 49 files, 58 sites nest a locally-registered class inside a parented tree |
| 2 | a type from a namespace with no vocabulary (`Gio.ListStore`, `Gio.Menu`) | **refused**; oracle compiles | 9 files need a model or a menu inside the tree |
| 3 | `template` + `object-id` + `slot` | not refused — **projection losses** (ADR 0058 § 3, § 6) | 0 of 11 shipped `.blp` round-trip into `SharedNode` |

**Blocker 1 is the wall, and the proof case is the showcase that went furthest.**
`showcases/gtk/adw-blueprint-layout` carries the only two `.blp` written as reusable widgets —
and `src/app.ts:56-75` still composes them in TypeScript, `new GalleryHeaderBar()` and
`new GalleryToolbarView()` into a `Gtk.Box` into `window.set_content(stack)`, because
`$GalleryHeaderBar { }` cannot be written in a `.blp` this repository parses. Declaring a widget
works today; **placing one inside another does not.** Every real Blueprint application does this —
`refs/map-editor` writes `$PixelRpgTeleportOverlay teleports {}` inside `atlas-canvas.blp` — so
the construct is not exotic, it is how Blueprint applications are built past one file.

**Blocker 3 is the one that makes conversion a one-way door.** A `.blp` that carries a
`template`, an object id or a slot cannot be projected back into the shape ADR 0051 renders from,
so every tree converted today is a tree that leaves the shared corpus. ADR 0058 § 6 keeps all
three as refusals on purpose, and § 3 decides `slot` by a GIR lookup rather than a field — but
the lookup's guard is not built, and no inverter exists.

### ADR 0058's census is one kind stale, and the number in its title moved

Re-derived over 42 files (0058 measured 38, and said to re-derive):

| loss kind | occurrences | files (of 42) | of those, real (of 11) |
|---|---:|---:|---:|
| `object-id` | 58 | 17 | 10 |
| `translatable` | 25 | 4 | 3 |
| `template` | 13 | 13 | 11 |
| `binding` | 12 | 5 | 3 |
| `breakpoint` | 9 | 6 | 3 |
| `styles` | 8 | 5 | 2 |
| `signal` | 8 | 3 | 0 |
| `menu` | 3 | 3 | 0 |
| `sibling-object` | 3 | 2 | 0 |
| `value-list` | 2 | 1 | 0 |
| `layout` | 1 | 1 | 0 |
| `accessibility` | 1 | 1 | 0 |
| **`responses`** | **1** | **1** | **0** |
| **total** | **144** | | |

`responses` is new. It was a REFUSAL when 0058 was written — the `Adw.AlertDialog` response flag
the ADR names twice as the one fence the parser rejects outright — and `rules/31-responses.blp`
moved it into the subset as a produced loss. **So 0058's "twelve other losses" are thirteen**, and
its § 6 list of ten hard refusals is eleven. Round-tripping moved too: **7 of 42 project with no
loss and no slot** (0058: 9 of 38), 12 of 42 with the slot lookup, and still **0 of 11** shipped.

**144 is the PROJECTED total and the corpus gate prints 145.** Stage A counts the losses
`expectations.mjs` DECLARES, which include one `comment` on `rules/24-comments.blp`; comments never
reach the AST, so the harness drops that kind before comparing and the projection never emits it.
Fourteen kinds are declared, thirteen are produced. Neither number is wrong and they are not the
same measure — this table is the projected one, because it is the one a conversion would lose.

This is not an error in 0058. It is the cost of a census stated as a constant, which 0058's own
method section predicted in as many words.

### The shadow run is one line from silent, and the last line retires on a version bump

Stage C, at the pinned `@girs` 5.1.0:

> 42 corpus files: **41 byte-equal, 1 ledgered across 1 cause and 1 named line**

The one line is `rules/29-enum-non-widget.blp:10` — `Gtk.SizeGroup { mode: horizontal; }` emits
`horizontal` where the oracle writes `1`, because `PROP_ENUMS` was keyed by the widget vocabulary
and `GtkSizeGroup` is not a widget.

**ts-for-gir #474 closes it, and this was measured rather than believed.** Simulating the single
row #474 adds — `PROP_ENUMS['GtkSizeGroup.mode'] = 'GtkSizeGroupMode'`, joined to the
`ENUM_VALUES['GtkSizeGroupMode.horizontal'] = 1` that 5.1.0 already ships — and re-running the
gate produces:

> `rules/29-enum-non-widget.blp` is byte-equal and still listed in `corpus/divergences.mjs` as
> "prop-enums-widgets-only". Delete the entry — a ledger that only grows describes a parser
> nobody improved.

The self-retiring ledger fires exactly as designed. **No parser change is needed: the resolver
already reads `PROP_ENUMS`, and the table simply gains rows.** A version bump and one deleted
entry take stage C to 42 of 42 and make ADR 0053 clause 5's flip available.

### What #474 does NOT unblock, and this is the part worth stating plainly

**Nothing for conversion.** #474 widens which DECLARATIONS carry vocabulary data inside a
namespace that already has one — Gtk-4.0 `PROP_ENUMS` 67 → 126, Adw-1 37 → 50. Its own commit
message records that the namespace-level gate is untouched: a namespace emits a vocabulary only
if it declares a concrete `GtkWidget` descendant, **142 of 705 GIRs before and after**.

Measured at 5.1.0: `@girs/gtk-4.0/vocabulary` and `@girs/adw-1/vocabulary` resolve;
`@girs/gio-2.0/vocabulary`, `@girs/glib-2.0/vocabulary` and `@girs/gdk-4.0/vocabulary` are
`ERR_PACKAGE_PATH_NOT_EXPORTED`. #474 also adds no syntax, so blocker 1 is untouched.

**Blocker 2 was re-measured at 5.2.0 rather than extrapolated to it, and it held.** The published
`@girs/gio-2.0@5.2.0` tarball declares no `./vocabulary` subpath in its `exports` and ships no
vocabulary file — the same answer 5.1.0 gives. **So `Gio.ListStore` in a `model:` stays refused
after 5.2.0**, and it is refused for the namespace, not for the class.

**@girs 5.2.0 is publishing as this lands, and it is half-published.** `gio-2.0` is already at
5.2.0 while `gtk-4.0` and `adw-1` — the two this package pins — still end at 5.1.0. That is the
ordinary shape of a `@girs` release, alphabetical and so roughly reverse-topological, and it is
why the bump is its own PR: a pin to a version npm does not yet serve fails every runner.

## Decision

**Convert nothing yet. Build `$extern` first, and land the `@girs` bump when 5.2.0 publishes.**

### 1. No template conversion lands in the next release

Not because it is unwelcome, but because the two candidates are the wrong size. The 127 assembly
files are, with one exception, stories, demos, tests, renderers and harnesses — exempt by
`prefer-blueprint-template`'s own doctrine, which is written down and correct: a widget written
for someone else to place has no application interface to declare. Converting a renderer to
Blueprint would be converting the thing that READS Blueprint.

And the exception is blocked. Anything larger than one window needs `$MyWidget { }`, which is
blocker 1.

### 2. `templates/gtk-minimal` converts today, and it is one file

It needs no refused construct: a `Gtk.ApplicationWindow` root, a `Gtk.Box` child, two labels, one
`styles ["title-2"]`. The runtime caption (`process.platform`, `process.pid`) stays in TypeScript
— that is the data-driven pattern the rule's header calls intended, not a violation.

**It lands with the mechanism, never alone.** `prefer-blueprint-template` visits only a class, so
converting this file fixes the instance and leaves the class of bug — the next scaffold written as
a callback is equally invisible. The rule gains a second entry point for a module-level assembly
site, or the conversion is not worth taking. **PR #1690 takes it on those terms**, and found a
third entry point needed on the way: a `vfunc_activate` inside an `Application` subclass.

### 3. `$extern` is the next piece of parser work, and it is a feature, not a conversion

It is one of seven constructs the oracle compiles and this parser refuses, it is the one that 49
files and 58 sites need, and it is the one stopping the repository's own best Blueprint showcase
from composing its two widgets. It also has an oracle to be held against on every run, which is
the property ADR 0030 § 5 asks of any parser change.

### 4. The `@girs` 5.2.0 bump lands as its own PR, and deletes the ledger entry with it

Two lines in `packages/infra/blueprint/package.json` and one entry removed from
`corpus/divergences.mjs`. The gate already refuses the bump without the deletion, which is why
these are one commit and not two.

**What it earns is governance, not behaviour.** A silent stage C is what ADR 0053 clause 5 waits
for, and clause 7's demotion of `blueprint-compiler` to oracle-only becomes a deletion list that
can actually be written. Nothing a user sees changes.

### 5. ADR 0058's census is corrected where it stands, not superseded

`responses` joins the produced kinds; twelve becomes thirteen; 9-of-38 becomes 7-of-42. Every
decision 0058 takes survives the correction — the `translatable` field, the `slot` lookup, the
style-class reasoning and the ten-now-eleven refusals are all unaffected, because none of them
rests on the count.

## Consequences

- "Convert more templates to Blueprint" stops being an open-ended task and becomes one file plus
  one parser feature, both sized.
- The frontier moves from a FORMAT question to a COMPOSITION question, which is a different and
  smaller thing to build.
- A green lint is named as incomplete rather than trusted: two findings tree-wide with every
  exemption lifted reads as "clean" and means "keyed on a class".
- `templates/gtk-minimal` is named as the scaffold that teaches the pattern this repository's
  ADRs exist to prevent. That is a finding this ADR produces and does not close.
- The shadow run's distance to silent is a number for the first time — one file, one line — and
  the retirement path is measured rather than promised.

## Alternatives rejected

- **Convert the showcases now.** 17 of 24 showcases have no `.blp`, which looks like the backlog.
  Most author their trees in JSX, Vue SFCs or Solid — a different notation over the same
  vocabulary, which ADR 0053's own § Context says is on Blueprint's LEVEL rather than below it.
  Converting them would replace one declarative form with another and prove nothing.
- **Convert `packages/framework/storybook/src/window.ts`** — the largest single site at 38
  constructions, and the rule's own finding. It is a harness whose job is to instantiate other
  people's widgets; its tree is data-driven by construction, which is the case the rule's header
  promises is silent.
- **Bump `@girs` to 5.2.0 in this PR.** It is not published. A pin to a version npm does not serve
  fails every runner, and pinning ahead of a publish is the shape `girs-partial-publish-window`
  already cost a session.
- **Add `$extern` support in this PR.** This is the survey that decides what to convert; a parser
  feature inside it would be the shape ADR 0058 § 7's last alternative names — a decision taken
  inside the PR that found it convenient.
- **Do nothing and revisit after the emitter.** Defensible for the SHAPE question, which ADR 0058
  already defers. It is not defensible for `templates/gtk-minimal`, which ships to strangers on
  every release and needs no shape decision at all.

## What this does not decide

- **Whether `$extern` is spelled the way `blueprint-compiler` spells it.** It has an oracle;
  the PR that builds it reads the oracle.
- **When the `.blp` emitter is built.** Unchanged from ADR 0058 § 7.
- **Whether the gallery's 40 blueprint fences become generated or held.** ADR 0058 clause 2 named
  them as an unheld artifact and this ADR does not close it either.
- **Which notation the shared corpus is authored in.** ADR 0051 Decision 1 stands.
- **Whether `Gio` should get a vocabulary.** That is ts-for-gir's namespace gate, and #474
  deliberately left it alone. The case for changing it is blocker 2 and it is nine files.

## Implementation

- This ADR lands alone. No conversion, no parser change, no version bump.
- The `@girs` 5.2.0 bump plus the `corpus/divergences.mjs` deletion is one PR, after 5.2.0 is on
  npm. `scripts/check-blueprint-corpus.mjs` is the whole test: it already fails the bump without
  the deletion.
- `templates/gtk-minimal` converts in a PR that also teaches `prefer-blueprint-template` to see a
  module-level assembly site, with the scaffold as its fixture. That PR is **#1690**, already open.
- `$extern` is its own PR against `corpus/refused/extern-type.blp`, promoting it to a rule file
  with a golden, per ADR 0053 clause 6.
- Follow-ups are tracked in `status/open-todos.md` per governance; this ADR records the *why*.
