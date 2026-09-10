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
node scripts/check-blueprint-corpus.mjs            # from the repo root
node scripts/check-blueprint-corpus.mjs --write    # re-derive every golden
```

Stage A — corpus complete, expectations structurally valid, no tracked `.blp` left unprobed —
runs anywhere. Stage B recompiles all 36 files and diffs them, and needs `blueprint-compiler`
on `PATH`; where it is absent the run says so by name rather than reporting a quiet green. In
CI both stages run in `tree-checks`, the one job whose image bakes the compiler.

If stage B fails on a version mismatch, that is not noise. [ADR 0053 clause
5](../../../docs/adr/0053-blueprint-parsed-in-repo.md): after an upstream release, a run that
starts reporting **is** the upgrade notice. Re-derive with `--write`, read the diff, and move
`ORACLE.version` in `corpus/manifest.mjs` in the same commit.

## What the goldens already settled

Three things, before a line of parser exists — each reproducible from the `.ui` file named,
and each written up in the header of `corpus/manifest.mjs`:

1. **Emission needs introspection, not just a parse.** `orientation: vertical` leaves the
   compiler as `<property name="orientation">1</property>` (`rules/03-property-enum.ui`). ADR
   0053 reserved the typelib for *validation*; enum-valued properties mean the emitter needs
   GIR knowledge too.
2. **The published `@girs` types are not that source.** Their enum members carry positional
   values, which is wrong wherever the GIR is not `0,1,2…` — `Gtk.ResponseType.NONE` is `-1`
   in the GIR and `0` in the `.d.ts`.
3. **Values are normalised, not copied.** `1.0` comes out as `1`, `0.25` and `0.5` unchanged
   (`rules/17-numeric-forms.ui`).

And one that writing the expectations found: `SharedNode.slot` carries both `[start]`
(a `<child type="start">`) and `content:` (a `<property name="content">`), so the projection
cannot be inverted. The header of `corpus/expectations.mjs` has that and the rest.
