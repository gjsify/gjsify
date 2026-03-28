# @gjsify/util

GJS implementation of the Node.js `util` module. Provides inspect, format, promisify, types, and more.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/util
# or
yarn add @gjsify/util
```

## Usage

```typescript
import { inspect, format, promisify, types } from '@gjsify/util';

console.log(inspect({ key: 'value' }));
console.log(format('Hello %s', 'world'));
console.log(types.isPromise(Promise.resolve()));
```

## Inspirations and credits

- https://github.com/browserify/node-util
- https://github.com/denoland/deno_std/blob/main/node/util.ts

## License

MIT
