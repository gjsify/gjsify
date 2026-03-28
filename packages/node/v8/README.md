# @gjsify/v8

GJS stub implementation of the Node.js `v8` module. Provides getHeapStatistics and JSON-based serialize/deserialize.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/v8
# or
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
