# @gjsify/node-gi — one source, four runtimes

The capstone proof for [`@gjsify/node-gi`](../node-gi): several **unchanged**
GJS / GObject-Introspection programs that build and run **byte-identically** on
**GJS, Node.js, Bun and Deno**.

> **Status: experimental (Tier 3 —
> [ADR 0005](../../../docs/adr/0005-node-gi-scope.md)).** node-gi's scope today
> is CI/benchmarks/dev tooling — not production apps. See the
> [`@gjsify/node-gi` README](../node-gi/README.md) for the dependency-isolation
> rule and the graduation gate.

```
gjsify build src/<s>.ts --app gjs   → gjs                         -m dist/<s>.gjs.mjs   (native gi://)
gjsify build src/<s>.ts --app node  → node | bun | deno              dist/<s>.node.mjs  (@gjsify/node-gi)
```

The `gjsify` bundler keeps the `gi://` imports native for the GJS target and
rewrites them onto the node-gi L1 runtime (`requireGi`) for the Node target — and
because that addon is a Node-API binary, the **same `--app node` bundle** runs on
Node, Bun and Deno (Node-API is their common ABI). The GJS ambient `print` global
is injected for the Node build by `--globals auto` (the `@gjsify/node-gi/globals`
shim) — no `/register` import in the source.

**GJS is the reference:** node/bun/deno output must equal the gjs output exactly,
and each scenario's fixed golden. The harness ([`harness.mjs`](harness.mjs)) skips
a runtime not on `PATH`, so it proves gjs+node where only those exist and all four
where bun+deno are installed.

**Shared runtime tooling.** The CLI ships this four-runtime map (`RUNTIMES`,
`availableRuntimes()`, the runtime→build-target mapping) as first-party shared tooling
(`@gjsify/cli/lib/utils/runtimes.js`), which powers
`gjsify run --runtime <gjs|node|bun|deno>` and `gjsify showcase --runtime`. This example
keeps a small **self-contained copy** in [`harness.mjs`](harness.mjs) on purpose: it runs
as a standalone *published* consumer (it installs the published `@gjsify/cli`), so it must
not import CLI internals. Keep the two in sync when either moves.

## Scenarios

Each source is a self-contained, deterministic `gi://` program (see
[`quad.e2e.mjs`](quad.e2e.mjs)):

| Scenario | Source | Exercises |
|---|---|---|
| capstone | [`src/app.ts`](src/app.ts) | namespace function, enums/flags/constants, GObject construct + methods + property, a counted signal, a static+instance method, a `GObject.registerClass` subclass (custom property + signal + `describe()` + `vfunc_constructed`), a bounded `GLib.MainLoop` + `timeout_add` ticker |
| variants | [`src/variants.ts`](src/variants.ts) | `GLib.markup_escape_text`, `GLib.compute_checksum_for_string`, enums, and `GLib.Variant` build + `deepUnpack` for tuples / dicts / scalars |
| signals | [`src/signals.ts`](src/signals.ts) | property round-trip, `notify::` counting across two handlers with `disconnect()`, and a `registerClass` custom signal emitted in a loop |

Every value is **deterministic** — no hostname, no machine paths — and never
depends on a signal callback's arguments (the Node runtime omits the emitter as
the first callback arg, so scenarios only ever *count* emissions). That is what
lets all four runtimes produce byte-identical output. Sources are written in
**JS-valid TypeScript** (types come from ambient `.d.ts` — no `as`/annotation
syntax in executable positions) so the runtime twin below runs them directly.

The capstone golden:

```
node-gi dual example
basename-fn: gjs
bus-session: 2
priority-default: 0
action-name: greet
action-enabled: true
action-enabled-after: false
notify-count: 2
file-basename: share
counter: describe="built@10 count=12" bumps=2 constructed=1
ticks: 3
done
```

## Run it

```bash
npm install      # builds @gjsify/node-gi's native addon via the file: dependency
npm test         # node --test quad.e2e.mjs — builds each scenario and asserts
                 # gjs === node === bun === deno === GOLDEN on every runtime on PATH

# manual single-scenario runs (capstone):
npm run build
npm run start:gjs
npm run start:node
npm run start:bun
npm run start:deno   # uses --node-modules-dir=manual (see note below)
```

> **Deno note.** Run the node bundle with `deno run -A --node-modules-dir=manual`
> — `--node-modules-dir=auto` would try to re-resolve the example's heavy
> build-time dep tree (`@gjsify/cli` + every platform binary) and hang. `manual`
> uses the already-installed `node_modules` (where the only runtime dep,
> `@gjsify/node-gi`, is linked).

> The dependency here is `"@gjsify/node-gi": "file:../node-gi"` so the example
> validates the in-tree runtime. The real consumer form is the published package:
> `"@gjsify/node-gi": "^0.13.0"`.

> **CLI note.** The real `gjsify build --app node` rewrite of `gi://` → `requireGi`
> (+ the `@gjsify/node-gi/globals` injection) needs a `gjsify` CLI that carries the
> node-gi bundler integration. That ships on the gjsify `main` branch; it is newer
> than the `@gjsify/cli` currently on npm's `latest` tag. With an older CLI the
> node bundle stubs `gi://`, so the harness falls back to the **runtime twin** — the
> exact module shape the bundler emits (`import '@gjsify/node-gi/globals'` +
> `requireGi('Ns','ver')` per `gi://` import) — and runs THAT on node/bun/deno.
> Either way the output must match gjs. `--app gjs` works with any CLI.

## Requirements

- Node.js ≥ 20 and the `gjs` binary on `PATH`. Bun and/or Deno are optional —
  the harness runs whichever of the four are present.
- A C++ toolchain + the GLib ≥ 2.80 / `girepository-2.0` development headers
  (so `npm install` can build the node-gi native addon) — see the
  [`@gjsify/node-gi` README](../node-gi/README.md#requirements).
- The target typelibs installed (GLib/GObject/Gio ship with GLib).
