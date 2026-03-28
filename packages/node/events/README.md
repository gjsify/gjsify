# @gjsify/events

GJS implementation of the Node.js `events` module. Provides EventEmitter, once, on, and listenerCount.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/events
# or
yarn add @gjsify/events
```

## Usage

```typescript
import { EventEmitter } from '@gjsify/events';

const emitter = new EventEmitter();
emitter.on('data', (msg) => console.log(msg));
emitter.emit('data', 'hello');
```

## Inspirations and credits

- https://github.com/EventEmitter2/EventEmitter2
- https://github.com/browserify/events
- https://github.com/geut/brode/blob/main/packages/browser-node-core/src/events.js
- https://github.com/denoland/deno_std/blob/main/node/_events.mjs

## License

MIT
