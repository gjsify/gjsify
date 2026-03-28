# @gjsify/worker_threads

GJS stub implementation of the Node.js `worker_threads` module. Currently provides isMainThread only.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/worker_threads
# or
yarn add @gjsify/worker_threads
```

## Usage

```typescript
import { isMainThread } from '@gjsify/worker_threads';

if (isMainThread) {
  console.log('Running in the main thread');
}
```

## License

MIT
