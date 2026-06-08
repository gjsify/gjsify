# @gjsify/websocket

GJS implementation of the Web WebSocket API using Soup 3.0. Provides WebSocket, MessageEvent, and CloseEvent.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/websocket

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/websocket
yarn add @gjsify/websocket
```

## Usage

```typescript
import { WebSocket } from '@gjsify/websocket';

const ws = new WebSocket('wss://example.com/socket');
ws.onopen = () => {
  ws.send('hello');
};
ws.onmessage = (event) => {
  console.log(event.data);
};
```

## License

MIT
