# @gjsify/stream

GJS implementation of the Node.js `stream` module. Provides Readable, Writable, Duplex, Transform, and PassThrough streams.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/stream
# or
yarn add @gjsify/stream
```

## Usage

```typescript
import { Readable, Writable, Transform } from '@gjsify/stream';

const readable = Readable.from(['hello', 'world']);
readable.on('data', (chunk) => console.log(chunk));
```

## Inspirations and credits

- https://github.com/browserify/stream-browserify
- https://github.com/geut/brode/blob/main/packages/browser-node-core/src/stream.js
- https://github.com/exogee-technology/readable-stream
- https://github.com/nodejs/readable-stream
- https://github.com/denoland/deno_std/blob/main/node/stream.ts

## License

MIT
