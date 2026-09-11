# `@gjsify/blueprint`

The Blueprint parser, the GtkBuilder XML it emits, and the corpus of reference-compiler
goldens both are measured against.

**The parser is here now, and the corpus came first — that was the point.** [ADR
0053](../../../docs/adr/0053-blueprint-parsed-in-repo.md) decided that Blueprint is parsed in
this repository and that `blueprint-compiler` stops being a build dependency and becomes the
oracle a parser is measured against — and its § Implementation puts this package first,
because *"a harness with nothing to compare reports green while proving nothing"*.

**Every corpus file is byte-equal.** That is the condition clause 5 names for the parser to
become authoritative, so `corpus/divergences.mjs` is an empty list with its rules intact and
the compiler's remaining role is the oracle one.

## What is in here

| Path | What it holds |
|---|---|
| `corpus/rules/*.blp` | one small file per language rule |
| `corpus/rules/*.ui` | what `blueprint-compiler compile` produces from each |
| `corpus/real/*.ui` | the same, for the 11 `.blp` files this repo already builds |
| `corpus/manifest.mjs` | which rule each file isolates, and which compiler produced the goldens |
| `corpus/expectations.mjs` | the `SharedNode` tree each rule file must project to, hand-written |
| `corpus/real-expectations.mjs` | the same for the 11 real files |
| `corpus/divergences.mjs` | where the in-repo parser and the reference compiler still disagree |
| `src/ast.d.mts` | the shape a `.blp` parses into — the contract between the three below |
| `src/parser.mjs` | `.blp` text → AST, or a hard error naming its line |
| `src/emit-xml.mjs` | AST → GtkBuilder XML |
| `src/resolve-ident.mjs` | what a bare identifier means, read from the `@girs` vocabulary |
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
projecting as many objects as their golden holds, no tracked `.blp` left unprobed — runs
anywhere. Stage B recompiles every file and diffs it, and needs `blueprint-compiler` on
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
Neither stage needs a compiler — only the committed goldens — so both run on every runner, and
neither has a skip path: the parser, the emitter, the resolver and the projection live in this
repository, so a missing one is a deletion and fails rather than skipping.

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
4. **A flag set is not numbered.** `input-hints: word_completion | lowercase` stays
   `word-completion|lowercase` — hyphenated, joined with no spaces — while the enum on the
   line below it becomes a number, so one lookup answers two kinds of question
   (`rules/27-property-flags.ui`).
5. **Values are normalised, not copied.** `1.0` comes out as `1`, `0.25` and `0.5` unchanged
   (`rules/17-numeric-forms.ui`).
6. **`layout { }` and `accessibility { }` do not resolve through the widget.**
   `Gtk.Grid { Gtk.Label { layout { halign: center; } } }` emits `center`, because a layout
   entry belongs to `GtkGridLayoutChild` and not to the label; `Gtk.Label { accessibility {
   orientation: vertical; } }` emits `1` although `GtkLabel` is not orientable at all, because
   the ARIA table answers there. The widget is the table nearest to hand and it is the wrong
   one in both blocks.

And one that writing the expectations found: `SharedNode.slot` carries both `[start]`
(a `<child type="start">`) and `content:` (a `<property name="content">`), so the projection
cannot be inverted. The header of `corpus/expectations.mjs` has that and the rest.

### An earlier version of this file got item 2 wrong, and how

It claimed the published types already carried positional enum values — measured on
`node_modules/@girs/gtk-4.0`, which sat at **4.1.0** while the lockfile pinned **4.6.0**. An
independent review reached the same wrong answer from the same stale file. Two readings of one
out-of-date artefact agree with each other and not with the tree, which is worth more than the
claim they agreed on: read what is INSTALLED, and say which version that was.
