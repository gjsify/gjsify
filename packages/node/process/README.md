# @gjsify/process

GJS implementation of the Node.js `process` module using GLib. Extends EventEmitter with env, cwd, platform, and more.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/process

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/process
yarn add @gjsify/process
```

## Usage

```typescript
import process from '@gjsify/process';

console.log(process.cwd());
console.log(process.env.HOME);
console.log(process.platform);
```

## Signals

`process.on('SIGINT' | 'SIGTERM' | 'SIGHUP', …)` is delivered under GJS through
`GLibUnix.signal_add()`, so the handler runs on the JS thread and — as in Node —
registering one replaces the kernel's default disposition. The source is armed on the
first listener and removed with the last, so a process that never asks keeps the
default behaviour.

Delivery needs something driving the default main context, which is the same condition
every other async source in a GJS process lives under: a program that must react while
otherwise idle holds a loop (`holdMainLoop()` from `@gjsify/utils/main-loop`).

The other signals are deliberately absent. `g_unix_signal_add()` also accepts
`SIGUSR1`/`SIGUSR2`/`SIGWINCH`, but those are renumbered on some architectures, and a
hardcoded table would arm the WRONG signal there rather than fail.

## Inspirations and credits

- https://github.com/cgjs/cgjs/tree/master/packages/process
- https://github.com/denoland/deno_std/blob/main/node/process.ts
- https://github.com/geut/brode/blob/main/packages/browser-node-core/src/process.js
- https://github.com/aleclarson/process-browserify
- https://github.com/defunctzombie/node-process

## License

MIT
