# @gjsify/v8

GJS stub implementation of the Node.js `v8` module. Provides getHeapStatistics and JSON-based serialize/deserialize.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/v8

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/v8
yarn add @gjsify/v8
```

## Usage

```typescript
import { getHeapStatistics, serialize, deserialize } from '@gjsify/v8';

console.log(getHeapStatistics());

const buf = serialize({ hello: 'world' });
const obj = deserialize(buf);
```

## License

MIT
