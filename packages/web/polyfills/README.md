# @gjsify/web-polyfills

Meta package that pulls every `@gjsify` Web API polyfill as a single dependency — fetch, streams, webcrypto, websocket, XMLHttpRequest, WebAssembly, Web Audio, WebRTC, EventSource, WebStorage, and more. Contains no runtime code of its own; used by `create-app` templates and CLI scaffolds.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/web-polyfills

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/web-polyfills
yarn add @gjsify/web-polyfills
```

## Usage

```typescript
// Import once to pull all Web API polyfills into your dependency tree.
// Individual packages register their globals via --globals auto at build time.
import '@gjsify/web-polyfills';
```

## License

MIT
