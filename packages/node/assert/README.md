# @gjsify/assert

GJS implementation of the Node.js `assert` module. Provides assertion functions for testing including deepEqual, throws, and strict mode.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/assert

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/assert
yarn add @gjsify/assert
```

## Usage

```typescript
import { strictEqual, deepStrictEqual, throws } from '@gjsify/assert';

strictEqual(1 + 1, 2);
deepStrictEqual({ a: 1 }, { a: 1 });
throws(() => { throw new Error('fail'); });
```

## Inspirations and credits

- https://deno.land/std/node/assert.ts

## License

MIT
