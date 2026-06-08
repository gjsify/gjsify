# @gjsify/abort-controller

GJS implementation of the AbortController and AbortSignal Web APIs.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/abort-controller

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/abort-controller
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
