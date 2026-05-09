// SPDX-License-Identifier: MIT
// Internal type helpers for readline — narrowing Node's Readable/Writable
// to the TTY-extended runtime shape we get on both Node tty streams and
// @gjsify/process's stdin/stdout/stderr. NOT exported from the package's
// public surface (per AGENTS.md Rule 2c).
//
// `tty.ReadStream` / `tty.WriteStream` extend `net.Socket` (which extends
// `Readable`/`Writable` via `Duplex`) and add the TTY-specific runtime
// methods used by readline (setRawMode, isRaw, isTTY, columns, rows,
// getColorDepth, hasColors). The standalone `Readable`/`Writable` types
// in `node:stream` do not declare these — but at runtime our public API
// accepts any `Readable`/`Writable`, and either falls back gracefully or
// uses `in`/`typeof` guards before invoking. These interfaces let us
// narrow without `as any`.
//
// Additionally, the keypress parser stores its `StringDecoder` and
// `emitKeys` generator on the input stream via two private symbols
// (`_KEYPRESS_DECODER`, `_ESCAPE_DECODER`). The `KeypressTaggedStream`
// type describes that runtime augmentation.

import type { Readable, Writable } from 'node:stream';
import type { StringDecoder } from 'node:string_decoder';

/**
 * `Readable` augmented with the TTY-specific runtime methods that exist
 * on `tty.ReadStream` and on `@gjsify/process`'s `ProcessReadStream`.
 * All members are optional — readline always guards with `'method' in stream`
 * + `typeof stream.method === 'function'` before calling.
 */
export interface GjsReadableTty extends Readable {
  isRaw?: boolean;
  isTTY?: boolean;
  setRawMode?(enable: boolean): this;
}

/**
 * `Writable` augmented with the TTY-specific runtime properties that exist
 * on `tty.WriteStream` and on `@gjsify/process`'s `ProcessWriteStream`.
 * All members are optional for the same reason as `GjsReadableTty`.
 */
export interface GjsWritableTty extends Writable {
  columns?: number;
  rows?: number;
  isTTY?: boolean;
  getColorDepth?(env?: NodeJS.ProcessEnv): number;
  hasColors?(count?: number, env?: NodeJS.ProcessEnv): boolean;
}

/**
 * Symbol-keyed runtime state that `emitKeypressEvents` attaches to the
 * input stream. The two private symbols carry the per-stream
 * `StringDecoder` and the live `emitKeys` generator, plus a re-entrancy
 * guard so the second call on the same stream is a no-op.
 *
 * Modeled as an intersection (rather than `extends Readable` with a
 * `[key: symbol]` index signature) because `Readable` already declares
 * built-in symbol keys — `EventEmitter.captureRejectionSymbol`,
 * `Symbol.asyncDispose`, `Symbol.asyncIterator` — whose value types
 * would conflict with a narrow union signature.
 */
export type KeypressTaggedStream = Readable & {
  [key: symbol]: StringDecoder | Generator<void, void, string> | undefined;
};

/**
 * Minimal `EventEmitter`-like shape used by the keypress parser to dispatch
 * `'keypress'` events back onto the stream. `Readable` already satisfies
 * this via its `EventEmitter` ancestry.
 */
export interface KeypressEmitter {
  emit(event: string | symbol, ...args: unknown[]): boolean;
}
