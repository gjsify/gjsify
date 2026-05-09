// Reference: Node.js lib/stream.js, lib/internal/streams/*.js
// Reimplemented for GJS using EventEmitter and microtask scheduling.
//
// This file is the public barrel — actual implementations live per-class:
//   - stream-base.ts        Stream_ (root EventEmitter + pipe glue)
//   - readable.ts           Readable_ (+ Readable_._autoClose protected hook)
//   - writable.ts           Writable_ (+ FIFO drain queue)
//   - duplex.ts             Duplex_   (Readable_ + writable-half re-implementation)
//   - transform.ts          Transform_
//   - passthrough.ts        PassThrough_
//   - utils/pipe.ts         Stream.pipe() helper
//   - utils/pipeline.ts     pipeline()
//   - utils/finished.ts     finished(), addAbortSignal(), is{Readable,…}()
//   - internal/state.ts     module-singleton defaults + validateHighWaterMark
//   - internal/types.ts     shared interfaces
//
// Public class names are makeCallable Proxy wrappers around the underscore-suffixed
// internal classes (`Stream_`, `Readable_`, …) so legacy CJS consumers can do
// `Stream.call(this)` (npm `send`, `util.inherits(Sub, Stream)`, our own
// `@gjsify/crypto` `Hash.copy()`). See `./callable.ts` for the rationale.
//
// The historical default export shape — the Stream constructor with all classes
// + helpers attached as static properties — is preserved for `cjs-compat.cjs`.

import { makeCallable } from './callable.js';

import { Stream_ } from './stream-base.js';
import { Readable_ } from './readable.js';
// Side-effect import: wires Stream_.prototype.pipe → pipe() at load time.
// See ./stream-base.ts (_setPipeImpl) for the late-binding rationale.
import './utils/pipe.js';
import { Writable_ } from './writable.js';
import { Duplex_ } from './duplex.js';
import { Transform_ } from './transform.js';
import { PassThrough_ } from './passthrough.js';
import { pipeline } from './utils/pipeline.js';
import { finished, addAbortSignal, isReadable, isWritable, isDestroyed, isDisturbed, isErrored } from './utils/finished.js';
import { getDefaultHighWaterMark, setDefaultHighWaterMark } from './internal/state.js';

// ---- Re-exports of internal helpers ----

export { getDefaultHighWaterMark, setDefaultHighWaterMark };
export { pipeline, finished, addAbortSignal };
export { isReadable, isWritable, isDestroyed, isDisturbed, isErrored };

// ---- Type-only re-exports ----

export type { ReadableOptions, WritableOptions, DuplexOptions, TransformOptions, FinishedOptions } from 'node:stream';
export type { StreamOptions } from './internal/types.js';

// ---- Class wrappers (callable for legacy CJS) ----

export const Stream = makeCallable(Stream_) as typeof Stream_;
export const Readable = makeCallable(Readable_) as typeof Readable_;
export const Writable = makeCallable(Writable_) as typeof Writable_;
export const Duplex = makeCallable(Duplex_) as typeof Duplex_;
export const Transform = makeCallable(Transform_) as typeof Transform_;
export const PassThrough = makeCallable(PassThrough_) as typeof PassThrough_;

export type Stream = Stream_;
export type Readable = Readable_;
export type Writable = Writable_;
export type Duplex = Duplex_;
export type Transform = Transform_;
export type PassThrough = PassThrough_;

// ---- Default export ----
//
// Node returns the Stream constructor with sub-classes + helpers hung off it.
// `cjs-compat.cjs` resolves `mod.default || mod` to this exact value, so the
// legacy `util.inherits(Sub, require('stream'))` pattern keeps working.

const _default = Object.assign(Stream, {
  Stream,
  Readable,
  Writable,
  Duplex,
  Transform,
  PassThrough,
  pipeline,
  finished,
  addAbortSignal,
  isReadable,
  isWritable,
  isDestroyed,
  isDisturbed,
  isErrored,
  getDefaultHighWaterMark,
  setDefaultHighWaterMark,
});

export default _default;
