# @gjsify/browser-node-polyfills

Browser-targeted aggregation of `@gjsify` Node.js polyfills. It is the browser counterpart to `@gjsify/node-polyfills`: an umbrella package that pulls in the subset of `@gjsify/*` Node.js polyfills that ship a browser-runnable build (assert, buffer, crypto, events, fs, http, path, stream, and more). Importing `@gjsify/browser-node-polyfills/globals` installs all contributing polyfills onto `globalThis` at once.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/browser-node-polyfills

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/browser-node-polyfills
yarn add @gjsify/browser-node-polyfills
```

## Usage

```typescript
// Side-effect import — registers all contributing polyfills on globalThis
import '@gjsify/browser-node-polyfills/globals';

// Buffer is now available globally in the browser bundle
const buf = Buffer.from('hello');
console.log(buf.toString('hex'));
```

This package is primarily used by `create-app` templates and CLI scaffolds to bring a complete Node.js API surface to browser bundles. Individual polyfills can also be imported directly from their own packages.

## License

MIT
