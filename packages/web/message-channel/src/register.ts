// Side-effect module: registers MessageChannel + MessagePort as globals on GJS.
// On Node these are already native (since Node 15) — the alias map in
// @gjsify/resolve-npm routes this subpath to @gjsify/empty during Node
// builds so it becomes a no-op.
//
// Usage:
//   import '@gjsify/message-channel/register';
// Or rely on `gjsify build --app gjs --globals auto` to inject it when
// the bundle references `MessageChannel` / `MessagePort` as free
// identifiers — see packages/infra/resolve-npm/lib/globals-map.mjs.

import { MessageChannel, MessagePort } from './index.js';

if (typeof (globalThis as { MessageChannel?: unknown }).MessageChannel === 'undefined') {
  (globalThis as { MessageChannel: unknown }).MessageChannel = MessageChannel;
}
if (typeof (globalThis as { MessagePort?: unknown }).MessagePort === 'undefined') {
  (globalThis as { MessagePort: unknown }).MessagePort = MessagePort;
}
