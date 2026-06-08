# @gjsify/webassembly

Promise-API polyfill for `WebAssembly` on GJS. SpiderMonkey ships working synchronous `new WebAssembly.Module` and `new WebAssembly.Instance` constructors but the async methods (`compile`, `instantiate`, `compileStreaming`, `instantiateStreaming`) throw at runtime. This package wraps the synchronous constructors so async-API consumers work unmodified on GJS.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/webassembly

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/webassembly
yarn add @gjsify/webassembly
```

## Usage

```typescript
import { compile, instantiate, instantiateStreaming, validate } from '@gjsify/webassembly';

// Compile from a buffer
const module = await compile(wasmBuffer);

// Compile and instantiate in one step
const { instance } = await instantiate(wasmBuffer, importObject);

// Stream-instantiate from a fetch Response
const { instance: inst } = await instantiateStreaming(fetch('/app.wasm'), importObject);

// Validate a buffer without throwing
const ok = validate(wasmBuffer);
```

## License

MIT
