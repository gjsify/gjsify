# @gjsify/async_hooks

GJS implementation of the Node.js `async_hooks` module. Provides AsyncLocalStorage, AsyncResource, and createHook.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
npm install @gjsify/async_hooks
# or
yarn add @gjsify/async_hooks
```

## Usage

```typescript
import { AsyncLocalStorage, AsyncResource } from '@gjsify/async_hooks';

const storage = new AsyncLocalStorage();
storage.run({ requestId: '123' }, () => {
  console.log(storage.getStore()); // { requestId: '123' }
});
```

## License

MIT
