# @gjsify/eventsource

GJS implementation of the Web EventSource (Server-Sent Events) API using Soup 3.0.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/eventsource
# or
yarn add @gjsify/eventsource
```

## Usage

```typescript
import { EventSource } from '@gjsify/eventsource';

const source = new EventSource('https://example.com/events');
source.onmessage = (event) => {
  console.log(event.data);
};
```

## License

MIT
