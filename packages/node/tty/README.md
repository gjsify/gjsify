# @gjsify/tty

GJS implementation of the Node.js `tty` module. Provides ReadStream, WriteStream, and ANSI escape support.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/tty
# or
yarn add @gjsify/tty
```

## Usage

```typescript
import { isatty, ReadStream, WriteStream } from '@gjsify/tty';

console.log(isatty(0)); // true if stdin is a TTY
```

## Inspirations and credits

- https://github.com/geut/brode/blob/main/packages/browser-node-core/src/tty.js
- https://github.com/browserify/tty-browserify
- https://github.com/denoland/deno_std/blob/main/node/tty.ts
- https://github.com/jvilk/bfs-process/blob/master/ts/tty.ts
- https://nodejs.org/api/tty.html

## License

MIT
