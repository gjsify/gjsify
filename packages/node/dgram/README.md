# @gjsify/dgram

GJS implementation of the Node.js `dgram` module using Gio.Socket for UDP networking.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/dgram
# or
yarn add @gjsify/dgram
```

## Usage

```typescript
import { createSocket } from '@gjsify/dgram';

const socket = createSocket('udp4');
socket.bind(41234);
socket.on('message', (msg, rinfo) => {
  console.log(`Received: ${msg} from ${rinfo.address}:${rinfo.port}`);
});
```

## License

MIT
