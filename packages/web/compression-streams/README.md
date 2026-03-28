# @gjsify/compression-streams

GJS implementation of the Web Compression Streams API using Gio.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/compression-streams
# or
yarn add @gjsify/compression-streams
```

## Usage

```typescript
import { CompressionStream, DecompressionStream } from '@gjsify/compression-streams';

const compressionStream = new CompressionStream('gzip');
const decompressionStream = new DecompressionStream('gzip');
```

## License

MIT
