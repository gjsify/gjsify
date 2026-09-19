# `@gjsify/blueprint`

The Blueprint parser, the GtkBuilder XML it emits, and the corpus of reference-compiler
goldens both are measured against.

**The parser is here now, and the corpus came first — that was the point.** [ADR
0053](../../../docs/adr/0053-blueprint-parsed-in-repo.md) decided that Blueprint is parsed in
this repository and that `blueprint-compiler` stops being a build dependency and becomes the
oracle a parser is measured against — and its § Implementation puts this package first,
because *"a harness with nothing to compare reports green while proving nothing"*.

**The shadow run is silent, which is clause 5's precondition and not its conclusion.**
`corpus/divergences.mjs` is where a disagreement would be recorded, per line and with a reason;
how many it excuses is printed by stage C on every run and is deliberately not restated here.
Its own header says what used to be in it — the last entry was an enum property of a class that
is not a widget (`GtkSizeGroup.mode`), which had no join to its enum until the `@girs`
vocabulary stopped being a widget-only vocabulary. Every construct the subset refuses is
refused by name, held by a corpus of its own.

## What is in here

| Path | What it holds |
|---|---|
| `corpus/rules/*.blp` | one small file per language rule |
| `corpus/rules/*.ui` | what `blueprint-compiler compile` produces from each |
| `corpus/refused/*.blp` | one small file per construct the subset does NOT hold, each refused by name and by line |
| `corpus/real/*.ui` | the same, for the 12 `.blp` files this repo already builds |
| `corpus/manifest.mjs` | which rule each file isolates, and which compiler produced the goldens |
| `corpus/expectations.mjs` | the `SharedNode` tree each rule file must project to, hand-written |
| `corpus/real-expectations.mjs` | the same for the 12 real files |
| `corpus/divergences.mjs` | where the in-repo parser and the reference compiler still disagree |
| `src/index.mjs` | the package's whole surface: one compile, and the five seams it needs |
| `src/index.d.mts` | the types for those, hand-written — there is no build step |
| `src/ast.d.mts` | the shape a `.blp` parses into — the contract between the three below |
| `src/parser.mjs` | `.blp` text → AST, or a hard error naming its line |
| `src/emit-xml.mjs` | AST → GtkBuilder XML |
| `src/resolve-ident.mjs` | what a bare identifier means — a member's number, an ARIA name's element, a type's GType name — read from the `@girs` vocabulary |
| `src/builtin-types.mjs` | Blueprint's own type keywords (`string`, `bool`, `int`, …) and the GType each means — the one table here that is NOT `@girs`-derived, with the argument for why in its header |
| `src/number-literal.mjs` | one reading of a number's spelling: the parser refuses through it, both exits read through it |
| `src/project.mjs` | AST → `SharedNode`, with every loss named at the seam |

The real files are listed **by path** and read from where they live. A copy would be a second
transcript that drifts from the file the build actually compiles, and it would keep passing
while it drifted.

## Using it

```js
import { emitGtkBuilderXml, gtypeName, parseBlueprint, resolveIdent } from '@gjsify/blueprint';
```

One compile is `parseBlueprint` then `emitGtkBuilderXml`, and the emitter reaches introspection
through five optional seams (`EmitOptions`) that `resolve-ident.mjs` answers from the `@girs`
vocabulary. Those seven names plus `BlueprintSyntaxError` are the whole surface, and
`scripts/check-blueprint-corpus.mjs` imports the package by this specifier — so a dropped export
is a red gate and not a discovery made later by a consumer.

`src/project.mjs` is deliberately NOT on it. The `SharedNode` projection is ADR 0053 clause 1's
second, declared-lossy exit; its only caller is stage D of that same gate, one directory over, and
nothing outside this repository has asked for a shape whose whole point is what it drops.

The package is `private` and is not published. The first publish is a human step — OIDC cannot
create a package name — and it belongs to the change that makes the parser authoritative, not to
the one that gave it a door.

## Running it

```sh
node scripts/check-blueprint-corpus.mjs                   # from the repo root
node scripts/check-blueprint-corpus.mjs --write           # re-derive every golden
node scripts/check-blueprint-corpus.mjs --require-oracle  # …and refuse to skip stage B

# and the measurement that is NOT the corpus: the same parser over `.blp` nobody here wrote,
# from nine pinned upstreams. Needs the binary, the tree's @girs pins, and the network once.
node scripts/blueprint-wild-sweep.mjs --help
node scripts/blueprint-wild-sweep.mjs --dry-run           # the pinned sources, fetch nothing
```

Beside it, the census — what the real `.blp` files in the tree actually use:

```sh
node scripts/report-blueprint-census.mjs              # at HEAD
node scripts/report-blueprint-census.mjs 3e12aefe1a^  # …or at any revision
node scripts/report-blueprint-census.mjs --markdown   # ADR 0053's table block
node scripts/check-blueprint-census.mjs               # the ADR still matches the tree
```

The reporter derives its file list from `git ls-tree`, so an older revision reproduces that
revision's numbers. ADR 0053 § Context does not transcribe its table — it carries the
`--markdown` output verbatim, and the gate fails when the two drift. That arrangement exists
because the hand-count it replaced went stale the moment a twelfth `.blp` landed and nothing
noticed, so a failure there is fixed by pasting the measurement, never by editing a number.

Stage A — corpus complete and each file listed once, expectations structurally valid and
projecting as many objects as their golden holds, every refusal listed with the line and the
text its error must carry, no tracked `.blp` left unprobed — runs anywhere. Stage B recompiles every file and diffs it, and needs `blueprint-compiler` on
`PATH`; where it is absent the run says so by name rather than reporting a quiet green. In CI
both stages run in `tree-checks` — the one job with no classifier gate, on the image that
bakes the compiler — and with `--require-oracle`, because an announced skip is honest on a
laptop and a hole in the one run that is supposed to prove something.

Stage C runs the in-repo parser and emitter over every file and diffs the result against the
goldens. A disagreement fails unless `corpus/divergences.mjs` says why, and it says why per
LINE: an entry excuses the lines it lists and every other line of that file is held to the
golden. An entry for a file that no longer disagrees fails too, and so does a listed line that
now agrees, so the ledger cannot only grow — and that second direction is what retired the
last eleven entries, as eleven failures saying "delete me" rather than a hand edit. Stage D
runs the projection over the same files and holds the hand-written `SharedNode` trees and
their declared losses against it, which is what turns them from a claim into an oracle.
Stage E runs the same pipeline over every file under `corpus/refused/` and holds the XML exit to
a hard error that names the construct and the line, and the projection to what the manifest
records of it — the one stage that can measure ADR 0053 clause 3, because stages C and D see
only what the parser accepts. Where the oracle is present, stage B
also records what it does with each refused file, so the table says which refusals are limits
of the subset (the oracle compiles the file) and which are errors the two compilers share.
None of these stages needs a compiler — only the committed goldens — so all run on every
runner, and none has a skip path: the parser, the emitter, the resolver and the projection
live in this repository, so a missing one is a deletion and fails rather than skipping.

If stage B fails on a version mismatch, that is not noise. [ADR 0053 clause
5](../../../docs/adr/0053-blueprint-parsed-in-repo.md): after an upstream release, a run that
starts reporting **is** the upgrade notice. Re-derive with `--write`: it names every golden
whose bytes moved and moves `ORACLE.version` in `corpus/manifest.mjs` itself, so the goldens
and the version that produced them land in one commit — then read that diff, because it is
the notice.

## What the goldens settled

Each of these is reproducible from the `.ui` file named. They are written up here and not
beside the data, and the header of `corpus/manifest.mjs` says why: they are findings about the
corpus rather than facts about that table, and a second copy of them next to the data is what
would drift.

1. **Emission needs introspection, not just a parse.** `orientation: vertical` leaves the
   compiler as `<property name="orientation">1</property>` (`rules/03-property-enum.ui`). ADR
   0053 reserved the typelib for *validation*; enum-valued properties mean the emitter needs
   GIR knowledge too, which is [§ Amendment
   1](../../../docs/adr/0053-blueprint-parsed-in-repo.md).
2. **`@girs` supplies it — and it took two releases, not one.** The number behind a nick
   (`ENUM_VALUES`, ts-for-gir [#465](https://github.com/gjsify/ts-for-gir/pull/465), `@girs`
   4.8.0) is only half; the other half is WHICH enum a property is (`PROP_ENUMS`,
   [#467](https://github.com/gjsify/ts-for-gir/pull/467), 4.9.0), and without it the emitter
   would have had to search the nick lists for an enum with a member called `never` and guess
   between the several that have one. `src/resolve-ident.mjs` does both lookups, from a pinned
   npm dependency rather than an installed typelib, so stage C keeps running on a runner with
   no GNOME on it.
3. **The member spelling is not the nick spelling.** Blueprint writes a member with
   UNDERSCORES and the GIR keys it with hyphens: `halign: baseline_fill` is `4` and
   `halign: baseline-fill` is an error (`rules/03-property-enum.ui`).
4. **A flag set is not numbered, and a lone flag is.** `input-hints: word_completion |
   lowercase` stays `word-completion|lowercase` — hyphenated, joined with no spaces — while
   `input-hints: lowercase` on its own is `8`: the oracle reads a `|`-joined set as flags and
   a single identifier as a literal, which it numbers whatever the type. The rule file held
   only the set, and the resolver returned the nick for both, until it held the second entry
   (`rules/27-property-flags.ui`). And the `|` carries a type check of its own: a set on an
   ENUM (`orientation: vertical | horizontal`) is "not a bitfield type" to the oracle, and the
   resolver emitted it by member count until `corpus/refused/flags-on-enum.blp` held it.
5. **Values are normalised, not copied.** `1.0` comes out as `1`, `0.25` and `0.5` unchanged
   (`rules/17-numeric-forms.ui`).
6. **`layout { }` and `accessibility { }` do not resolve through the widget.**
   `Gtk.Grid { Gtk.Label { layout { halign: center; } } }` emits `center`, because a layout
   entry belongs to `GtkGridLayoutChild` and not to the label (`rules/19-layout.ui`);
   `Gtk.Label { accessibility { orientation: vertical; } }` emits `1` although `GtkLabel` is
   not orientable at all, because the ARIA table answers there. The widget is the table
   nearest to hand and it is the wrong one in both blocks.
7. **An `accessibility { }` block is three kinds of element, not one — and the same is true
   of its values.** `label` is a `<property>`, `row-index` a `<relation>` and `checked` a
   `<state>`, all spelled alike in the block (`rules/20-accessibility.ui`). Which name is which
   IS in the vocabulary — the nick lists of `GtkAccessibleProperty`, `GtkAccessibleRelation`
   and `GtkAccessibleState`. The VALUE was not, and became so in `@girs` 5.1.0
   (`ARIA_VALUE_TYPES` + `ARIA_VALUE_ENUMS`, read from each member's own GIR documentation
   because `gtk_accessible_property_init_value` is C and not introspectable). The sharpest
   line in that golden is the pair of `<state>` elements: `checked: true` is `1` because the
   slot is a `GtkAccessibleTristate`, and `hidden: true` — the same four characters — stays
   `true` because that slot is a boolean. The emitter wrote `<property>` for every entry, and
   then the source spelling for every value, until this rule file held anything else. And it
   was thin a third time, found in review: with every `<state>` a boolean and every enum
   `<property>` an identifier, a rule keyed by ELEMENT kind — identifiers resolve on a property,
   booleans on a state — was byte-equal against the whole corpus. `pressed: mixed` is `2`, an
   identifier on a state and the tristate's third member, and holds it out. The greedy guess
   Amendment 1 refused — search every enum's nicks for the member, take the first hit — is held
   out too, but by no numbered line: on this GTK the ARIA enums sort first in `ENUM_VALUES` and
   win every collision (20 of 20 rows), so it is `refused/unknown-accessibility-member.blp` that
   catches it, by accepting `sideways`.
8. **A GType name is not namespace plus name, and the prefix is not ours to keep.**
   `Gio.ListStore` is `<object class="GListStore">`, and the emitter concatenated — right for
   `Gtk` and `Adw`, whose C prefix is the namespace, and silently wrong for any third `using`.
   The name became a resolver seam that refuses a namespace it has no vocabulary for
   (`corpus/refused/namespace-without-vocabulary.blp`) — and the projection, which concatenated
   the same way, takes the same seam, because a tag is the one thing that exit must spell right.
   The prefix itself was then a two-entry `Map` in `resolve-ident.mjs`, which is the hand-written
   table ADR 0053 clause 6 forbids, short enough not to look like one: it is now read off the
   GTypes each vocabulary declares (their longest common prefix, backed off to a CamelCase
   boundary). **That is a derivation over the five namespaces loaded, not a law about GIR** —
   swept over the 135 GIRs installed on one workstation it gets 28 of the 104 that declare a
   concrete class WRONG, `GdkX11` and eight `Gst*` among them, and four namespaces carry a
   multi-valued prefix a single string cannot express. None of the 28 publishes a vocabulary, so
   none is reachable; the day one does, the prefix has to come from upstream instead.
   `rules/39-namespace-vocabulary.blp` holds two namespaces the corpus was not written against.
9. **The vocabulary is a widget vocabulary.** `Gtk.SizeGroup { mode: horizontal; }` emits
   `1` from the oracle and `horizontal` from the resolver, because `PROP_ENUMS` has no join
   for a class outside the widget tree — the last entry the shadow ledger held
   (`rules/29-enum-non-widget.ui`), retired by the `@girs` 5.2.0 bump in #1692.
10. **A type reference asks two different questions, and one table answers only one of them.** `<prefix><Name>` is checked against
    `DECLS` where the type is INSTANTIATED — a wrong prefix is then a refusal and not a class
    GtkBuilder resolves to nothing, and that is empirical rather than proved: over all 2182
    concrete classes in those GIRs there is no case where a wrong derivation still lands on a
    declared name, and `{FooBarOne, FooBarBarOne}` is the shape that would. It is NOT checked
    where a type is merely NAMED: `template $Foo: Gtk.Widget { }` is a file the oracle compiles,
    `DECLS` holds instantiable GTypes only, and applying the object position's check to a template
    parent refused all 19 abstract classes Gtk and Adw declare. The reference implementation draws
    the same line, in its own `tests/sample_errors/abstract_class.blp`.
    `rules/41-template-parent-abstract.blp` and `refused/abstract-instantiation.blp` are the two
    sides, and neither sweep could have found it — which is what a written rule file is for. The
    object half is a strengthening the merge-base did not have: `Gtk.Widget { }` used to emit
    `<object class="GtkWidget">` for a file the oracle rejects.
11. **The vocabulary gate is per NAMESPACE, and that is a gate and not a shortage of data.**
    ts-for-gir emits the `./vocabulary` subpath only for a namespace declaring a concrete
    `GtkWidget` descendant. `GtkSource`, `Shumate` and `WebKit` qualify; `Gdk`, `Gio` and
    `GObject` do not, although `Gdk.Cursor`, `Gio.ListStore` and `GObject.Object` are all legal
    in a `.blp` and all three appear in files the reference implementation compiles. Nothing in
    this package can close that — the GType name lives in the GIR's `glib:type-name` and in no
    `@girs` artefact those three publish — so they stay a hard error naming the namespace, and the
    fix is upstream in that gate. When it lands, a namespace arrives here as one import and one
    dependency line: everything else is read out of the module.
12. **Members on one line keep source order inside a menu too.** `submenu { item (…) label:
    "…"; }` emits the item first; the menu body had no `order` counter and the emitter's own
    comment called it a known gap that no file reached (`rules/26-one-line-members.ui`).
13. **The projection has to read a number's spelling as carefully as the XML exit does.**
    `margin-start: 1_000` projected as `null`, because `Number("1_000")` is `NaN`, while the
    XML exit had stripped the underscore all along — and with the underscore stripped,
    `-0x10` still did, because `Number()` reads no sign on a hex string, while the XML exit
    had split the sign off all along. Two exits, two readers, the second one wrong twice: both
    read through `src/number-literal.mjs` now, and the parser refuses `0xZZ` there by line, as
    the oracle does. Stage D caught both the moment `rules/17-numeric-forms.blp` held the form
    — the first defects that stage has found.

14. **An extern type is not a type with the sigil stripped.** `$MyWidget { }` — the form 49
    files and 58 sites need (ADR 0062) — emits `<object class="MyWidget">`, and a dotted
    `$Ns.Inner` CONCATENATES to `NsInner`, which is the one place concatenation is right
    rather than the fallback item 8 corrected. What the name cannot carry is the other half:
    nothing inside an extern object is resolved, because the class is in no GIR. Measured in
    one file, `rules/33-extern-unresolved.ui`: `$GtkBox { orientation: vertical; }` emits
    `vertical` and `Gtk.Box { orientation: vertical; }` emits `1`, under the identical
    `class="GtkBox"`. So extern-ness travels on `TypeRef.extern` and cannot be read back off
    the GType name — and it travels to TWO call sites, the object body and a `setters { }`
    target, which is why that file writes both.

    It is also the one spelling that reaches a namespace the resolver has no vocabulary for,
    and `rules/35-extern-real-class.blp` pins how far that goes. `Gio.ListStore` is refused
    (`refused/namespace-without-vocabulary.blp`) and `$Gio.ListStore` does NOT reach it —
    concatenation makes that `GioListStore`, a different class. `$GListStore` does, because
    the C name is written out, and GtkBuilder resolves the result. So the gate holds on the
    dotted form, the extern form asks for the GType by name, and the `extern` loss says the
    projection read nothing inside the object — never that the tag is unknown.

15. **A `bind` has two output shapes and the source decides which — including by its
    brackets.** `bind labelOne.label` is `<property … bind-source="labelOne"
    bind-property="label"/>` and `bind (labelOne.label)` is a `<binding>` element wrapping a
    `<lookup>`: the same lookup, two outputs, told apart by nothing but a parenthesis. The
    collapsed form survives exactly ONE cast (`… as <string> as <string>` is the element form
    again) and is the only form that may carry flags — `Only bindings with a single lookup can
    have flags` is the oracle's own words for the same predicate. A cast between the identifier
    and the dot moves the id out of the lookup's text and into a nested `<constant>`. A parser
    that dropped parentheses as noise would emit the collapsed shape for a file the oracle
    refuses, which is why `ParenExpression` is a node in `ast.d.mts` rather than a formatting
    detail. `rules/42-expression-binding-shape.blp` is all seven shapes in one file.

16. **The one table in here that is not `@girs`-derived, and the measurement that proves it
    cannot be.** `as <string>` is `gchararray`, `as <int>` is `gint` — twelve keywords that
    belong to Blueprint's grammar, not to any GIR, so nothing in `@girs` has a row to key them
    by. That much is an argument; `as <double>` is the measurement. 0.20.4 writes **`gfloat`**
    for it, exactly as for `as <float>`, so a table derived from GObject's fundamentals would
    have said `gdouble` and been wrong on that row. `src/builtin-types.mjs` carries both the
    table and that reasoning, and `rules/46-expression-cast-builtins.blp` holds the twelve
    answers.

17. **A second thing `@girs` does not ship, and it has the same owner as item 11.** The oracle
    infers a type from a PROPERTY in two places: the middle of an uncast lookup chain
    (`a.parent.name` is `<lookup name="name" type="GtkWidget">`, read off `GtkLabel.parent`)
    and the return type of an uncast closure (`label: bind $f()` is
    `<closure … type="gchararray">`, read off `GtkLabel.label`). The vocabulary has no
    property-to-GType table — `OWN_PROPS` is a list of property NAMES and `PROP_ENUMS` joins
    only the enum-typed ones — so neither can be derived, and clause 6 forbids writing one out
    by hand. Both are refused by name and by line
    (`refused/binding-lookup-chain.blp`, `refused/expression-closure-untyped.blp`), and the fix
    is upstream in ts-for-gir beside item 11's. Every closure in the 273-file wild corpus writes
    its cast; eight files in the reference implementation's `tests/samples` do not.

18. **`item` emits nothing, which is exactly why it needs a check of its own.** It is the
    implicit subject of a list-item expression, so `expr item as <Gtk.Entry>.visible` is
    `<lookup name="visible" type="GtkEntry"></lookup>` with an empty body. An emitter that
    simply skipped it therefore produced well-formed output for two files 0.20.4 rejects —
    `item` inside a `bind` (`"item" can only be used in an expression literal`) and `item` as a
    value rather than a lookup base (`"item" can only be used for looking up properties`). That
    is the `accepted-past-oracle` bucket, never seen in the wild corpus before and unreachable
    by any golden, because a golden exists only for a file both compilers accept.
    `refused/expression-item-in-bind.blp` holds it.

Most of these were found the same way: by asking a rule file that probed ONE shape of its
construct what the other shapes looked like. A rule file that probes one case proves nothing
about the others, and a construct nothing probes is one nothing prints either.

And one that writing the expectations found: `SharedNode.slot` carries both `[start]`
(a `<child type="start">`) and `content:` (a `<property name="content">`), so the projection
cannot be inverted. The header of `corpus/expectations.mjs` has that and the rest.

### An earlier version of this file got item 2 wrong, and how

It claimed the published types already carried positional enum values — measured on
`node_modules/@girs/gtk-4.0`, which sat at **4.1.0** while the lockfile pinned **4.6.0**. An
independent review reached the same wrong answer from the same stale file. Two readings of one
out-of-date artefact agree with each other and not with the tree, which is worth more than the
claim they agreed on: read what is INSTALLED, and say which version that was.

## Reference sites, enumerated

An object reference is an id GtkBuilder looks up, and the oracle refuses one nothing declares
(`error: Could not find object with ID doesNotExist`). The emitter must refuse it too, so the
question "have we covered them all" needs an answer that is not a memory of the ones we fixed —
the first cut of that rule fixed three sites and shipped a fourth unchecked, and it was a
reviewer and not the corpus that found it.

The enumeration is mechanical. Every attribute or text node `emit-xml.mjs` builds from a parsed
IDENTIFIER is a candidate; `grep -n 'xml.startTag\|xml.selfClosing\|xml.text' src/emit-xml.mjs`
lists all of them, and each one is then read off as "does GtkBuilder resolve this string as an
object id". That gives eleven, and every one is accounted for:

| site | written from | verdict |
|---|---|---|
| `bind-source` on a property | `simpleLookup(…).source` | checked (`objectRef`) |
| a property value, resolver branch | `value.name` | checked |
| `object` on a `<setter>` | the setter target | checked |
| `object` on a `<signal>` | `signal.object` | checked |
| a property value, pass-through branch | `value.name` | NOT a reference — a `layout { }` entry is resolved by the layout manager, and a property on an EXTERN body (or a setter on an extern target) has no vocabulary to resolve against; the oracle passes the spelling through in both, byte-equal |
| `<widget name=…>` in a list | `listItemText` | unchecked, declared |
| an `accessibility { }` entry | `extensionText` | unchecked, declared |
| `id` on a `<response>` | `response.name` | NOT a reference — a response id is not an object id, and stays one even when an object of that id exists |
| an item of a property array | `arrayItemText` | a reference the oracle resolves, that our parser never reaches — see below |
| an identifier inside an expression | `identConstantText` | checked (`objectRef`), in both shapes it takes — a `<lookup>`'s text and a `<constant>` element |
| `type` on a `<lookup>` | `expressionType` | NOT a reference — it is the GType NAME of the object the id names, read out of the same index, and a `<lookup type=…>` GtkBuilder cannot resolve is a type error and not a missing id. The id it was derived FROM is checked one row up, on the same node |

The two unchecked ones are in `status/open-todos.md` with what each would take. The rule for
anyone adding another: if the string is an id, it takes `objectRef`, and it gets a file under
`corpus/refused/` so stage E holds the refusal by name and by line.

The last row is the one to read before loosening anything. `css-classes: [doesNotExist];` is a
reference to the oracle — `Could not find object with ID doesNotExist` — but `arrayItemText`
never sees it, because the parser refuses a non-string array item first. Both ends refuse, so
nothing diverges today, and the day that parser rule is relaxed the reference becomes unchecked
in the same commit. It is the same shape as the named-menu-section note in `indexObjectIds`: a
row whose verdict rests on a limit somewhere else, which is why it is written down beside the
rows that rest on the language.
