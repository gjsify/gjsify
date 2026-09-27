<!-- Authored Open-TODO sections — area: Blueprint (@gjsify/blueprint).
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### The XML-door gate has no kind for "an object, or the key that names it"

`check-nativescript-xml-doors` classifies a setter's declared type into `number`, `boolean`,
`string` and `json` — the last added by [ADR 0047](../docs/adr/0047-portable-adjustment.md)
for `AdwSpinRow.adjustment`, where the string spelling is JSON text a parser reads.

[ADR 0048](../docs/adr/0048-page-selection-by-identity.md) met the shape that is neither.
`AdwTabView.selectedPage` wants to take `AdwTabPage | string | null` — the page, or the id
that names it — and `attributeKind` files any `<object> | string` union as `json`, so the
gate then demands the setter run a JSON parser it has no business running. Measured while
writing that change: the annotation alone turns the door red with *"does not go through
parseAdjustment()"*.

The NativeScript setter takes the ID for now, which is honest there — every other page call
on that port takes one, and an XML attribute can carry nothing else. What is unresolved is
the gate: `jsonDoors()` verifies an exported FUNCTION whose body has a `catch`, and a
key-taking door has neither (it is a method, and it refuses by recording a diagnostic rather
than by throwing). A fourth kind wants its own verifier — *the string half names something
the receiver owns, the lookup refuses without throwing* — and the two registries should
probably become one table keyed by kind rather than a third constant beside
`STRING_TOLERANT` and `JSON_DOORS`.

Not built now because one door does not establish a rule, and a kind invented for a single
member is the "second way to say what the table can already say" that gate's own header
refuses. The second member is what should trigger this.

### Blueprint no longer reaches the build through a binary — the deletions are what is left

`@gjsify/vite-plugin-blueprint` used to shell out to GNOME's `blueprint-compiler`, which is
installed on neither the macOS nor the Windows runner. ADR 0053 carries the census and the
reasoning and decided the shape — an in-repo TypeScript parser whose second exit is `SharedNode`,
run in shadow beside the compiler until it reports no divergence. **The shadow run is silent, and
ADR 0053 Amendment 3 is the flip that takes it:** the plugin calls `parseBlueprint` +
`emitGtkBuilderXml`, spawns nothing and has no fallback to the binary. Re-measured 2026-09-19 on
the flip branch with `--require-oracle` against `blueprint-compiler` 0.20.4, re-measured again on
the `@girs` 5.3.0 bump, and again on each of the
eleven constructs that closed the subset, and once more against the PUBLISHED `@girs` 5.4.0
rather than a local build — **95 of 95** in `tests/samples` and **272 of 273** wild, 0 silently
wrong, the one remainder being a deliberately invalid fixture the oracle refuses too:
56 rule files and 46
reality probes, all 102 goldens byte-equal, `SHADOW_DIVERGENCES` empty, and 21 refused `.blp` each
naming their construct, their file and their line. The refusal count went DOWN by four and that
is the shape of this change: a fixture pinning a construct the parser now reads is a fixture
that has to be retired, and the corpus check is what says so. Those four are held to the tree by
`check-blueprint-corpus-counts.mjs`, because #1698 corrected them here and #1700 made every one of
them wrong again within hours — and the gate is bidirectional, so deleting the sentence fails too.

**What the flip forced beyond the ADR's own list:** `@gjsify/blueprint` is no longer `private`.
`verify-published-closure.mjs` refuses a release-pinned edge from a PUBLISHED package to a private
target by name, so the parser is on the release train and its first publish is queued in
`status/pending-npm-bootstrap.json` — a manual maintainer step with a credential and an OTP, which
OIDC cannot do.

**And the failure mode is not a stalled train, which is what makes it easy to miss.** An earlier
draft of that ledger entry said this name was alphabetically first and would stall everything;
measured, it is 12th of the 215 non-private `@gjsify/*` names — the same 215
`verify-published-closure` counts as publishable — behind `abort-controller`, `adwaita-app` and
`adwaita-core` among others, and the release does not walk them alphabetically anyway.
`npm:publish:prebuilt` runs `gjsify foreach --topological … gjsify publish
--tolerate-untrusted-new`, and `--tolerate-untrusted-new` returns `skipped-untrusted-new` with
exit 0 for a name OIDC cannot create — the flag exists so one un-bootstrapped package does not
break the serialized loop. Measured, that loop emits `@gjsify/blueprint` before
`@gjsify/vite-plugin-blueprint`. So an un-bootstrapped parser is SKIPPED and the plugin is
PUBLISHED behind it, pinning a name npm does not have, on a required `dependencies` edge: every
consumer install of the plugin fails, on every package manager. The release goes red afterwards,
in `verify-published-closure`'s post-release phase, which ignores the ledger by design — after
the tarball is on the registry. The bootstrap is a BEFORE for that reason and not for an
alphabetical one.

**`$extern` landed, which is ADR 0062 Decision 3 and not the flip.** The parser accepts an
extern type wherever an object is legal — a child, a `[slot]` child, a property value, a root
and a template parent — and the corpus grew rule files 32-35 for it:
#1694 took the corpus to 35 rule files and 47 corpus files, which records what that PR did
and is not a claim about this tree — what the corpus holds NOW is measured a paragraph above
and held to the tree there. Two things `$extern` does NOT do: it converts no
consumer, and it does not make `SharedNode` able to RENDER one. An extern tag is spelled right and resolves to
nothing, so the projection names a new loss kind, `extern`, beside it. The 58 sites ADR 0062
counted are unblocked as a LANGUAGE question and each still needs its own conversion PR;
`showcases/gtk/adw-blueprint-layout` is the one the ADR names first.

**Expressions landed, and they are the largest construct family in the language.** `bind` and
`expr` now take the whole grammar — lookup chains, casts, `$closure(…)` calls, `typeof<Type>`,
`item`, `try { … }` and constants — and rule files 42-48 hold it, with four new `refused/`
files beside them. Measured with `scripts/blueprint-wild-sweep.mjs` over the same nine pinned
pools the 2026-09-16 report used: **263 of 273 wild files byte-equal (96.3%, was 259/94.9%),
10 refused, 0 silently wrong**, and over the reference implementation's own `tests/samples`
**58 of 95 byte-equal (was 45)**. No file that compiled before refuses now. What is still
refused for an expression reason is ONE shape, and its owner is ts-for-gir: the oracle infers a
type from a property's GType in two positions — the middle of an uncast lookup chain and an
uncast closure's return type — and `@girs`'s vocabulary ships no property-to-GType table
(`OWN_PROPS` is names, `PROP_ENUMS` only the enum-typed ones). That is the same gate as the
namespace vocabulary one below, one table over; 8 files in `tests/samples` stop there and 0
wild files do, because every closure in the wild corpus writes its cast.

**A `template` may now have no parent, which is the Optional branch of the oracle's own grammar**
(`Template = 'template' TypeName ( ':' TypeName )? ObjectContent`). Measured with
`scripts/blueprint-wild-sweep.mjs` over the same nine pinned pools: the reference
implementation's `tests/samples` go from **62 to 68 byte-equal** (refusals 33 → 27), and the wild
corpus does not move — **264 of 273, 0 silently wrong** — because all eight files that write the
form are in `tests/samples` and none is in the wild. That asymmetry is the finding, not a
disappointment: the form is a language feature the wild does not reach for.

What the absence COSTS is the reason it was refused rather than defaulted. A parentless template
is the oracle's `ExternType`, marked `incomplete`, so no property or signal name written inside
it is validated against any vocabulary — and no value is resolved through one either.
`50-template-orphan.blp` holds exactly that: `visible: true` stays the string `true`, where
`08-template.blp` turns `halign: center` into `3` through `Adw.Bin`. Same emitter, same path; the
difference is that there is no owner. The `<template>` carries NO `parent` attribute — the oracle
passes `parent=None` and its writer drops null-valued attributes, so a default would have been an
invention. In the SharedNode projection the class being defined becomes the root tag and is a
SECOND declared loss (`extern`), because a parentless template is the extern case by
construction.

**The inline `template Type { }` of a `Gtk.BuilderListItemFactory` closes the family.** Measured
over the same nine pools: the reference implementation's `tests/samples` go from **68 to 75
byte-equal** (refusals 27 → 20) and the wild corpus moves for the first time in this family,
**264 to 265 of 273** (97.1%), 0 silently wrong — the one file is epiphany's
`location-entry.blp`. Together with the parentless form above, the language corpus went 62 → 75.

It is not nested XML, it is TEXT: a SECOND, complete document with its own `<?xml?>` declaration,
its own `<interface>` and no `<requires>`, indentation restarting at column 0, CDATA-escaped into
`<property name="bytes">` on the factory. Three consequences fall out of that and none of them is
a style choice. The sub-document cannot be written into the enclosing writer, so it gets one of
its own. Its ids are a SEPARATE SCOPE — `indexBody` never descends into the block, so
`51-inline-template.blp` declares `corpusLabel` twice on purpose and neither is a duplicate,
which is what the reference implementation means by "may not reference objects in the main
blueprint or vice versa". And the only escape a CDATA section still needs is its own terminator,
so `]]>` inside the text is split across two sections — not hypothetical, since an inline
template nested inside another produces exactly that sequence.

The projection declares the whole block lost rather than flattening it, and flattening would be
worse than dropping: the ids inside may repeat the outer file's, so a merged tree could carry two
different objects under one name with no way for a consumer to tell. `goldenObjects` in
`check-blueprint-corpus.mjs` now strips CDATA before counting, which is a statement about what it
measures — a projection of one document held against the object count of two could only be
satisfied by declaring losses for objects the projection was never asked about.

**The flip landed, and what it answered is the question this paragraph used to hold open.**
`@gjsify/vite-plugin-blueprint` kept its public interface and changed what it calls. Byte-equality
on the corpus is evidence about the corpus: the parser accepts a documented SUBSET (clause 3), and
a `.blp` outside it is a hard error rather than wrong output. What a build does when a real file
trips one is now decided — it fails, naming the construct, the file and the line, through
`BlueprintSyntaxError` or `BlueprintEmitError`, both of which carry `file` and `line` as fields so
a wrapping tool never regexes a message. The constructs that do it are the ones
`corpus/refused/` records with `oracle: 'compiles'`, and they are listed by name in ADR 0053
Amendment 3 rather than kept in a second list here.

**And "outside the subset is a hard error, never wrong output" is a property to re-measure
before the flip, not to assume.** It was untrue for `accessibility { }` until that rule file
grew past the single string it held: relations and states were emitted as `<property>`, inside
the subset, silently. What found it was widening the corpus, not reading the code — so the
question for every construct with a thin rule file is what its SECOND case looks like. The
SAME file paid it twice. Once the ARIA value types landed, that block still held exactly one
`<state>`, `checked: true`, which the table numbers — so "a state is numbered" fitted every
byte the corpus had and is wrong: `hidden: true` stays `true`. Measured by writing that rule
into the emitter — against the old fixture it is BYTE-EQUAL, against the one that now carries
a boolean row it fails on the line. A corpus proves a rule only over the cases it holds.

Done is a deletion list, not a feature list: `resolve-compiler.ts` and its spec (505 lines,
the MSYS2 probe at `:67-130` among them), the one `oxlint-disable` in `loading-stack.ts`, the
programmatic storybook window, and the `not on PATH` skip in `check-doc-fences.mjs` — which
becomes two-stage rather than vanishing, per clause 7. This list used to carry "the MSYS2
branch of `gjsify system-check`" as a separate item; it is not one. `git log -S` finds no
commit putting `blueprint` or `msys2` into `commands/system-check.ts`, and the branch is
inside `resolve-compiler.ts` already counted above. What the CLI contributes is a CONSUMER,
`utils/check-system-deps.ts:544-575`, which delegates to it and gets re-pointed rather than
deleted. The compiler itself stays, as the oracle stage B
runs: deleting the binary from the image would delete the only independent reading the goldens
have.

**Three of the four are done (ADR 0063).** `resolve-compiler.ts` and its spec are gone with the
published `./resolve` subpath they backed; the CLI consumer was re-pointed by deletion rather
than redirection, because a `system-check` row for a binary no build can spend is a check that
fails for the wrong reason; and `check-doc-fences.mjs` is two-stage, where stage PARSE caught a
doc sample the oracle compiles and the build now refuses. **What is left is the CONVERSION half,
and it is not a toolchain question any more.** `loading-stack.ts` keeps its `oxlint-disable`
until the widget is declared in a `.blp` — a change to the widget, owned by ADR 0062's frontier,
with a runtime to prove rather than a line to drop. `@gjsify/storybook`'s programmatic window is
the same shape and clause 7 already calls it a scoping decision rather than a deletion. A
deletion list is a completion test: these two are the unchecked boxes.

One thing the corpus settled that the ADR's mapping table did not have: more construct classes
fall outside `SharedNode` than the census of the forty-six real files found, and the translatable
marker is the one that costs — a caption parsed into a plain string loses exactly the attribute
ADR 0033 prefers a template for. The per-kind count is below, under "Inverting the Blueprint
projection needs the GIR", and is not repeated here.


### Does the shared corpus want a second authored notation?

ADR 0051 authors the shared trees as `SharedNode` in GIR class names, because that spelling is
the one both renderers already carry and authoring in either renderer's markup would make one of
them the reference and the other a translation. ADR 0053 adds a Blueprint READER over the same
shape and explicitly does not propose replacing the authored form. Whether it should is open,
and 0053 § Context has the level argument that makes it a real question rather than a
preference: neither notation contains the other.

**The measurement this entry asked for is in, and it prices the two directions apart** — ADR
0058 § Context, read at `702470a628`. Making `.blp` the AUTHORED form is the expensive one:
**0 of the 11 real `.blp` files this repo builds round-trip through `SharedNode`**, and the
constructs that stop them are `template` (11 of 11), a `slot` (11 of 11) and object ids (10
of 11) — GtkBuilder's ADDRESSING model, which the other two surfaces have no use for at all,
a web custom element having neither a composite template nor a builder id.

**The last clause of that sentence was re-measured and is wrong for two of the three** — ADR
0066. A custom element HAS a registered name and an `id`; so does a NativeScript view. Only
`bind` is GtkBuilder-only, and it stays a refusal. The two that are not now have a field
each, the price of moving the authored form is that much lower, and the move is still not
proposed: ADR 0051 Decision 1 stands and `slot` is still 12 of 12. Emitting `.blp`
is the cheap one: **6 of the 7 shared blocks lose the translatable marking and nothing
else**, and closing that one loss moves 0 of the 11 real files, so the two directions do not
share a step. Read the 6 as a statement about the PROJECTION: held the other way — each
blueprint fence projected and compared to its block's authored tree — **5 of the 7 are
identical**, the same five ADR 0051 § Amendment 2 named from the `preview` fence.
`Adw.PreferencesGroup` and `Adw.ShortcutLabel` are the two either measurement finds, and the
marking does not reach them.

Emitting is also the shape ADR 0034 § 8 already names as this repository's answer to the
neighbouring translator question — write the tree once in the vocabulary that runs and emit
the dialects — and it needs no parser and leaves 0051's reasoning untouched. Either could
still land first. What has changed is only that the emit direction now has a price and a
proposed shape (ADR 0058, **Proposed** — the decision is unmade); a supersession of 0051
still needs its own measurement, and the numbers above are an argument against one rather
than a plan for it.

**What an emitter would serve is larger than the corpus, and nothing holds it.** The gallery
carries 40 hand-authored ` ```blueprint ` fences across 9 pages, with 165 `_()` calls in 37
of them and 30 `styles [...]` blocks in 13; only 2 of the 40 project through `SharedNode`
with no loss at all, and 1 — `Adw.AlertDialog` — the parser refuses outright, on the
`responses` response flag already recorded above. Of the 165 calls, 137 sit on a scalar
property and 24 inside a `strings [...]` list or a `menu { }`, which the projection already
loses by their own kind, so a translatable field reaches the 137 and not the rest. Arm 13 of
`check-generated-website-data.mjs` holds each block's `preview` fence against the shared
corpus; no arm holds its `blueprint` fence against anything.


### A Shumate rule file needs a CI image that has libshumate, and a PR cannot push one

`packages/infra/blueprint` depends on `@girs/shumate-1.0` — it is what takes Workbench's Map demo
to byte-equal — and it is the one of the five namespaces with NO corpus golden. A golden needs the
oracle, the oracle needs the typelib, and `.docker/ci-fedora.Dockerfile` installs `gtk4-devel`,
`libadwaita-devel`, `gtksourceview5-devel` and `webkitgtk6.0-devel` and no libshumate. So a rule
file naming Shumate reds stage B of `check-blueprint-corpus.mjs` until the image is rebuilt, and
`build-ci-image.yml` only PUSHES on `main` — its pull-request leg builds and never pushes, by
design, because a fork PR's token cannot write to GHCR. One PR therefore cannot carry both halves.

Measured on this workstation, where every typelib is installed: a Shumate golden is byte-equal, so
nothing about the code is in question. The gap is that a dependency of a gated package has no
coverage in the gate — it is exercised only by module load (`merged()` and `NAMESPACES` read every
vocabulary on import, so a broken or conflicting one fails every corpus run) and by the wild sweep,
which is not a gate and needs a workstation.

Two commits, in order: add `libshumate-devel` to `.docker/ci-fedora.Dockerfile`, land it, and once
the weekly or on-push rebuild has pushed `ghcr.io/gjsify/ci-fedora:<major>`, add the rule file and
its golden. Doing it the other way round is a red PR that looks like a defect in the resolver.


### Inverting the Blueprint projection needs the GIR, and one loss needs a field

Writing the hand-written expectations ADR 0053 clause 2 asks for turned up the losses; ADR
0058 counted them and then asked which are shape problems at all. **Two of the three this
entry used to name are not.**

The census, over the 38 corpus files (27 written rule files, 11 real `.blp`) at
`702470a628`: **119 losses over 26 files**, in 12 produced kinds, of which the three largest
are object ids (53), the translatable marking (25) and `template` (12). **Six of the twelve
kinds are unreachable from the eleven shipped files** — `menu`, `signal`, `accessibility`,
`layout`, `sibling-object`, `value-list` — which is ADR 0053 clause 6's written corpus
earning its keep, and a standing warning that a construct no real file uses is one whose
SECOND case nobody has seen. The same figures are already held per line by stage D of
`check-blueprint-corpus.mjs`, which prints them every run; the copy that had drifted was the
one in `src/project.mjs`'s header, which said 36 trees and 119 losses after #1644 added a rule
file to what #1635 had counted, and which states no count at all any more. Read every figure
in this paragraph as a date: #1681, #1690, #1694 and #1700 each grew the corpus after this
census was taken, and what the tree holds now is what the harness prints rather than what a
paragraph says. None of the conclusions below moves with them — those rest on the real files,
which #1694 does not touch and #1690 only adds to.

`slot` conflates two GtkBuilder constructs — `[start]` is `<child type="start">`, a
placement on the child wrapper; `content:` is `<property name="content">`, an object as a
property value — so from `slot: 'content'` alone nothing says which to emit. **That is not a
shape change, it is a lookup.** Measured: 53 slot constructs in the AST over 18 files, 26
bracket-derived and 27 property-derived, of which 46 reach the projection as a slotted node
on 17 files — the seven that do not are `[breakpoint]` brackets, dropped whole before a slot
is written, so an inverter never meets that name. Six distinct bracket names against five
property names, with an EMPTY intersection; the question "is this name a property of the
parent class?" answers all 17 distinct (construct, name, class) triples those 53 constructs
reduce to, with 0 disagreements and no class missing from the table it is asked of; and
across all 191 interfaces / 169 widgets of
`gtk-host/src/generated/props.ts` **no class declares a property named `start`,
`end`, `top`, `bottom`, `center` or `breakpoint`**. Same for the props: a string literal, an
enum member and an id reference all land on one JS string, and the property's GIR type
separates them (`orientation` enum-typed, `menu-model` object-typed, `label` string-typed) —
no prop name in the corpus carries both an ident and a string value. What the lookup does
NOT restore is the object an id names, which leaves with the id.

**The empty intersection is a fact about today's GTK, not a law**, so an inverter needs a
guard over the widget table saying no class declares a property named like a child type it
accepts. Without it the day GTK adds one, an inverter picks the wrong construct and emits
output that is plausible and wrong — the failure ADR 0053 clause 3 exists to prevent,
reached through the one door that clause does not watch.

**`styles [...]` is a vocabulary gap, not a shape gap, and this entry had it wrong.** It
used to say a space-joined string "would be a lie about the shape 0049 chose". ADR 0049 § 3
chose exactly that: `set styleClasses(value: string | null | undefined) // space-separated,
as in XML`, with an array-taking door rejected on a measurement — the LIST is the read-back.
`props` already holds that string. **And the paragraph is wrong a SECOND time, measured under
ADR 0068: a space-joined string in `props` could not be held against the goldens.** The oracle
writes the block spelling as `<class name="flat"/>` elements and the property spelling
(`css-classes: [...]`) as a `<property>` whose text is NEWLINE-joined, so one joined string
has to pick one of those and stops being comparable where the oracle picked the other. The
field that landed is therefore a LIST, `styleClasses`, filled from both spellings through one
reader — and the diagnosis below survives it unchanged, because a field is not a `props` key
and admits no gallery block: `check-generated-website-data` arm 11 reports the same 7 shared
and 17 ledgered after the change as before. What blocks the LEDGER is three spellings on three
surfaces —
`cssClasses` on `gtk-host` (`props.ts:5772`), `styleClasses` on the NativeScript port (the
GIR name is taken by `@nativescript/core`'s `ViewBase`), boolean attributes on `adwaita-web`
— against ADR 0051's rule that a block joins the shared corpus only when it needs no alias
at all. That is ADR 0034's ledger and its gate's countdown. The name is only the first half:
`gtk-host` declares `cssClasses?: string[]` where 0049 § 3's door takes a string, and
`adwaita-gallery-shared-trees.mjs`'s own comment on the two ledger entries records the
second kind beside it ("`string[]` against `Set<string>`") — the class filed above under "A
property can agree on its NAME and disagree on its VALUE KIND". A finding written by reading
a decision's TITLE rather than its clause reads exactly like a measurement, which is why this
is recorded rather than quietly corrected.

Widening `props` to hold ADRs 0042 / 0046 / 0047's portable values would move **zero**
blocks into the shared corpus: all 17 ledgered divergences are `property` (5),
`composition` (7), `content` (3) or `vocabulary` (2), and **none is a shape limit**.
`Adw.SpinRow` is the closest and is the case against — its ledger entry records that one
surface authors `adjustment` as an object and the other as the JSON string its XML door
parses, and a shared node cannot be authored in two doors whatever `props` admits.

So one loss was left needing a field, and ADR 0058 proposed it: the translatable marking,
spelled as `StringValue['translatable']` already is in the AST. ADR 0067 landed exactly that
spelling and dropped only its "never before the emitter" clause — see the paragraph below. And
where `SharedNode` must live is still open, deliberately.

**TWO OTHER LOSSES GOT A FIELD FIRST, and ADR 0066 is why.** `template` and `object-id` are
not shape questions the way `slot` is, and they are not waiting on a consumer the way the
marking is: they are GtkBuilder's ADDRESSING model, they are what stopped every shipped `.blp`
from projecting without loss, and all three surfaces have a native form for each (a composite
class and a node name; only `bind` is GTK-only). The projection now carries `id` on a node and
`template` on a root, spelled as `<template class=…>` writes it, and the shipped `.blp` that
project with no loss went from none to five of twelve.

**AND THEN THE MARKING FOLLOWED THEM, ADR 0067, on 0058's spelling and against its timing.**
0058 § 1's field is taken verbatim — `Record<prop, { context? }>` beside `props`, the AST's own
`StringValue['translatable']` per key — and § 2's "lands with the emitter, never before" is
taken back on ADR 0066's test: the projection direction has readers today, and this is the one
loss under which their output is WRONG rather than short, because a tree that lost its markings
looks finished and is unreachable by `xgettext` (ADR 0033's whole argument, and
`templates/gtk-minimal/src/main-window.blp` says so in its own comments). Shipped `.blp` with no
loss 5 of 12 → 6 of 12, corpus-wide 23 → 25 of 68, losses 151 → 125. The field's REACH is 26 of
the corpus's 43 marked strings: the other 17 sit inside a menu, a value list, a `responses`
block, a closure or a `marks` list, and leave with the construct around them. `bind`,
`breakpoint` and the file-level `translation-domain` stay refused — the domain because it is a
fact about a FILE and the only place to hang it is the root node, where a lifted subtree would
carry a domain from a file it is no longer in. Nine loss kinds are left refused, and ADR 0058's
clauses 3, 4 and 5 are untouched.

**What that measurement newly exposed was `styles`, AND ADR 0068 CLOSED IT.** Three shipped
files were blocked by it alone — `header-bar.blp`, `toolbar-view.blp`,
`gtk-minimal/src/main-window.blp` — where before the marking was always beside it, so closing
it would have moved nothing and nobody could see it. Shipped `.blp` with no loss 6 of 12 → 9 of
12, corpus-wide 25 → 30 of 68, losses 125 → 115. The family turned out to be larger than every
census had said: Blueprint spells `GtkWidget:css-classes` two ways and the projection named
their losses `styles` and `value-list`, so a per-KIND reading could not see them as one thing.
**That is the instrument finding to carry forward** — the census that found it is keyed on the
PROPERTY NAME of every bracketed value, not on the loss kind, and it is the reading to repeat
before the next family is chosen.

**The next family is `extern`, and it is now the only one left that moves anything outside a
grammar.** Measured over the same census: it is the sole loss left on four written entries of
the corpus and on none of the shipped `.blp`, it
is ADR 0062's blocker 1, and it is 3 of the 5 losses left on Learn6502's
`preferences.dialog.blp` — the file this series' outside purpose is measured against, which went
from 11 losses to 5 under ADR 0068 because all six of its style classes are written as the
PROPERTY spelling. The parser and the emitter already handle `$Extern` (`rules/32-extern-nested`
has a golden); what is open is that `SharedNode.tag` promises a GIR class name and an
application class is in no GIR. What is left on the three shipped files that still lose
something is `bind` plus `Adw.Breakpoint`, both languages rather than constructs, and both
refused by decisions of their own.
`scripts/adwaita-gallery-shared-trees.d.mts` is a hand-written declaration whose own header refuses
a second transcript, and the corpus reads it the way every other consumer does. The question
becomes forced — not sooner — by the first PR that PUBLISHES a package producing the projection:
`@gjsify/vite-plugin-blueprint` is published and would depend on the parser, so the parser package
cannot stay private forever and cannot export a type from a path outside its own tarball. The two
candidate answers are a type-only package both sides import, and a declaration in the parser that a
compile-time assignability check binds to the corpus's. Neither is free; both are cheaper to judge
with a working projection in hand than without one.


### The Blueprint emitter checks that a reference RESOLVES, and cannot check that it FITS

`emit-xml.mjs` now refuses an object reference no object in the file declares — the defect that
let `extra-menu: doesNotExist;` and the null literal reach a live property unremarked. That check
is a lookup in the file's own id index, so it needs no vocabulary and is complete for the
positions it covers. What it cannot do is the oracle's SECOND question, which needs the ParamSpec
type of every property, where `resolve-ident.mjs` carries enum and flags types and nothing else.

Three divergences follow from that one gap, each accepted here and refused by
blueprint-compiler 0.20.4, each measured:

- **A boolean setter takes the null literal.** `labelOne.visible: null;` emits
  `<setter object="labelOne" property="visible"></setter>`; the oracle answers
  `error: Expected 'true' or 'false' for boolean value`. The ENUM and FLAGS halves of the same
  rule ARE caught, via `enumOrFlagsTypeOf` — `refused/setter-null-enum.blp` holds that half —
  which is exactly why the boolean one is worth naming: the file looks like it covers the rule.
- **A reference of the wrong type resolves.** With a `Gtk.Label null` in the file, `label: null;`
  is a legal reference that this emitter writes out, and the oracle answers
  `error: Cannot assign Gtk.Label to string`. `38-null-object-id.blp` pins the half that is
  right (`menu-model: null` pointing at a `menu null`), and the wrong half is undetectable the
  same way.
- **A property name nobody has.** `bind labelOne.null` passes; the oracle answers
  `error: Gtk.Label does not have a property called null`. This one is not about `null` at all —
  every misspelled property name takes the same path.

Closing the first two is one piece of work: a property TYPE table beside the enum one, generated
from the same `@girs` metadata by the same generator. ADR 0053 clause 6 is the constraint — a
hand-written table is the `if` it refuses — so those two wait on the generator, not on a decision.

**The third does not wait for anything.** `does not have a property called X` needs only the set
of property NAMES, and `OWN_PROPS` plus `DECLS` are already exported by the same
`@girs/*/vocabulary` modules `resolve-ident.mjs` imports for the enum table. It is left out of
this change to keep one rule per change, not because it is blocked. One measured caution for
whoever takes it: 7 properties are present in the vocabulary and absent from the libadwaita
installed here, so the table runs AHEAD of the oracle — a name-only check would accept files the
oracle refuses, which is the safe direction, but it cannot be turned into a refusal without
deciding what a vocabulary/runtime disagreement means.

**A second, unrelated gap in the same check: two paths, not one.** Both write an id the check
never sees, and they are different functions, which is why naming only the list form understated
it once already:

- `emitListProperty` takes no `EmitContext`, so `widgets [doesNotExist]` emits
  `<widget name="doesNotExist"/>` where the oracle says `Could not find object with ID`.
  Threading the context in closes it.
- `extensionText` reaches `scalarText` with no owner type, so an `accessibility { }` entry passes
  in BOTH forms — the list `labelled-by: [doesNotExist]` and the scalar `labelled-by: nope;`.
  Measured, and simpler than it first looked: a bare identifier there is a reference on EVERY
  entry that is not an enum member — `labelled-by`, `described-by` and `label` alike each answer
  `Could not find object with ID nope`. So the seam already in place (`accessibilityValue`
  returning null for a non-member) is the same fork the property path uses.

Separately and pre-existing: `listItemText` admits a bare identifier for ALL THREE bracketed
lists, not just `styles`. In `widgets [ ]` that is right (the items are ids); in `styles [ ]` and
`strings [ ]` the oracle refuses any unquoted item with `Unexpected tokens`, so
`Gtk.StringList { strings [doesNotExist] }` emits `<item>doesNotExist</item>` here and is
refused there. That is a parser rule rather than a reference one, and it is the reason the list
gap cannot be closed by adding `objectRef` to `listItemText` alone: the three lists want three
different answers.



### The Blueprint parser reads bytes the reference compiler refuses to read at all

`scripts/blueprint-wild-sweep.mjs` classifies each file by what BOTH compilers do with it, and
one of its five buckets is `accepted-past-oracle` — we emit XML for a file `blueprint-compiler`
rejects. No file in the 273 wild or 95 language samples lands there. Two hand-written probes do,
and both are about encoding rather than grammar:

- **A UTF-8 BOM.** `﻿using Gtk 4.0;` parses and emits here. The oracle 0.20.4 exits 1 with
  `error: Could not determine what kind of syntax is meant here` at line 1 column 1 — it treats
  U+FEFF as an ordinary character and finds no production that starts with it.
- **An invalid UTF-8 byte sequence.** A `0xff` inside a string literal emits here as U+FFFD,
  silently, into a live property. The oracle does not reach an error message at all: it exits 1
  with a Python traceback, `UnicodeDecodeError: 'utf-8' codec can't decode byte 0xff in position
  34: invalid start byte`, and prints "The blueprint-compiler program has crashed".

Both are the ADR 0053 clause 3 shape — wrong output where the language has none — and neither is
visible to anything in this repository: `corpus/refused/` holds no file for either, so stage E
cannot ask, and stages C and D only see files the parser accepts. `readFileSync(path, 'utf8')`
is where both enter: Node replaces undecodable bytes rather than throwing, and strips nothing.

The fix is two `refused/` files and a check in the reader, not a parser feature — the subset does
not gain anything by accepting either. The oracle's own handling of the second one is a bug on its
side (a traceback is not a diagnostic), which is worth reporting upstream but changes nothing
here: it refuses the file, and we do not.

Measured on `blueprint-compiler-0.20.4-1.fc44.noarch` against the parser at `@girs` 5.2.0. The
sweep names both by path when they are in a pool, so a `refused/` file for each closes it.

**And a THIRD kind lands in the same bucket, which is a decision rather than a gap — but nothing
here said so with the oracle's own words.** ADR 0053 clause 4 keeps typelib VALIDATION with the
compiler: "`Gtk.Box { spacinng: 4; }` parses cleanly into a prop nothing rejects until a ParamSpec
lookup at runtime." Measured, the oracle does not wait for runtime — it answers `Class Gtk.Box does
not have a property called spacinng`, and `Gtk.Label { label: 4; }` is `Cannot convert number to
string`. Both emit here, and both did before expressions existed, so this is the shape of the
carve-out and not a regression. Expressions add two more of it, decidable only with the same
typelib: `bind $f() as <Gtk.Widget> as <string>` is `Invalid cast. No instance of Gtk.Widget can be
an instance of string.` and `bind l.label as <Gtk.Widget>` is the same sentence the other way round
— the second needs `GtkLabel.label`'s GType, the table `@girs` does not ship. A cast between a
built-in and a class is categorical in both directions and could be refused from the file alone; a
cast between two classes needs the ancestry, and one over a property needs the missing table. Half a
validator would refuse nothing a real file writes and could refuse a legal downcast, so the whole of
it stays where clause 4 put it. What is owed is a `refused/` file naming the class once the position
changes, and a line in the flip's decision: a build that trips a type error gets it from the
compiler, and the in-repo parser is not that reader.

