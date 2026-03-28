# @gjsify/diagnostics_channel

GJS implementation of the Node.js `diagnostics_channel` module. Provides Channel and TracingChannel.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/diagnostics_channel
# or
yarn add @gjsify/diagnostics_channel
```

## Usage

```typescript
import { channel } from '@gjsify/diagnostics_channel';

const ch = channel('my-channel');
ch.subscribe((message) => {
  console.log('Received:', message);
});
ch.publish({ data: 'hello' });
```

## License

MIT
