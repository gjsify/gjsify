# @gjsify/node-polyfills

Meta package: a dependency-only umbrella that pulls in every `@gjsify` Node.js polyfill — assert, async_hooks, buffer, child_process, crypto, dgram, dns, events, fs, http, http2, net, os, path, process, readline, stream, tls, tty, url, util, worker_threads, zlib, and more. It contains no runtime code of its own; adding it as a dependency gives you the complete Node.js API surface for GJS in one install.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/node-polyfills

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/node-polyfills
yarn add @gjsify/node-polyfills
```

## Usage

```typescript
// No direct import needed — add @gjsify/node-polyfills as a dependency
// and the gjsify build system wires up all polyfills automatically via
// --globals auto.
//
// Individual APIs are available under their node: specifiers:
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';

const content = readFileSync('/etc/hostname', 'utf8');
console.log(content.trim());
```

This package is used by `create-app` templates and CLI scaffolds. For production apps you typically only need the individual `@gjsify/*` polyfill packages you actually use.

## License

MIT
