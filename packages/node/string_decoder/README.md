# @gjsify/string_decoder

GJS implementation of the Node.js `string_decoder` module. Supports UTF-8, Base64, hex, and streaming decoding.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/string_decoder
# or
yarn add @gjsify/string_decoder
```

## Usage

```typescript
import { StringDecoder } from '@gjsify/string_decoder';

const decoder = new StringDecoder('utf-8');
console.log(decoder.write(Buffer.from([0xe2, 0x82])));
console.log(decoder.end(Buffer.from([0xac])));
```

## License

MIT
