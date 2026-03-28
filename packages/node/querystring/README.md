# @gjsify/querystring

GJS implementation of the Node.js `querystring` module. Provides parse and stringify.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/querystring
# or
yarn add @gjsify/querystring
```

## Usage

```typescript
import { parse, stringify } from '@gjsify/querystring';

const obj = parse('foo=bar&baz=qux');
console.log(obj); // { foo: 'bar', baz: 'qux' }

const str = stringify({ name: 'test', value: '123' });
console.log(str); // 'name=test&value=123'
```

## Inspirations and credits

- https://github.com/SpainTrain/querystring-es3
- https://github.com/denoland/deno_std/blob/main/node/querystring.ts

## License

MIT
