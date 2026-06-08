# @gjsify/eventsource

GJS implementation of the Web EventSource (Server-Sent Events) API using Soup 3.0.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/eventsource

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/eventsource
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
