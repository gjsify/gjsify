// CJS fixture bundled into the stream test suite to guard the `require('stream')`
// interop. A real npm dependency (pngjs, mute-stream, @hono/node-server's `send`,
// readable-stream, …) does exactly this: `const Stream = require('stream')` then
// `class X extends Stream` / `util.inherits(X, Stream)`. Under `--app gjs` the
// bundler resolves `require('stream')` to `@gjsify/stream` and wraps it with the
// `__toCommonJS` helper; without the `"module.exports"` string-export in
// `@gjsify/stream` (and `@gjsify/events`), that yields the ESM namespace object
// instead of the callable constructor and this module ABORTS AT LOAD with
// "Stream is not a constructor" / "superCtor.prototype must not be undefined".
// So merely importing this fixture from the bundled spec is the regression guard.
// oxlint-disable unicorn/prefer-node-protocol -- intentional: this fixture reproduces how
// real npm CJS deps (pngjs, mute-stream, @hono/node-server's `send`) require builtins by
// BARE name (`require('stream')`, not `require('node:stream')`) — the exact path the fix guards.
const Stream = require('stream');
const EventEmitter = require('events');
const util = require('util');

class ClassExtendsStream extends Stream {}
class ClassExtendsEmitter extends EventEmitter {}

function InheritsStream() {
    Stream.call(this);
}
util.inherits(InheritsStream, Stream);

module.exports = { Stream, EventEmitter, ClassExtendsStream, ClassExtendsEmitter, InheritsStream };
