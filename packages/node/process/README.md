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

## Inspirations and credits

- https://github.com/cgjs/cgjs/tree/master/packages/process
- https://github.com/denoland/deno_std/blob/main/node/process.ts
- https://github.com/geut/brode/blob/main/packages/browser-node-core/src/process.js
- https://github.com/aleclarson/process-browserify
- https://github.com/defunctzombie/node-process

## License

MIT
