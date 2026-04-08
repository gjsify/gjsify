# @gjsify/web-globals

Unified Web API surface for GJS: re-exports `DOMException`, `Event`/`EventTarget`/`CustomEvent`, `AbortController`/`AbortSignal`, `URL`/`URLSearchParams`, `Blob`/`File`, `FormData`, `performance`/`PerformanceObserver`, plus chained `/register` entries for Web Streams, Compression Streams, WebCrypto, EventSource and DOM Events.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/web-globals
# or
yarn add @gjsify/web-globals
```

## Usage

**Typical projects don't need to import this package directly.** Declare the specific globals you need via the `--globals` flag of `gjsify build`:

```jsonc
// package.json
"scripts": {
  "build": "gjsify build src/index.ts --outfile dist/index.js --globals fetch,crypto,AbortController,FormData,performance,ReadableStream"
}
```

The CLI resolves each identifier to the corresponding `@gjsify/<pkg>/register` module and injects only those. For a smaller surface, list only what your code actually references.

### Manual import — alternative

If you prefer one big import over the CLI flag, register the entire Web API surface in your entry file:

```typescript
// Registers fetch, Headers, Request, Response, ReadableStream, AbortController,
// crypto, FormData, Blob, File, URL, performance, DOMException, Event, EventSource, …
import '@gjsify/web-globals/register';
```

The root export is side-effect-free and only re-exports types:

```typescript
// Pure named imports — no side effects on globalThis
import { AbortController, URL, FormData } from '@gjsify/web-globals';
```

## License

MIT
