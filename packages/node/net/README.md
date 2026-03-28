# @gjsify/net

GJS implementation of the Node.js `net` module using Gio.SocketClient and Gio.SocketService. Provides Socket and Server.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/net
# or
yarn add @gjsify/net
```

## Usage

```typescript
import { createServer, createConnection } from '@gjsify/net';

const server = createServer((socket) => {
  socket.on('data', (data) => console.log(data.toString()));
  socket.end('goodbye');
});
server.listen(8080);
```

## Inspirations and credits

- https://nodejs.org/api/net.html

## License

MIT
