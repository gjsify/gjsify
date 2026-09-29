# acorn's stack ceiling under GJS, and the GJS build failure it explains

**Reproduction**: [`acorn-stack-ceiling.gjs.mjs`](acorn-stack-ceiling.gjs.mjs) —
`gjs -m docs/poc/acorn-stack-ceiling.gjs.mjs` (`--quick` for a short sweep)

**AST depth probe**: [`acorn-ast-depth.gjs.mjs`](acorn-ast-depth.gjs.mjs) —
`gjs -m docs/poc/acorn-ast-depth.gjs.mjs <bundle-file>`

Measured on **gjs 1.88.1 / SpiderMonkey 140** (the pairing CI uses), Linux, 2026-09-28.
Every row is a fresh process — the header explains why that is load-bearing rather than
tidiness.

## The message is acorn's, not SpiderMonkey's

A GJS build can die mid-`build` with:

```
Not enough stack space to parse input (1154:55)
```

`grep` over the engine finds nothing: neither `libmozjs-140` nor `libgjs` contains that
string. **acorn does** — `node_modules/acorn/dist/acorn.mjs`, 8.17.0:

```js
pp$9.catchStackOverflow = function (f) {
  try { return f() }
  catch (e) {
    if (e instanceof Error && (/\bstack\b.*\b(exceeded|overflow)\b/i.test(e.message) ||
                               /\btoo much recursion\b/i.test(e.message)))
      { this.raise(this.start, "Not enough stack space to parse input"); }
    else { throw e }
  }
};
```

So the underlying failure is SpiderMonkey's **"too much recursion"**, hit by acorn's
recursive descent running as ordinary JS, and acorn **re-raises it under its own name at the
token position it had reached**. Two consequences, and the second is the useful one:

- acorn is a JS parser, so it competes for SpiderMonkey's **JS stack**, not the parser's own
  budget. Its effective nesting ceiling is therefore *lower* than SpiderMonkey's parser
  ceiling for the same input, because acorn's frames are fatter and it descends per node.
- `this.start` is a position **in the input being parsed**. That is why the position a build
  reported (`1154:55`) cannot be in a source file — nothing in the failing package was that
  long — and it is the cheapest way to tell this apart from a source syntax error.

gjsify runs this parser **in-process over its own output**: `packages/infra/rolldown-plugin-gjsify`
imports acorn in `console-assign.ts`, `jsx-survival.ts`, `react-native-gate.ts` and the
`--globals auto` detector.

## The measurement

| experiment | input | result |
|---|---|---|
| **A** nesting, caller depth 0 | 200 / 400 / 500 levels | parses |
| | **600** / 800 / 1200 / 2000 levels | **FAILS `acorn-stack`** |
| **B** statements, zero nesting | 3 000 / 20 000 / 100 000 | parses |
| **C** one 200-level input, caller depth varied | 0 / 2 000 / 4 000 / 5 000 frames | parses |
| | **6 000 / 8 000 frames** | **FAILS `acorn-stack`** |

- **A** puts the ceiling between 500 and 600 nesting levels.
- **B** rules out the size theory outright: 100 000 top-level statements parse. Long lines,
  big files and megabyte output are all irrelevant.
- **C** is the intermittency. One input, two verdicts, decided by **nothing but how much
  stack the caller already occupied** — a ~2 000-frame swing is enough to halve the budget.
  Nothing about the file changed.

## Why each measurement runs in a fresh process

An in-process sweep gave *different answers for the same input* depending on what the process
had already done: a 600-level nest measured standalone **failed**, and measured after eight
earlier parses it **parsed**. A single number taken from a warm process is not a number, so the
sweep spawns one child per row and the child does the measuring.

This also corrects an earlier result of ours, which is worth recording because it is the same
mistake twice. A first version of this probe drove SpiderMonkey's **own** parser (`import` and
`new Function`) and concluded the headroom effect "did not reproduce". It did not reproduce
*there* because that parser is not the one failing, and because a module `import()` parses off
the caller's stack. Measured against **acorn** — the parser actually in the failure path — the
effect is large and unambiguous.

## What is falsified, by measurement

The three obvious candidates for "which generated file", built and measured with the probe below:

| candidate | bytes | lines | max AST depth | verdict |
|---|---|---|---|---|
| gjsify plugin bundle for GJS (`--app gjs` of `rolldown-plugin-gjsify`) | 6.3 MB | 602 | **66** | not it — far below the ceiling |
| `@gjsify/tls` test bundle, `--app gjs` | 289 kB | 180 | **49** | not it |
| `@gjsify/tls` test bundle, `--app node` | 84 kB | 172 | **49** | not it |

Depth is measured with an iterative acorn walk ([`acorn-ast-depth.gjs.mjs`](acorn-ast-depth.gjs.mjs); the walk must be
iterative, or it measures the measuring script's stack instead of the file's). Run:

```bash
gjs -m docs/poc/acorn-ast-depth.gjs.mjs packages/infra/rolldown-plugin-gjsify/plugin.gjs.mjs
gjs -m docs/poc/acorn-ast-depth.gjs.mjs packages/node/tls/test.gjs.mjs
gjs -m docs/poc/acorn-ast-depth.gjs.mjs packages/node/tls/test.node.mjs
```

So **neither the plugin bundle nor either test bundle is over the limit**, which removes the
two theories this issue was built on. What remains is some other acorn call site over some
other generated file with ≥ 1 154 lines, and the search has to start from the call sites, not
from the outputs.

## What is NOT established

- **Which file.** Named above as the open question. The reported `1154:55` is the only handle,
  and it says the file is at least that long — which none of the three measured candidates is.
- **Why the call stack differs between runs.** C shows the budget is a headroom budget, so
  something upstream varies — shard composition, how much of the CLI has run, what the caches
  held. Not measured.
- **Any fix.** None proposed. The lever the measurement does establish: acorn's parse of our
  own output is **unbounded in nesting depth**, so the fix belongs where that nesting is
  produced. Raising a stack limit would move the threshold without changing the shape that
  trips it, which this repo's rules correctly refuse to accept as a fix.

Companion to `docs/poc/tla-microtask-draining.md`, which measures an upstream GJS limit the same
way: a runnable probe, the number, and an explicit line about what is still unproven.
