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
| the wild | 273 | `.blp` from eight projects: `refs/epiphany` (37), `refs/Gradia` (21), `refs/showtime` (4), `refs/troll` (4), `refs/map-editor` (38), Workbench demos (103), Muzika (58), GNOME Decibels (8) |
| the language | 52 | the valid samples in `blueprint-compiler`'s own test suite — not real-world, but the language's definition by example |

`refs/map-editor` is JumpLink's own and is counted separately where it matters. Each file was parsed
and emitted through `src/parser.mjs` + `src/emit-xml.mjs` + `src/resolve-ident.mjs` at `@girs` 5.2.0,
compiled by the oracle, and the two outputs compared byte for byte.

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

The language corpus is harsher and should be: 28 of 52 byte-equal, 23 refused, 1 wrong. A test suite
is written to reach corners, which is what makes it useful here — it names four constructs no
application in the wild corpus happens to use.

## 1. The fifteen refusals: six are Blueprint, nine are not

Re-run against the oracle rather than trusted from the manifest. The manifest's `oracle` column is
correct in all fifteen rows.

**The oracle COMPILES these six — they are our gap:**

| refusal file | construct | seen in the wild |
|---|---|---:|
| `namespace-without-vocabulary.blp` | a type from a namespace with no vocabulary (`Gio.ListStore`) | 6 files |
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
unsupported construct hides the others behind it.

| # | construct | wild (273) | language (52) | in the 15? |
|---:|---|---:|---:|---|
| 1 | expressions: `expr`, `bind $closure(…)`, `as <Type>`, `typeof<Type>`, `a.b.c` | 7 (2.6%) | 8 (15%) | only `a.b.c` |
| 2 | a type from a namespace with no vocabulary | 6 (2.2%) | 4 (7.7%) | yes |
| 3 | `marks [ ]` on `Gtk.Scale` | 2 (0.7%) | 1 | **no** |
| 4 | inline `template Type { }` (a `Gtk.BuilderListItemFactory` subscope) | 2 (0.7%) | 2 | **no** |
| 5 | `null` as a value | 1 (0.4%) | 1 | **no** — and it is not refused, see § 3 |
| 6 | `[internal-child …]` | 1 (0.4%) | 1 | yes |
| 7 | inline `menu { }` as a value | 1 (0.4%) | 0 | yes |
| 8 | response flags | 1 (0.4%) | 1 | yes |
| 9 | `mime-types [ ]` on `Gtk.FileFilter` | 1 (0.4%) | 1 | **no** |
| 10 | `template` with no parent, and `template Gtk.ListItem` | 0 | 3 (5.8%) | **no** |
| 11 | `items [ ]` on `Gtk.ComboBoxText` | 0 | 1 | **no** |
| 12 | `[action response=…]` action widgets | 0 | 1 | **no** |
| 13 | `translation-domain` | 0 | 1 | yes |
| 14 | `bind-property` (the pre-0.8.2 spelling) | 0 | 1 | **no** |

**The finding that reorders the plan: five of the nine constructs that block a real file were not in
`refused/` at all.** The refusal list is a record of what someone thought to write a file for, and it
was written by the same people who wrote the parser — ADR 0053 clause 6's own warning about a corpus
that proves its author self-consistent, arriving one directory over from where it was expected. The
wild corpus found them in an afternoon.

**Expressions are the largest single item and the corpus barely touches them.** `binding-lookup-chain`
holds `bind a.b.c` alone, which is the smallest member of a family that also contains closures
(`bind $_get_play_icon(template.paused) as <string>`, Showtime), casts
(`expr(item as <StringObject>).string`, Epiphany), `typeof<>` and the `expr` keyword. Four of
Epiphany's five refusals and both of Showtime's are this one family, and a list-view `expression:`
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

## 4. Cost per construct

| construct | new token | new AST node / field | emitter work | projection loss | outside the parser? |
|---|---|---|---|---|---|
| expressions | `expr`, `as`, `typeof`, `<`/`>` in cast position | an `ExpressionValue` (lookup chain, closure call, cast, constant); `BindingValue` stops being `{source, property}` and takes an expression | `<binding>` / `<lookup>` / `<closure>` / `<constant>`, nested and recursive | fold into the existing `binding` kind | a cast to a foreign type (`as <Gio.Icon>`) needs § 2's vocabulary |
| namespace vocabulary | none | none | none | none | **yes** — ts-for-gir must emit `./vocabulary` for more namespaces, and the GType name is not the namespace plus the name (`Gio.ListStore` is `GListStore`) |
| inline `template Type { }` | none | `TemplateNode` becomes a `Value`; `parent` optional, `className` admits a real type | large: the subscope is a **complete nested `<interface>` document, CDATA-escaped inside `<property name="bytes">`**, and ids inside it are ALSO emitted at top level | new loss kind | no |
| `marks` / `mime-types` / `items` / action widgets | none | none — `Extension` already carries `{name, entries}` | one emission shape each | `value-list`-shaped | no |
| response flags | none | `Extension.entries` must carry flags beside the value | `appearance="…"`, `enabled="false"` | existing `responses` kind | no |
| `null` | `null` keyword | a `NullValue`, or `IdentValue` with a guard | empty element text; refuse outside a setter | keeps its `null` | no |
| `[internal-child …]` | none | `Child.internalChild`, because `Child.slot` is bracket text alone and cannot tell the two apart | `<child internal-child="…">` | existing `object-id`-ish | no |
| inline `menu { }` | none | a `menu` member on `Value` | the menu inline rather than as a sibling | existing `menu` kind | no |
| `translation-domain` | none | a field on `BlueprintFile` | `<interface domain="…">` | new loss kind | no |
| `template` with no parent | none | `TemplateNode.parent` optional | `<template class="…">` with no `parent=` | existing `template` kind | no |

Only one row has an owner outside this repository, and it is the second most frequent. ADR 0062 left
the case for changing ts-for-gir's namespace gate at "nine files"; this report adds six more, from
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
| typed extensions (`marks`, `mime-types`, `items`, action widgets) | 4 | 4 | — |
| response flags | widen `31-responses.blp` | 1 | `response-flags.blp` retires |
| `null` | 1 (a setter) | 1 | **+1 new** (`null` on a plain property) |
| `[internal-child …]` | 1 | 1 | `internal-child.blp` retires |
| inline `menu { }` | 1 | 1 | `inline-menu.blp` retires |
| `translation-domain` | 1 | 1 | `translation-domain.blp` retires |
| `template` with no parent | 2 | 2 | — |
| `bind-property` | — | — | **+1 new**, kept forever |

About **19 new rule files with 19 goldens**, two new refusal files, five refusals retiring: 15
refusals become 12, and 35 rule files become roughly 54.

**One construct cannot be covered by a golden, and it is the one that caused the damage.** A golden
exists only for a file the parser ACCEPTS and the oracle COMPILES. `null` on a plain property is
compiled by neither — the oracle calls it an error and the correct in-repo behaviour is to call it an
error too — so nothing in stages C or D can ever see it. It needs a `refused/` file and stage E,
exactly as `Gio.ListStore` did. The legal half (`null` in a setter) does get a golden, and that
golden fails today, which is the cheapest possible proof that the rest of this section is worth
doing.

## 6. The honest bottom line

Ordered by files unblocked, over the 234 valid foreign files (the 235 minus Troll's invalid fixture,
and minus this studio's own `refs/map-editor`):

| after closing | cumulative | of valid foreign files |
|---|---:|---:|
| today | 215 | 91.9% |
| + namespace vocabulary | 221 | 94.4% |
| + expressions | 225 | 96.2% |
| + inline `template Type { }` | 227 | 97.0% |
| + `marks` | 229 | 97.9% |
| + `mime-types` | 230 | 98.3% |
| + `null` | 231 | 98.7% |
| + `[internal-child …]` | 232 | 99.1% |
| + inline `menu { }` | 233 | 99.6% |
| + response flags | 234 | 100% |

**And the honest part: that last row says 100% of 234 files from eight projects, and nothing more.**
Two-thirds of those files come from Workbench and Muzika, and Workbench demos are written to
demonstrate one widget each. Four constructs the language has (`translation-domain`, `items [ ]`,
action widgets, `template` with no parent) appear in ZERO of them and in the compiler's own tests, so
the wild corpus underestimates the language by at least four constructs it happened not to sample.
No file in it used a GTK 3 spelling, a `Gtk.ColumnView` with a sorter expression, or libpanel. The
true statement is: **after the top four, a foreign `.blp` from a GNOME-adjacent application is
unlikely to be refused, and "unlikely" is 97% over this sample, not a property of the language.**

**How to get a corpus that answers it better.** ADR 0053 clause 6 forbids the obvious move: third-party
`.blp` must never become the part of the corpus CI lacks. But it explicitly allows a LOCAL sweep, and
that is what every number here is. So the thing to check in is the SWEEP, not the files — a
`scripts/blueprint-wild-sweep.mjs <dir>` that walks any tree, runs parse plus emit against the oracle,
and prints the same table: refused by construct, byte-equal, and divergent. Checked in, it costs
nothing on a runner without the binary, it reproduces this report's numbers on demand, and the next
person who wants to know what an application does can point it at the application instead of
arguing from eleven files. The corpus stays written; the measurement becomes repeatable.

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
- **No corpus edits.** The 19 rule files and 2 refusal files are counted, not written.
- **No claim about the `SharedNode` projection.** ADR 0053 clause 4 keeps the byte-equal diff a
  statement about the parser and the AST. The projection was not measured over foreign files at all,
  and the loss kinds in § 4 are proposals for whoever closes each gap.
- **No claim beyond 0.20.4.** Every "the oracle compiles this" is that build on Fedora 44. Clause 5
  makes a shadow run that starts reporting after an upstream release the upgrade notice, and this
  report is a snapshot the same way the goldens are.
