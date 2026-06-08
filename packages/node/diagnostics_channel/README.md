# @gjsify/diagnostics_channel

GJS implementation of the Node.js `diagnostics_channel` module. Provides Channel and TracingChannel.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/diagnostics_channel

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/diagnostics_channel
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
