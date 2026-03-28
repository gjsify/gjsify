# @gjsify/buffer

GJS implementation of the Node.js `buffer` module using Blob, File, atob, and btoa.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/buffer
# or
yarn add @gjsify/buffer
```

## Usage

```typescript
import { Buffer } from '@gjsify/buffer';

const buf = Buffer.from('hello world', 'utf-8');
console.log(buf.toString('base64'));
```

## Inspirations and credits

- https://deno.land/std/node/buffer.ts
- https://github.com/feross/buffer

## License

MIT
