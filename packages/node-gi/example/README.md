# @gjsify/node-gi — one source, two runtimes

The capstone proof for [`@gjsify/node-gi`](../node-gi): a single, **unchanged**
GJS / GObject-Introspection program ([`src/app.ts`](src/app.ts)) that builds and
runs **identically** on both GJS and Node.js.

> **Status: experimental (Tier 3 —
> [ADR 0005](../../../docs/adr/0005-node-gi-scope.md)).** node-gi's scope today
> is CI/benchmarks/dev tooling — not production apps. See the
> [`@gjsify/node-gi` README](../node-gi/README.md) for the dependency-isolation
> rule and the graduation gate.

```
gjsify build src/app.ts --app gjs   → gjs  -m dist/app.gjs.mjs   (native gi://)
gjsify build src/app.ts --app node  → node    dist/app.node.mjs  (@gjsify/node-gi)
```

The `gjsify` bundler keeps the `gi://` imports native for the GJS target and
rewrites them onto the node-gi L1 runtime (`requireGi`) for the Node target. The
GJS ambient `print` global is injected for the Node build by `--globals auto`
(the `@gjsify/node-gi/globals` shim) — no `/register` import in the source.

Both builds print the same fixed sequence of lines (the GOLDEN output asserted by
[`dual.e2e.mjs`](dual.e2e.mjs)):

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

## What the shared source exercises

| GI feature | API in `src/app.ts` |
|---|---|
| Namespace function | `GLib.path_get_basename('/usr/bin/gjs')` |
| Enums / flags / constants | `Gio.BusType.SESSION`, `GLib.PRIORITY_DEFAULT` |
| GObject construction + methods + property | `new Gio.SimpleAction({ name, enabled })`, `get_name()`, `get_enabled()`, `set_enabled(false)`, `action.enabled` |
| Signal (counted, no callback args) | `action.connect('notify::enabled', …)` → counter |
| Constructor/static method + instance method | `Gio.File.new_for_path('/usr/share').get_basename()` |
| `GObject.registerClass` subclass | custom `count`/`label` properties, a `bumped` signal, a `describe()` method, and `vfunc_constructed` |
| Bounded GLib main loop + GI callback | `GLib.MainLoop` + `GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, …)` ticking to 3 |

Every value is **deterministic** — no hostname, no machine paths — and never
depends on a signal callback's arguments (the Node runtime omits the emitter as
the first callback arg, so the example only ever *counts* emissions). That is what
lets the two runtimes produce byte-identical output.

## Run it

```bash
npm install      # builds @gjsify/node-gi's native addon via the file: dependency
npm run build    # builds both the gjs and node bundles
npm run start:gjs
npm run start:node
npm test         # node --test dual.e2e.mjs — asserts gjs === node === GOLDEN
```

> The dependency here is `"@gjsify/node-gi": "file:../node-gi"` so the example
> validates the in-tree runtime. The real consumer form is the published package:
> `"@gjsify/node-gi": "^0.13.0"`.

> **CLI note.** `npm run build:node` (the `gjsify build --app node` rewrite of
> `gi://` → `requireGi` + the `@gjsify/node-gi/globals` injection) needs a
> `gjsify` CLI that carries the node-gi bundler integration. That ships on the
> gjsify `main` branch; it is newer than the `@gjsify/cli` currently on npm's
> `latest` tag. With an older CLI the node bundle is produced but stubs `gi://`,
> so `npm run start:node` would not run. `dual.e2e.mjs` handles this
> automatically: it runs the real `--app node` bundle when the CLI supports the
> rewrite, and otherwise runs the same source through the `@gjsify/node-gi`
> runtime — either way asserting byte-identical output. `npm run build:gjs` /
> `start:gjs` work with any CLI (`gi://` stays native under GJS).

## Requirements

- Node.js ≥ 20 and the `gjs` binary on `PATH`.
- A C++ toolchain + the GLib ≥ 2.80 / `girepository-2.0` development headers
  (so `npm install` can build the node-gi native addon) — see the
  [`@gjsify/node-gi` README](../node-gi/README.md#requirements).
- The target typelibs installed (GLib/GObject/Gio ship with GLib).
