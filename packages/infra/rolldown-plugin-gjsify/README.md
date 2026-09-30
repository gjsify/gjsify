# @gjsify/rolldown-plugin-gjsify

The core Rolldown plugin set powering `gjsify build`. Orchestrates per-target app builds for GJS, Node, Browser, and NativeScript — handling Node↔GJS module aliasing, automatic globals injection (`--globals auto`), CSS-as-string loading (via `@gjsify/lightningcss-native` or the npm fallback), platform-file resolution (`.android.ts` / `.ios.ts`), process-stub injection, shebang hoisting, and more.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/rolldown-plugin-gjsify
```

## Usage

Typically consumed via the gjsify CLI (`gjsify build --app gjs`). For direct use in a custom Rolldown config:

```typescript
import rolldown from 'rolldown';
import { setupForGjs } from '@gjsify/rolldown-plugin-gjsify';

const { options, plugins } = await setupForGjs({
    input: 'src/index.ts',
    globals: 'auto',
});

const build = await rolldown({ ...options, plugins });
await build.write({ file: 'dist/app.gjs.mjs' });
```

Individual plugins are also exported for use in custom pipelines:

```typescript
import {
    cssAsStringPlugin,
    gjsImportsEmptyPlugin,
    processStubPlugin,
    shebangPlugin,
    textLoaderPlugin,
    platformResolvePlugin,
} from '@gjsify/rolldown-plugin-gjsify';
```

## Native addons (`--app gjs`)

A Node-API addon package (`bufferutil`, `better-sqlite3`, `lightningcss`, `@signalapp/libsignal-client`, …) is rewritten to `loadAddon()` from `@gjsify/napi`, which GJS cannot load by itself. On `--app node` the same packages stay external and keep resolving from `node_modules`.

For a GJS build the bundle records the addon's **package identity**, not a path — see [ADR 0084](../../docs/adr/0084-an-addon-is-found-by-package-identity.md). Every `.node` the package ships is enumerated at build time, keyed by platform (`linux-x64`, `linux-x64-musl`, `darwin-arm64`, …), and the bundle picks the entry for the host it finds itself on when it loads. Consequences worth knowing:

- The bundle is **relocatable** — move the output tree and it still loads its addon, because nothing names the machine that built it.
- The addon **package** must be installed somewhere the bundle can reach (its own `node_modules`, or an `addons/<package>/` next to the bundle that no gjsify step fills yet). A single copied `.node` file is not enough; a `.node` that `dlopen`s a sibling library or reads a data file beside itself needs its directory.
- A cross-build works when the target's binary is installed on the builder: a multi-platform npm package, or `gjsify install`, which materialises every platform package.
- `runtimeResolve` (set from `format === 'esm'` by `gjsify build`) gates the whole mechanism: without the bundle-URL banner there is nothing to anchor on, so the rewrite is declined with a warning rather than emitting a path that would only be right on the build machine.

## License

MIT
