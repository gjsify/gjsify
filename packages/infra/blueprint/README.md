# `@gjsify/blueprint`

The Blueprint corpus and the GtkBuilder XML the reference compiler produces from it.

**There is no parser here yet, and that is the point.** [ADR
0053](../../../docs/adr/0053-blueprint-parsed-in-repo.md) decided that Blueprint is parsed in
this repository and that `blueprint-compiler` stops being a build dependency and becomes the
oracle a parser is measured against — and its § Implementation puts this package first,
because *"a harness with nothing to compare reports green while proving nothing"*.

## What is in here

| Path | What it holds |
|---|---|
| `corpus/rules/*.blp` | 25 small files, one per language rule |
| `corpus/rules/*.ui` | what `blueprint-compiler compile` produces from each |
| `corpus/real/*.ui` | the same, for the 11 `.blp` files this repo already builds |
| `corpus/manifest.mjs` | which rule each file isolates, and which compiler produced the goldens |
| `corpus/expectations.mjs` | the `SharedNode` tree each rule file must project to, hand-written |
| `corpus/real-expectations.mjs` | the same for the 11 real files |

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
anywhere. Stage B recompiles all 36 files and diffs them, and needs `blueprint-compiler` on
`PATH`; where it is absent the run says so by name rather than reporting a quiet green. In CI
both stages run in `tree-checks` — the one job with no classifier gate, on the image that
bakes the compiler — and with `--require-oracle`, because an announced skip is honest on a
laptop and a hole in the one run that is supposed to prove something.

If stage B fails on a version mismatch, that is not noise. [ADR 0053 clause
5](../../../docs/adr/0053-blueprint-parsed-in-repo.md): after an upstream release, a run that
starts reporting **is** the upgrade notice. Re-derive with `--write`: it names every golden
whose bytes moved and moves `ORACLE.version` in `corpus/manifest.mjs` itself, so the goldens
and the version that produced them land in one commit — then read that diff, because it is
the notice.

## What the goldens already settled

Three things, before a line of parser exists — each reproducible from the `.ui` file named.
They are written up here and not beside the data, and the header of `corpus/manifest.mjs`
says why: they are findings about the corpus rather than facts about that table, and a
second copy of them next to the data is what would drift.

1. **Emission needs introspection, not just a parse.** `orientation: vertical` leaves the
   compiler as `<property name="orientation">1</property>` (`rules/03-property-enum.ui`). ADR
   0053 reserved the typelib for *validation*; enum-valued properties mean the emitter needs
   GIR knowledge too.
2. **`@girs` can supply it, and the check that said otherwise read a stale install.** The
   first version of this file claimed the published types carry positional enum values
   — measured on `node_modules/@girs/gtk-4.0`, which sits at **4.1.0** while this repo's
   lockfile pins **4.6.0**. From `@girs` 4.5.0 the `.d.ts` carries the GIR's own numbers
   (`ts-for-gir` [#455](https://github.com/gjsify/ts-for-gir/pull/455)), so `ResponseType.NONE`
   is `-1` there as it is in the GIR. An independent review confirmed the wrong claim from
   the same stale file, which is the useful half of this entry: two readings of one
   out-of-date artefact agree with each other and not with the tree.
3. **Values are normalised, not copied.** `1.0` comes out as `1`, `0.25` and `0.5` unchanged
   (`rules/17-numeric-forms.ui`).

And one that writing the expectations found: `SharedNode.slot` carries both `[start]`
(a `<child type="start">`) and `content:` (a `<property name="content">`), so the projection
cannot be inverted. The header of `corpus/expectations.mjs` has that and the rest.
