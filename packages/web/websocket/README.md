# @gjsify/websocket

GJS implementation of the Web WebSocket API using Soup 3.0. Provides WebSocket, MessageEvent, and CloseEvent.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/websocket
# or
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
