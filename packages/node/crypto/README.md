# @gjsify/crypto

GJS partial implementation of the Node.js `crypto` module using GLib.Checksum and GLib.Hmac. Supports Hash, Hmac, randomBytes, and UUID.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/crypto
# or
yarn add @gjsify/crypto
```

## Usage

```typescript
import { createHash, randomBytes, randomUUID } from '@gjsify/crypto';

const hash = createHash('sha256').update('hello').digest('hex');
const bytes = randomBytes(16);
const uuid = randomUUID();
```

## License

MIT
