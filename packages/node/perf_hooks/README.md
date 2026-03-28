# @gjsify/perf_hooks

GJS implementation of the Node.js `perf_hooks` module using the Web Performance API with GLib fallback.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/perf_hooks
# or
yarn add @gjsify/perf_hooks
```

## Usage

```typescript
import { performance } from '@gjsify/perf_hooks';

const start = performance.now();
// ... do work ...
console.log(`Elapsed: ${performance.now() - start}ms`);
```

## License

MIT
