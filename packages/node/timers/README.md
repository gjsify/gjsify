# @gjsify/timers

GJS implementation of the Node.js `timers` module. Provides setTimeout, setInterval, setImmediate, and their promises API.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/timers
# or
yarn add @gjsify/timers
```

## Usage

```typescript
import { setTimeout, setInterval, setImmediate } from '@gjsify/timers';
import { setTimeout as delay } from '@gjsify/timers/promises';

setTimeout(() => console.log('hello'), 1000);

await delay(1000);
console.log('1 second later');
```

## License

MIT
