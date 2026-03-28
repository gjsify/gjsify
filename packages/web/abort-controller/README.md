# @gjsify/abort-controller

GJS implementation of the AbortController and AbortSignal Web APIs.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/abort-controller
# or
yarn add @gjsify/abort-controller
```

## Usage

```typescript
import { AbortController, AbortSignal } from '@gjsify/abort-controller';

const controller = new AbortController();
const signal = controller.signal;

signal.addEventListener('abort', () => {
  console.log('Aborted!');
});

controller.abort();
```

## License

MIT
