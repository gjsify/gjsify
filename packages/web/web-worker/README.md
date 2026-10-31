# @gjsify/web-worker

WHATWG `Worker` for GJS (and Node) over `worker_threads`. `new Worker(url)`, `postMessage`, `terminate`, `onmessage` / `onerror` / `onmessageerror`, and a `DedicatedWorkerGlobalScope`-shaped `self` inside the worker. [Comlink](https://github.com/GoogleChromeLabs/comlink) works unmodified.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/web-worker

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/web-worker
yarn add @gjsify/web-worker
```

## Usage

```typescript
import { Worker } from '@gjsify/web-worker';

const worker = new Worker(new URL('./echo.worker.mjs', import.meta.url), { type: 'module', name: 'echo' });
worker.onmessage = (event) => console.log(event.data);
worker.postMessage({ hello: 'world' });
```

```javascript
// echo.worker.mjs
self.onmessage = (event) => self.postMessage({ echo: event.data, name: self.name });
```

With `gjsify build --globals auto`, a bare `Worker` reference is routed here on GJS and Node; browsers keep their own.

### Comlink

```typescript
import * as Comlink from 'comlink';

const api = Comlink.wrap<Api>(new Worker(new URL('./api.worker.mjs', import.meta.url)));
console.log(await api.add(2, 3));
```

## Behaviour

- Host: `postMessage(value, transfer | { transfer })`, `terminate()` (idempotent, silences further events), `addEventListener`, and the three `on…` attributes.
- An uncaught error in the worker is a cancellable `ErrorEvent`; if nothing handles it, it goes to `console.error`.
- Worker scope: `self`, `name`, `postMessage`, `addEventListener` / `removeEventListener` (`message`, `messageerror`; function or `handleEvent` listeners), `onmessage`, `onmessageerror`, `close()`.
- Relative script strings resolve against the working directory.
- Scripts load as ES modules; `type` is accepted but not distinguished.

## Limits

- On GJS the child is a bare `gjs` with no module resolution: the worker file must be self-contained. Bundle it with `gjsify build --app gjs`.
- Parent-side globals do not exist in the child; its global surface is the child's own.
- Detecting `new Worker(new URL(…, import.meta.url))` at build time and bundling the worker file is not part of this package yet (#2338).

## License

MIT
