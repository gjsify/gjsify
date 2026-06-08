# @gjsify/lightningcss-wasm

A WebAssembly build of the `lightningcss` CSS transformer for GJS — the portable fallback to `@gjsify/lightningcss-native` for platforms where a prebuilt `.so` is unavailable. Loads the `.wasm` via `@gjsify/fs`, uses SpiderMonkey 140's synchronous `WebAssembly.Module`/`Instance` constructors, and seeds randomness from `globalThis.crypto`.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/lightningcss-wasm
```

## Usage

```javascript
import { transform, bundle, bundleAsync } from '@gjsify/lightningcss-wasm';

// Transform a CSS source string
const result = transform({
    filename: 'app.css',
    code: Buffer.from('a { color: red; }'),
    minify: true,
});
console.log(Buffer.from(result.code).toString());

// Bundle a CSS entry file (resolves @import chains via the filesystem)
const bundled = await bundleAsync({ filename: '/path/to/app.css' });
```

The API mirrors the npm `lightningcss-wasm` package. `@gjsify/rolldown-plugin-gjsify`'s `cssAsStringPlugin` selects between the native bridge and this WASM fallback automatically.

## License

MIT
