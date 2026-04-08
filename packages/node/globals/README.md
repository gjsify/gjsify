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

**Typical projects don't need to import this package directly.** Instead, declare the globals you want via the `--globals` flag of `gjsify build`:

```jsonc
// package.json — scaffolded by `npx @gjsify/cli create`
"scripts": {
  "build": "gjsify build src/index.ts --outfile dist/index.js --globals fetch,Buffer,process,URL,crypto,structuredClone,AbortController"
}
```

The CLI resolves each identifier to the corresponding `@gjsify/<pkg>/register` module (`process`, `Buffer`, `URL` → `@gjsify/node-globals/register`) and injects them at build time.

### Manual import — alternative

If you prefer source-level imports over CLI flags, import the `/register` subpath directly in your entry file:

```typescript
// Registers process, Buffer, setImmediate, URL, btoa/atob, etc. on globalThis
import '@gjsify/node-globals/register';
```

The root export is side-effect-free and only re-exports utility helpers:

```typescript
// Pure named imports — no side effects on globalThis
import { ensureMainLoop } from '@gjsify/node-globals';
```

## License

MIT
