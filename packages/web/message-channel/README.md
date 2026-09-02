# @gjsify/message-channel

W3C `MessageChannel` and `MessagePort` for GJS — EventTarget-based and transport-pluggable. Stock GJS exposes neither; this package provides the full `postMessage` / `start` / `close` / `onmessage` surface with async (microtask) dispatch. The pluggable transport hook backs the `@gjsify/iframe` WebKit bridge and future cross-process workers.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/message-channel

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/message-channel
yarn add @gjsify/message-channel
```

## Usage

```typescript
import { MessageChannel, MessagePort } from '@gjsify/message-channel';

const { port1, port2 } = new MessageChannel();

port2.onmessage = (event) => {
    console.log('received:', event.data);
};

port1.postMessage({ hello: 'world' });
// → received: { hello: 'world' }

// Explicit start() is only needed when deferring listener attachment
port2.start();
port2.close();
```

## `@gjsify/message-channel/core` — the transport seam, on every runtime

The `node`, `browser` and `nativescript` slots are `native`, so a build for those
targets routes the bare `@gjsify/message-channel` specifier to `./globals` and the
consumer gets the host's own `MessageChannel`. That is right for code that wants a
transferable port and wrong for code that needs the **pluggable transport**: a host
port has no `MessagePortTransport` hook and no `_partner`, and answers
`Symbol.toStringTag` with `EventTarget` rather than `MessagePort`.

`./core` is the same implementation at a specifier slot routing never rewrites — the
alias layer matches exact specifiers, so a subpath passes through. Import it when the
seam is the point, as `@gjsify/iframe` does for its WebKit bridge:

```typescript
import { MessagePort, type MessagePortTransport } from '@gjsify/message-channel/core';
```

On GJS both specifiers resolve to the same file, so there is one class and one
identity. Off GJS they are deliberately two, because the host port cannot keep the
promise the seam makes.

## License

MIT
