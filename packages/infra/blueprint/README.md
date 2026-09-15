# `@gjsify/blueprint`

The Blueprint parser, the GtkBuilder XML it emits, and the corpus of reference-compiler
goldens both are measured against.

**The parser is here now, and the corpus came first — that was the point.** [ADR
0053](../../../docs/adr/0053-blueprint-parsed-in-repo.md) decided that Blueprint is parsed in
this repository and that `blueprint-compiler` stops being a build dependency and becomes the
oracle a parser is measured against — and its § Implementation puts this package first,
because *"a harness with nothing to compare reports green while proving nothing"*.

**One divergence is left, on one line, waiting on a fact.** Clause 5 makes the parser
authoritative once the shadow run is silent; `corpus/divergences.mjs` holds one entry — an enum
property of a class that is not a widget (`GtkSizeGroup.mode`) has no join to its enum, because
the `@girs` vocabulary is a widget vocabulary. Everything else in the corpus is byte-equal, and
every construct the subset refuses is refused by name, held by a corpus of its own.

## What is in here

| Path | What it holds |
|---|---|
| `corpus/rules/*.blp` | one small file per language rule |
| `corpus/rules/*.ui` | what `blueprint-compiler compile` produces from each |
| `corpus/refused/*.blp` | one small file per construct the subset does NOT hold, each refused by name and by line |
| `corpus/real/*.ui` | the same, for the 11 `.blp` files this repo already builds |
| `corpus/manifest.mjs` | which rule each file isolates, and which compiler produced the goldens |
| `corpus/expectations.mjs` | the `SharedNode` tree each rule file must project to, hand-written |
| `corpus/real-expectations.mjs` | the same for the 11 real files |
| `corpus/divergences.mjs` | where the in-repo parser and the reference compiler still disagree |
| `src/ast.d.mts` | the shape a `.blp` parses into — the contract between the three below |
| `src/parser.mjs` | `.blp` text → AST, or a hard error naming its line |
| `src/emit-xml.mjs` | AST → GtkBuilder XML |
| `src/resolve-ident.mjs` | what a bare identifier means — a member's number, an ARIA name's element, a type's GType name — read from the `@girs` vocabulary |
| `src/number-literal.mjs` | one reading of a number's spelling: the parser refuses through it, both exits read through it |
| `src/project.mjs` | AST → `SharedNode`, with every loss named at the seam |

The real files are listed **by path** and read from where they live. A copy would be a second
transcript that drifts from the file the build actually compiles, and it would keep passing
while it drifted.

## Running it

```sh
node scripts/check-blueprint-corpus.mjs                   # from the repo root
node scripts/check-blueprint-corpus.mjs --write           # re-derive every golden
node scripts/check-blueprint-corpus.mjs --require-oracle  # …and refuse to skip stage B
```

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
8. **A GType name is not namespace plus name.** `Gio.ListStore` is `<object
   class="GListStore">`, and the emitter concatenated — right for `Gtk` and `Adw`, whose C
   prefix is the namespace, and silently wrong for any third `using`. The name is now a
   resolver seam that refuses a namespace it has no vocabulary for
   (`corpus/refused/namespace-without-vocabulary.blp`) — and the projection, which
   concatenated the same way, takes the same seam, because a tag is the one thing that exit
   must spell right.
9. **The vocabulary is a widget vocabulary.** `Gtk.SizeGroup { mode: horizontal; }` emits
   `1` from the oracle and `horizontal` from the resolver, because `PROP_ENUMS` has no join
   for a class outside the widget tree — the one ledger entry left (`rules/29-enum-non-widget.ui`).
10. **Members on one line keep source order inside a menu too.** `submenu { item (…) label:
    "…"; }` emits the item first; the menu body had no `order` counter and the emitter's own
    comment called it a known gap that no file reached (`rules/26-one-line-members.ui`).
11. **The projection has to read a number's spelling as carefully as the XML exit does.**
    `margin-start: 1_000` projected as `null`, because `Number("1_000")` is `NaN`, while the
    XML exit had stripped the underscore all along — and with the underscore stripped,
    `-0x10` still did, because `Number()` reads no sign on a hex string, while the XML exit
    had split the sign off all along. Two exits, two readers, the second one wrong twice: both
    read through `src/number-literal.mjs` now, and the parser refuses `0xZZ` there by line, as
    the oracle does. Stage D caught both the moment `rules/17-numeric-forms.blp` held the form
    — the first defects that stage has found.

12. **An extern type is not a type with the sigil stripped.** `$MyWidget { }` — the form 49
    files and 58 sites need (ADR 0062) — emits `<object class="MyWidget">`, and a dotted
    `$Ns.Inner` CONCATENATES to `NsInner`, which is the one place concatenation is right
    rather than the fallback item 8 corrected. What the name cannot carry is the other half:
    nothing inside an extern object is resolved, because the class is in no GIR. Measured in
    one file, `rules/33-extern-unresolved.ui`: `$GtkBox { orientation: vertical; }` emits
    `vertical` and `Gtk.Box { orientation: vertical; }` emits `1`, under the identical
    `class="GtkBox"`. So extern-ness travels on `TypeRef.extern` and cannot be read back off
    the GType name — and it travels to TWO call sites, the object body and a `setters { }`
    target, which is why that file writes both.

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
