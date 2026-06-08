# @gjsify/rolldown-native

A native Rust cdylib + Vala/GObject bridge that wraps the Rust `rolldown` bundler and exposes it to GJS via `gi://`. This is the default bundler engine used by `gjsify build` under GJS — npm's `rolldown` is an N-API addon that cannot load in GJS, so this bridge is how gjsify bundles without a Node runtime. Includes a complete plugin bridge (`bundleWithPlugins`) for load, transform, resolveId, and render-chunk hooks. Ships prebuilt `.so` + `.typelib` for Linux.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/rolldown-native
```

## Usage

```typescript
import { hasNativeRolldown, bundle, bundleWithPlugins } from '@gjsify/rolldown-native';

if (hasNativeRolldown()) {
    // Simple bundle
    const result = bundle({
        input: [{ import: 'src/index.ts' }],
        format: 'esm',
        minify: false,
    });
    for (const item of result.output) {
        if (item.type === 'chunk') console.log(item.fileName, item.code.length, 'bytes');
    }
}
```

Under normal usage `@gjsify/rolldown-native` is consumed automatically by the gjsify CLI (`gjsify build`) — direct use is only needed when embedding the bundler in custom build tooling.

## License

MIT
