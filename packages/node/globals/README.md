# @gjsify/node-globals

Node.js globals for GJS: `process`, `Buffer`, `structuredClone`, `btoa`/`atob`, `URL`, `URLSearchParams`, `setImmediate`/`clearImmediate`, `queueMicrotask`, `global`, and the `Error.captureStackTrace` / `Promise.withResolvers` V8 polyfills.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/node-globals
# or
yarn add @gjsify/node-globals
```

## Usage

**In most projects you don't need to import this package at all.** If you are using `gjsify build --app gjs` (which is the default), the GJSify esbuild plugin scans your entry points and automatically injects `@gjsify/node-globals/register` whenever your code references `process`, `Buffer`, `URL`, etc.

### Manual import (when auto-globals is off)

If you build with `--no-auto-globals` or you are not using the GJSify CLI, import the side-effect subpath explicitly:

```typescript
// Registers process, Buffer, setImmediate, URL, btoa/atob, etc. on globalThis
import '@gjsify/node-globals/register';
```

The root export is side-effect-free and only re-exports utility helpers for explicit use:

```typescript
// Pure named imports — no side effects on globalThis
import { ensureMainLoop } from '@gjsify/node-globals';
```

## License

MIT
