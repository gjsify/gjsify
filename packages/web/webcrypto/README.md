# @gjsify/webcrypto

GJS implementation of the Web Crypto API using GLib.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/webcrypto

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/webcrypto
yarn add @gjsify/webcrypto
```

## Usage

```typescript
import { crypto } from '@gjsify/webcrypto';

const array = new Uint8Array(16);
crypto.getRandomValues(array);

const uuid = crypto.randomUUID();
```

## License

MIT
