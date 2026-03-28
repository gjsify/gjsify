# @gjsify/http

GJS partial implementation of the Node.js `http` module using Soup 3.0. Provides Server, IncomingMessage, and ServerResponse.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/http
# or
yarn add @gjsify/http
```

## Usage

```typescript
import { createServer } from '@gjsify/http';

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Hello World');
});
server.listen(3000);
```

## Inspirations and credits

- https://github.com/node-fetch/node-fetch/blob/main/src/headers.js

## License

MIT
