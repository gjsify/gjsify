# @gjsify/fs

GJS implementation of the Node.js `fs` module using Gio. Supports sync, callback, and promises APIs, streams, and FSWatcher.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/fs
# or
yarn add @gjsify/fs
```

## Usage

```typescript
import { readFileSync, writeFileSync } from '@gjsify/fs';
import { readFile } from '@gjsify/fs/promises';

const content = readFileSync('/path/to/file', 'utf-8');
writeFileSync('/path/to/output', 'hello world');

const data = await readFile('/path/to/file', 'utf-8');
```

## Inspirations and credits

- https://github.com/cgjs/cgjs/blob/master/packages/fs/index.js
- https://github.com/geut/brode/blob/main/packages/browser-node-core/src/fs.js
- https://github.com/mafintosh/level-filesystem/blob/master/index.js
- https://github.com/denoland/deno_std/blob/main/node/fs.ts

## License

MIT
