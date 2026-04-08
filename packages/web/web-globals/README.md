# @gjsify/web-globals

Unified Web API surface for GJS: re-exports `DOMException`, `Event`/`EventTarget`/`CustomEvent`, `AbortController`/`AbortSignal`, `URL`/`URLSearchParams`, `Blob`/`File`, `FormData`, `performance`/`PerformanceObserver`, plus chained `/register` entries for Web Streams, Compression Streams, WebCrypto, EventSource, and DOM Events.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/web-globals
# or
yarn add @gjsify/web-globals
```

## Usage

**In most projects you don't need to import this package at all.** If you build with `gjsify build --app gjs` (default), the GJSify esbuild plugin scans your entry points for references to `fetch`, `ReadableStream`, `AbortController`, `crypto`, `FormData`, etc. and automatically injects the matching `@gjsify/*/register` modules on a per-identifier basis. Auto-globals is scope-aware and only registers what you actually use.

### Manual import (when auto-globals is off)

If you build with `--no-auto-globals` or you are not using the GJSify CLI, import the side-effect subpath explicitly:

```typescript
// Registers the full Web API surface on globalThis
import '@gjsify/web-globals/register';
```

The root export is side-effect-free and only re-exports types for explicit use:

```typescript
// Pure named imports — no side effects on globalThis
import { AbortController, URL, FormData } from '@gjsify/web-globals';
```

For a smaller surface, import the individual register subpaths directly:

```typescript
import 'fetch/register';
import 'abort-controller/register';
import 'webcrypto/register';
```

## License

MIT
