# @gjsify/fetch

GJS implementation of the Web Fetch API using Soup 3.0 and Gio. Provides fetch(), Request, Response, and Headers.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/fetch
# or
yarn add @gjsify/fetch
```

## Usage

```typescript
import { fetch, Request, Response, Headers } from '@gjsify/fetch';

const response = await fetch('https://example.com');
const text = await response.text();
console.log(text);
```

## Inspirations and credits

- https://github.com/sonnyp/troll/blob/main/src/std/fetch.js
- https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node-fetch
- https://github.com/node-fetch/node-fetch
- https://github.com/denoland/deno/tree/main/ext/fetch

## License

MIT
