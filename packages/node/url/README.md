# @gjsify/url

GJS implementation of the Node.js `url` module using GLib.Uri. Provides URL and URLSearchParams.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/url
# or
yarn add @gjsify/url
```

## Usage

```typescript
import { URL, URLSearchParams } from '@gjsify/url';

const url = new URL('https://example.com/path?foo=bar');
console.log(url.hostname); // 'example.com'
console.log(url.searchParams.get('foo')); // 'bar'
```

## Inspirations and credits

- https://github.com/defunctzombie/node-url
- https://github.com/denoland/deno_std/blob/main/node/url.ts

## License

MIT
