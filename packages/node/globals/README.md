# @gjsify/node-globals

GJS implementation of Node.js global objects including process, Buffer, structuredClone, TextEncoder/Decoder, atob/btoa, URL, and setImmediate.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/node-globals
# or
yarn add @gjsify/node-globals
```

## Usage

```typescript
import '@gjsify/node-globals';

// Global objects are now available:
// process, Buffer, structuredClone, TextEncoder, TextDecoder,
// atob, btoa, URL, setImmediate
```

## License

MIT
