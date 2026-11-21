# @gjsify/perf_hooks

GJS implementation of the Node.js `perf_hooks` module using the Web Performance API with GLib fallback.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/perf_hooks

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/perf_hooks
yarn add @gjsify/perf_hooks
```

## Usage

```typescript
import { performance } from '@gjsify/perf_hooks';

const start = performance.now();
// ... do work ...
console.log(`Elapsed: ${performance.now() - start}ms`);
```

## Event loop delay

`monitorEventLoopDelay()` is a real histogram under GJS (nanoseconds, like Node's), built on
`startLagMonitor` from `@gjsify/utils/main-loop`: a `GLib.PRIORITY_HIGH` timer whose lateness is
the loop delay. To attribute a stall to a span and assert a budget in a test, see
`@gjsify/responsiveness`.

## License

MIT
