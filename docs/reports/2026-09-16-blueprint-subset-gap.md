# The Blueprint subset against real `.blp` — 2026-09-16

ADR 0053 clause 5 runs the in-repo parser in SHADOW until it is silent, and clause 3 makes
anything outside its subset a hard error naming the construct and its line. `corpus/divergences.mjs`
is empty, so the flip to authoritative (ADR 0063, reserved) is unblocked — and an empty ledger is a
measurement over the corpus this repository WROTE, never a statement about the language. The corpus
says so itself.

So this report asks the question the corpus cannot: **what happens when the parser meets a `.blp`
nobody here wrote?** It is measurement and plan only. No parser code was written for it.

## Method, and what the oracle is

**The reference implementation is `blueprint-compiler` 0.20.4, and it was not obtained from
`refs/`.** It is not pinned there: the pool holds 95 upstreams and none of them is Blueprint's, which
ADR 0053 § Alternatives rejected already recorded. It is the Fedora 44 package
(`blueprint-compiler-0.20.4-1.fc44.noarch`, `/usr/bin/blueprint-compiler`) — the same version
`corpus/manifest.mjs` records as `ORACLE`, and the same one the `ci-fedora:44` image installs, so
every number here is reproducible on the one CI job that carries the binary.

**It was used as a black box.** Every fact below comes from RUNNING it — its exit status, its error
text, and the XML it writes — never from reading its source into ours. `blueprint-compiler` is
GPL-family and this repository is not; what an implementation ACCEPTS and what it EMITS are facts
about the language, and the corpus compares bytes against it anyway.

Two corpora, neither checked in (see § What the corpus needs):

| corpus | files | what it is |
|---|---:|---|
| the wild | 273 | `.blp` from eight projects, one of them this studio's own: `refs/epiphany` (37), `refs/Gradia` (21), `refs/showtime` (4), `refs/troll` (4), `refs/map-editor` (38), Workbench demos (103), Muzika (58), GNOME Decibels (8) |
| the language | 95 | every `.blp` under `tests/samples/` in `blueprint-compiler` 0.20.4 — not real-world, but the language's definition by example |

`refs/map-editor` is JumpLink's own and is counted separately where it matters. Each file was parsed
and emitted through `src/parser.mjs` + `src/emit-xml.mjs` + `src/resolve-ident.mjs` at `@girs` 5.2.0,
compiled by the oracle, and the two outputs compared byte for byte.

### Every source, pinned — and the script that redoes all of it

`scripts/blueprint-wild-sweep.mjs` is in this commit, and every number below is what it prints —
with one exception named where it stands: § 1's six-and-nine split over `corpus/refused/` is a
hand re-run against the manifest, which `check-blueprint-corpus.mjs` stage B is the gate for.
It carries the list of sources itself, one commit each: the five that are submodules of this
repository are verified against the gitlink and cloned if the tree does not have them, and the
four that are not are shallow-cloned at their exact sha into a cache outside the repository
(`--cache-dir`, default `$XDG_CACHE_HOME/gjsify/blueprint-wild-sweep`). ADR 0053 clause 6 is why
the files are not here and the sweep is.

| pool | upstream | commit |
|---|---|---|
| Workbench demos | `https://github.com/workbenchdev/demos.git` | `ca4bc5c2681cfd909c7f5787c11059351c0179f9` |
| Muzika | `https://github.com/vixalien/muzika.git` | `032b880e6a5da2f4ddd501c95ca21e7b67cfa6d0` |
| `refs/map-editor` | `https://github.com/PixelRPG/map-editor.git` | `e835c417089e900b3d2f56f13661b31f9d10f311` |
| `refs/epiphany` | `https://gitlab.gnome.org/GNOME/epiphany.git` | `48bb1e24f4e8b4a74c19c3908470fc6fab10b765` |
| `refs/Gradia` | `https://github.com/AlexanderVanhee/Gradia.git` | `50689c927162e90e7db6dcb64de5f31eb0bdf79e` |
| Decibels | `https://gitlab.gnome.org/GNOME/Incubator/decibels.git` | `116f735e2310df7313968e727e63491eef49c46f` |
| `refs/troll` | `https://github.com/sonnyp/troll.git` | `37b53b29db0b6496f31e13c7f843100db31c9eb1` |
| `refs/showtime` | `https://gitlab.gnome.org/GNOME/showtime.git` | `6df538fc257416921b14e0572fc0770242355949` |
| the language | `https://gitlab.gnome.org/jwestman/blueprint-compiler.git` | `31b62c24a72c1670d2d93dcdf2d130f1ae12778e` (tag `v0.20.4`, `tests/samples/`) |

The five `refs/` commits are the gitlinks this repository pinned at
`db9b112e44bc6b6a42e9bebd6d206630189afbfc` (`feat(blueprint): accept an extern type` — #1694),
the commit this report was written on top of. The sweep re-reads them and stops rather than
reprinting this table from a moved pin.

**Decibels is the GNOME Incubator project and not the author's GitHub mirror**, which carries no
`.blp` at all — an easy hour to lose. **The language corpus is the reference implementation's own
`tests/samples/` at the tag of the oracle this measures against**, `v0.20.4`, taken whole rather
than filtered: `sample_errors/` is excluded because those files exist to be rejected and would
measure error messages rather than the subset, and `formatting/` and `linter_samples/` are about
neither. An earlier draft of this report used a 2023 checkout of the same repository and counted
52 files; that number is gone, along with everything derived from it.

## The headline

**Of 273 wild files, 253 are byte-equal with the oracle today (92.7%), 19 are refused (7.0%), and
one is silently wrong.** Counting only the 235 files this studio did not write: 215 byte-equal
(91.5%), 19 refused, 1 wrong.

| pool | files | byte-equal | refused | wrong |
|---|---:|---:|---:|---:|
| Workbench demos | 103 | 98 | 5 | 0 |
| Muzika | 58 | 56 | 1 | 1 |
| `refs/map-editor` (own) | 38 | 38 | 0 | 0 |
| `refs/epiphany` | 37 | 32 | 5 | 0 |
| `refs/Gradia` | 21 | 19 | 2 | 0 |
| Decibels | 8 | 6 | 2 | 0 |
| `refs/troll` | 4 | 3 | 1 | 0 |
| `refs/showtime` | 4 | 1 | 3 | 0 |

**Eighteen of the nineteen refusals are files the oracle compiles.** The nineteenth is
`refs/troll/gjspack/test/fixtures/invalid-blueprint.blp`, a fixture that exists to be invalid, and
both compilers refuse it. So clause 3 is behaving exactly as designed — a foreign file either builds
or names its construct — and the subset is the only thing standing between 92.7% and the rest.

**"Both refuse it" is not the same as agreeing, and this file is the example.** The sweep prints
the two reasons side by side rather than calling the bucket agreement, because nothing compares
them: the oracle answers `Namespace Gtk does not contain a type called FooApplicationWindow`, and
we answer `found \`MyAppWindow\`, expected \`$\`` — our parser stops on a pre-0.8.0 template
spelling and never reaches the type the fixture was written to be wrong about. Same verdict,
unrelated reasons. One file here, and 50 in the language corpus, sit in a bucket that could hide a
subset gap behind an oracle error on the same file; printing both reasons is the cheapest thing
that keeps that visible.

The language corpus is harsher and should be: 44 of 95 byte-equal, 50 refused, 1 wrong. A test suite
is written to reach corners, which is what makes it useful here — it names five constructs no
application in the wild corpus happens to use. Its one wrong file is
`tests/samples/adw_breakpoint.blp`, and it is wrong for the SAME reason Muzika's window is
(§ 3): `label.extra-menu: null;` in a setter, the string `null` written into a live property.
The reference implementation ships the file that would have caught this, and the corpus here
never had it.

## 1. The fifteen refusals: six are Blueprint, nine are not

Re-run against the oracle rather than trusted from the manifest. The manifest's `oracle` column is
correct in all fifteen rows.

**The oracle COMPILES these six — they are our gap:**

| refusal file | construct | seen in the wild |
|---|---|---:|
| `namespace-without-vocabulary.blp` | a type from a namespace with no vocabulary (`Gio.ListStore`) | 7 files, 6 of them stopping here first |
| `inline-menu.blp` | `menu { }` as a property value | 1 file |
| `internal-child.blp` | an `[internal-child …]` bracket | 1 file |
| `response-flags.blp` | `destructive` / `suggested` / `disabled` in `responses [ ]` | 1 file |
| `binding-lookup-chain.blp` | `bind a.b.c`, more than one lookup | 0 files (but see § 2) |
| `translation-domain.blp` | the file-level `translation-domain "…";` | 0 files |

**The oracle REFUSES these nine — they are not Blueprint and belong in `refused/` forever:**
`unknown-enum-member`, `flags-on-enum`, `unknown-accessibility-name`,
`unknown-accessibility-member` (four validation errors), `styles-with-semicolon`, `bad-escape`,
`bad-hex-digit`, `adw-before-gtk` (four grammar and lexical errors), and `closure-value`
(`label: $format("a")` — "Expected property value" on 0.20.4; a closure is legal in a binding and
not as a bare value).

`namespace-without-vocabulary` is the one with an owner outside this repository. ADR 0062's blocker 2
re-measured it at `@girs` 5.2.0: `@girs/gio-2.0` still declares no `./vocabulary` subpath, because
ts-for-gir gates vocabulary emission per namespace. Nothing in the parser closes it.

**The count moved since ADR 0062 said "seven compile, eight refuse", and the move is real.**
`extern-type.blp` left the list when #1694 landed `$Foo { }`, and `closure-value` and
`unknown-accessibility-member` joined it. 0062's blocker 1 was the most frequent out-of-subset
construct in this repository's own census, and closing it first was right: `$Foo { }` appears in 58
of the 273 wild files (21%), more than every remaining gap combined.

## 2. What the wild actually uses, ordered

Counted by files containing the construct, not by first parse error — a file that fails on its first
unsupported construct hides the others behind it. The sweep does this with text matches rather
than a parse, for the reason a parse cannot: our parser stops at the construct it refuses, so it
is unable to count what it has not read. The matchers are in the script, named and readable, so
the next reader can disagree with a regex instead of with a number.

| # | construct | wild (273) | language (95) | in the 15? |
|---:|---|---:|---:|---|
| 1 | expressions: `expr`, `bind $closure(…)`, `as <Type>`, `typeof<Type>`, `a.b.c` | 7 (2.6%) | 25 (26.3%) | only `a.b.c` |
| 2 | a type from a namespace with no vocabulary | 7 (2.6%) | 4 (4.2%) | yes |
| 3 | inline `template Type { }` (a `Gtk.BuilderListItemFactory` subscope) | 2 (0.7%) | 7 (7.4%) | **no** |
| 4 | `marks [ ]` on `Gtk.Scale` | 2 (0.7%) | 1 (1.1%) | **no** |
| 5 | response flags | 1 (0.4%) | 2 (2.1%) | yes |
| 6 | `null` as a value | 1 (0.4%) | 1 (1.1%) | **no** — and it is not refused, see § 3 |
| 7 | `[internal-child …]` | 1 (0.4%) | 1 (1.1%) | yes |
| 8 | `mime-types [ ]` on `Gtk.FileFilter` | 1 (0.4%) | 1 (1.1%) | **no** |
| 9 | inline `menu { }` as a value | 1 (0.4%) | 0 | yes |
| 10 | `template` with no parent, and `template Gtk.ListItem` | 0 | 8 (8.4%) | **no** |
| 11 | `offsets [ ]` on `Gtk.LevelBar` | 0 | 1 (1.1%) | **no** |
| 12 | `items [ ]` on `Gtk.ComboBoxText` | 0 | 1 (1.1%) | **no** |
| 13 | `[action response=…]` action widgets | 0 | 1 (1.1%) | **no** |
| 14 | `translation-domain` | 0 | 1 (1.1%) | yes |
| 15 | `bind-property` (the pre-0.8.2 spelling) | 0 | 0 | **no** |

Two rows are worth reading twice. `offsets [ ]` on `Gtk.LevelBar` is in this table because the
sweep found it and nobody here had thought of it — a tenth gap, and a fifteenth row the earlier
draft did not have. And `bind-property` is now 0 everywhere: at `v0.20.4` the spelling survives
only in the `.ui` files the samples are compared against, in no `.blp` the suite compiles, which
is what a retired syntax looks like from the outside.

**The finding that reorders the plan: five of the nine constructs that block a real file were not in
`refused/` at all.** The refusal list is a record of what someone thought to write a file for, and it
was written by the same people who wrote the parser — ADR 0053 clause 6's own warning about a corpus
that proves its author self-consistent, arriving one directory over from where it was expected. The
wild corpus found them in an afternoon.

**Expressions tie namespace vocabulary for most frequent in the wild, lead the language corpus
six to one, and the corpus barely touches them.** `binding-lookup-chain`
holds `bind a.b.c` alone, which is the smallest member of a family that also contains closures
(`bind $_get_play_icon(template.paused) as <string>`, Showtime), casts
(`expr(item as <StringObject>).string`, Epiphany), `typeof<>` and the `expr` keyword. Four of
Epiphany's five refusals and two of Showtime's three are this one family, and a list-view `expression:`
property is how every modern `Gtk.ColumnView` is written.

## 3. The one file that is worse than a refusal

`Muzika/data/ui/window.blp` line 20 writes `now_playing_details.header-title: null;` in a breakpoint
setter. The oracle writes `<setter object="now_playing_details" property="header-title"></setter>`.
The in-repo emitter writes `…>null</setter>` — the string `null`, into a live property. Every stage
of the corpus harness is green on it, because no corpus file contains the word.

It is worse than that. Measured on the oracle: `null` is permitted ONLY in a setter — a plain
`extra-menu: null;` is "null is not permitted here". The in-repo parser accepts that too and emits
`<property name="extra-menu">null</property>`. So one token produces both failure modes at once:
wrong output where the construct is legal, and silent acceptance where the oracle refuses.

This is the `Gio.ListStore` story again, and the harness already names it: "the parser took the
`using`, the emitter wrote `GioListStore`, a class GtkBuilder cannot find, and every stage stayed
green." Stage E exists because of that case. `null` is the second instance, found by the only method
that finds them — running the parser over files it has not seen. It is the reason this report puts a
one-file construct near the top of the plan.

**And two more that are not constructs at all.** Probing the classifier turned up a third and
fourth thing we accept that 0.20.4 refuses, both about bytes rather than grammar. A file beginning
with a UTF-8 **BOM** compiles here and the oracle answers `Could not determine what kind of syntax
is meant here` at line 1 column 1; a file containing an **invalid UTF-8 byte sequence** compiles
here — the emitter writes U+FFFD into the property — and the oracle does not even reach an error
message, it crashes with `UnicodeDecodeError: 'utf-8' codec can't decode byte 0xff in position 34:
invalid start byte`. Neither is in `refused/` and neither has a rule file, so nothing in this
repository would have noticed either. They are recorded in `status/open-todos.md` with the oracle's
exact words; they need a `refused/` file each, not parser features.

## 4. Cost per construct

| construct | new token | new AST node / field | emitter work | projection loss | outside the parser? |
|---|---|---|---|---|---|
| expressions | `expr`, `as`, `typeof`, `<`/`>` in cast position | an `ExpressionValue` (lookup chain, closure call, cast, constant); `BindingValue` stops being `{source, property}` and takes an expression | `<binding>` / `<lookup>` / `<closure>` / `<constant>`, nested and recursive | fold into the existing `binding` kind | a cast to a foreign type (`as <Gio.Icon>`) needs § 2's vocabulary |
| namespace vocabulary | none | none | none | none | **yes** — ts-for-gir must emit `./vocabulary` for more namespaces, and the GType name is not the namespace plus the name (`Gio.ListStore` is `GListStore`) |
| inline `template Type { }` | none | `TemplateNode` becomes a `Value`; `parent` optional, `className` admits a real type | large: the subscope is a **complete nested `<interface>` document, CDATA-escaped inside `<property name="bytes">`**, and ids inside it are ALSO emitted at top level | new loss kind | no |
| `marks` / `mime-types` / `items` / `offsets` / action widgets | none | none — `Extension` already carries `{name, entries}` | one emission shape each | `value-list`-shaped | no |
| response flags | none | `Extension.entries` must carry flags beside the value | `appearance="…"`, `enabled="false"` | existing `responses` kind | no |
| `null` | `null` keyword | a `NullValue`, or `IdentValue` with a guard | empty element text; refuse outside a setter | keeps its `null` | no |
| `[internal-child …]` | none | `Child.internalChild`, because `Child.slot` is bracket text alone and cannot tell the two apart | `<child internal-child="…">` | existing `object-id`-ish | no |
| inline `menu { }` | none | a `menu` member on `Value` | the menu inline rather than as a sibling | existing `menu` kind | no |
| `translation-domain` | none | a field on `BlueprintFile` | `<interface domain="…">` | new loss kind | no |
| `template` with no parent | none | `TemplateNode.parent` optional | `<template class="…">` with no `parent=` | existing `template` kind | no |

Only one row has an owner outside this repository, and it is tied for the most frequent. ADR 0062 left
the case for changing ts-for-gir's namespace gate at "nine files"; this report adds seven more, from
five namespaces (`GtkSource`, `WebKit`, `Shumate`, `Gio`, `Gdk`) and four projects that have never
heard of us. A second question comes with it and is not answered here: whether `@gjsify/blueprint`
depends on a dozen `@girs` packages, or whether a consumer declares the namespaces its file uses.

`bind-property` is the one construct that should stay refused although the oracle accepts it: the
oracle itself answers with `upgrade: 'bind-property' is no longer needed. Use 'bind' instead.
(blueprint 0.8.2)`. Refusing it with that text is a service; implementing it is carrying a
deprecation someone else already retired.

## 5. What the corpus needs

Every closed gap needs a rule file and an oracle-derived golden, and three of them need more.

| gap | rule files | goldens | refusal files |
|---|---:|---:|---|
| expressions | 6 (lookup chain, closure, closure with args, cast, `typeof`, `expr` in an `expression:` property) | 6 | `binding-lookup-chain.blp` retires |
| namespace vocabulary | 1 | 1, but only once the vocabulary exists | stays refused meanwhile |
| inline `template Type { }` | 2 (a plain subscope; one whose ids also appear at top level) | 2 | — |
| typed extensions (`marks`, `mime-types`, `items`, `offsets`, action widgets) | 5 | 5 | — |
| response flags | widen `31-responses.blp` | 1 | `response-flags.blp` retires |
| `null` | 1 (a setter) | 1 | **+1 new** (`null` on a plain property) |
| `[internal-child …]` | 1 | 1 | `internal-child.blp` retires |
| inline `menu { }` | 1 | 1 | `inline-menu.blp` retires |
| `translation-domain` | 1 | 1 | `translation-domain.blp` retires |
| `template` with no parent | 2 | 2 | — |
| `bind-property` | — | — | **+1 new**, kept forever |
| a UTF-8 BOM, and invalid UTF-8 (§ 3) | — | — | **+2 new**, kept forever |

About **20 new rule files with 21 goldens** — response flags widen `31-responses.blp` rather than
adding a file, which is why the two columns differ by one — plus four new refusal files and five
refusals retiring: 15 refusals become 14, and 35 rule files become roughly 55. Two of those four
are the encoding divergences in § 3, which need a refusal and no feature.

**One construct cannot be covered by a golden, and it is the one that caused the damage.** A golden
exists only for a file the parser ACCEPTS and the oracle COMPILES. `null` on a plain property is
compiled by neither — the oracle calls it an error and the correct in-repo behaviour is to call it an
error too — so nothing in stages C or D can ever see it. It needs a `refused/` file and stage E,
exactly as `Gio.ListStore` did. The legal half (`null` in a setter) does get a golden, and that
golden fails today, which is the cheapest possible proof that the rest of this section is worth
doing.

## 6. The honest bottom line

Ordered by files unblocked, over the 234 valid foreign files — the 235 foreign ones (273 less this
studio's own 38 in `refs/map-editor`) less Troll's invalid fixture:

| after closing | cumulative | of the 234 |
|---|---:|---:|
| today | 215 | 91.9% |
| + namespace vocabulary | 221 | 94.4% |
| + expressions | 225 | 96.2% |
| + inline `template Type { }` | 227 | 97.0% |
| + `marks` | 229 | 97.9% |
| + response flags | 230 | 98.3% |
| + `null` | 231 | 98.7% |
| + `[internal-child …]` | 232 | 99.1% |
| + `mime-types` | 233 | 99.6% |
| + inline `menu { }` | 234 | 100% |

**Read against § 2 this table looks like an arithmetic error, and it is an overlap.** Expressions
appear in 7 wild files there and are credited with +4 here, because a file moves only when its
WHOLE remaining need is closed: two of the other three also want an inline `template` (Workbench's
List View Widgets, Epiphany's location entry) and the third also wants `mime-types` (Showtime's
window). The same overlap shortens namespace vocabulary from 7 files to +6, and its missing file is
Epiphany's location entry again — which wants a cast to `Gio.Icon`, so it is counted in both rows
of § 2 and paid for in neither until expressions and inline `template` are both done. The sweep
prints the per-file need list this paragraph summarises.

**And the honest part: that last row says 100% of 234 files from seven projects, and nothing more.**
Two-thirds of those files come from Workbench and Muzika, and Workbench demos are written to
demonstrate one widget each. Five constructs the language has (`translation-domain`, `items [ ]`,
action widgets, `template` with no parent, `offsets [ ]`) appear in ZERO of them and in the
compiler's own tests, so the wild corpus underestimates the language by at least five constructs it
happened not to sample.
No file in it used a GTK 3 spelling, a `Gtk.ColumnView` with a sorter expression, or libpanel. The
true statement is: **after the top three — namespace vocabulary, expressions, inline `template` —
a foreign `.blp` from a GNOME-adjacent application is unlikely to be refused, and "unlikely" is
97.0% over this sample, not a property of the language.**

**How to get a corpus that answers it better.** ADR 0053 clause 6 forbids the obvious move: third-party
`.blp` must never become the part of the corpus CI lacks. But it explicitly allows a LOCAL sweep, and
that is what every number here is. So the thing checked in is the SWEEP and not the files:
`scripts/blueprint-wild-sweep.mjs`, in this commit, which materialises each pinned source, runs
parse plus emit against the oracle, and prints every table above. It is how each of these numbers
was obtained rather than a plan to obtain them again, and the next person who wants to know what an
application does can add four lines to its source list instead of arguing from eleven files. The
corpus stays written; the measurement is repeatable.

**It is not free, and it does not pretend to be.** The sweep needs `blueprint-compiler` 0.20.4 on
PATH, the tree's `@girs` pins installed, and the network the first time a pool is cloned; it exits
non-zero naming whichever is missing. There is deliberately no skip mode, and that is the
difference from `check-blueprint-corpus.mjs`: that harness commits its goldens so four of its five
stages run anywhere, while here the binary IS the other half of every comparison. A skipping sweep
would print a green line about no measurement, which is the shape `--require-oracle` was added over
there to close. So it stays a local tool, run deliberately, and the repository holds its output.

## The plan, in order

1. **`null`** — one file in the wild, and the only construct in this report that produces wrong
   output instead of an error. Small: a keyword, a value kind, an empty element, a refusal outside
   the setter. It is first because clause 3 is a property and it is currently false.
2. **Expressions** — the largest construct family, the most frequent real blocker, and the one whose
   absence rules out list views. Six rule files; it will take longer than the rest together.
3. **Namespace vocabulary** — the second most frequent, zero parser work, and an owner in ts-for-gir.
   Start the upstream conversation now so it lands in parallel with 2 rather than after it.
4. **Inline `template Type { }`** — two wild files, and the cost is a surprise worth knowing early:
   a nested CDATA-escaped document with ids that appear twice.
5. **The typed-extension family** — `marks`, `mime-types`, `items`, action widgets, response flags.
   Cheap, mechanical, one emission shape each, and it retires a refusal.
6. **`[internal-child …]`, inline `menu { }`, `translation-domain`, parentless `template`** — four
   small items that together move the last percent.
7. **`bind-property`** — a refusal file quoting the oracle's own upgrade text. Never implemented.

**The flip (ADR 0063) does not have to wait for all of it.** Clause 5's condition is silence over the
corpus, and that holds today. What this report changes is the expectation after the flip: with
`null` fixed (item 1) the promise "either it builds or it names its construct" is true over every
file measured here, and that promise — not the percentage — is what makes a hard-error subset safe to
turn on. Items 2 to 7 then move the percentage in public.

## What this report did not do

- **No parser code.** Every gap is described by what it needs, not by a patch.
- **No corpus edits.** The 20 rule files and 2 refusal files are counted, not written.
- **No claim about the `SharedNode` projection.** ADR 0053 clause 4 keeps the byte-equal diff a
  statement about the parser and the AST. The projection was not measured over foreign files at all,
  and the loss kinds in § 4 are proposals for whoever closes each gap.
- **No claim beyond 0.20.4.** Every "the oracle compiles this" is that build on Fedora 44. Clause 5
  makes a shadow run that starts reporting after an upstream release the upgrade notice, and this
  report is a snapshot the same way the goldens are.
