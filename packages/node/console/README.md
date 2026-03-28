# @gjsify/console

GJS implementation of the Node.js `console` module with stream support.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/console
# or
yarn add @gjsify/console
```

## Usage

```typescript
import { Console } from '@gjsify/console';

const logger = new Console(process.stdout, process.stderr);
logger.log('hello');
logger.error('something went wrong');
```

## Inspirations and credits

- https://github.com/denoland/deno/tree/main/ext/console

## License

MIT
