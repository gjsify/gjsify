# @gjsify/zlib

GJS implementation of the Node.js `zlib` module. Provides gzip/deflate via Web Compression API with Gio.ZlibCompressor fallback.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/zlib
# or
yarn add @gjsify/zlib
```

## Usage

```typescript
import { gzipSync, gunzipSync, deflateSync, inflateSync } from '@gjsify/zlib';

const compressed = gzipSync(Buffer.from('hello world'));
const decompressed = gunzipSync(compressed);
console.log(decompressed.toString()); // 'hello world'
```

## Inspirations and credits

- https://nodejs.org/api/zlib.html
- https://github.com/geut/brode/blob/main/packages/browser-node-core/src/zlib.js
- https://github.com/browserify/browserify-zlib
- https://github.com/denoland/deno_std/blob/main/node/zlib.ts

## License

MIT
