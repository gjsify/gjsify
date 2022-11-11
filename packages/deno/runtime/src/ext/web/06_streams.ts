// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/web/06_streams.js

// @ts-check
// <reference path="../webidl/internal.d.ts" />
// <reference path="./06_streams_types.ts" />
// <reference path="./lib.deno_web.d.ts" />
// <reference lib="esnext" />
"use strict";

import { core, ops, primordials } from '@gjsify/deno_core';
import { add, remove, signalAbort, newSignal, AbortSignalPrototype } from './03_abort_signal.js';
const {
  ArrayBuffer,
  ArrayBufferPrototype,
  ArrayBufferIsView,
  ArrayPrototypeMap,
  ArrayPrototypePush,
  ArrayPrototypeShift,
  BigInt64ArrayPrototype,
  BigUint64ArrayPrototype,
  DataView,
  Int8ArrayPrototype,
  Int16ArrayPrototype,
  Int32ArrayPrototype,
  NumberIsInteger,
  NumberIsNaN,
  MathMin,
  ObjectCreate,
  ObjectDefineProperties,
  ObjectDefineProperty,
  ObjectGetPrototypeOf,
  ObjectPrototypeIsPrototypeOf,
  ObjectSetPrototypeOf,
  Promise,
  PromisePrototypeCatch,
  PromisePrototypeThen,
  PromiseReject,
  PromiseResolve,
  queueMicrotask,
  RangeError,
  ReflectHas,
  SafePromiseAll,
  SharedArrayBuffer,
  Symbol,
  SymbolAsyncIterator,
  SymbolFor,
  TypeError,
  TypedArrayPrototypeSet,
  Uint8Array,
  Uint8ArrayPrototype,
  Uint16ArrayPrototype,
  Uint32ArrayPrototype,
  Uint8ClampedArrayPrototype,
  WeakMap,
  WeakMapPrototypeGet,
  WeakMapPrototypeHas,
  WeakMapPrototypeSet,
} = primordials;
import * as webidl from '../webidl/00_webidl.js';
import * as consoleInternal from '../console/02_console.js';
import { AssertionError, assert } from './00_infra.js';

import type {
  PendingAbortRequest,
  PullIntoDescriptor,
  ReadIntoRequest,
  ReadRequest,
  ReadableByteStreamQueueEntry,
  ReadableStreamGenericReader,
  ReadableStreamGetReaderOptions,
  ReadableStreamIteratorOptions,
  ValueWithSize,
  VoidFunction
} from './06_streams_types.js';
import type { ReadableStreamBYOBReadResult, PipeOptions } from '@gjsify/deno_core';

export class Deferred<T> {
  #promise: Promise<T>;
  #reject: (reject?: any) => void;
  #resolve: (value: T | PromiseLike<T>) => void;
  #state: "pending" | "fulfilled" = "pending";

  constructor() {
    this.#promise = new Promise((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
  }

  get promise(): Promise<T> {
    return this.#promise;
  }

  get state(): "pending" | "fulfilled" {
    return this.#state;
  }

  reject(reason: any) {
    // already settled promises are a no-op
    if (this.#state !== "pending") {
      return;
    }
    this.#state = "fulfilled";
    this.#reject(reason);
  }

  resolve(value: T | PromiseLike<T>) {
    // already settled promises are a no-op
    if (this.#state !== "pending") {
      return;
    }
    this.#state = "fulfilled";
    this.#resolve(value);
  }
}

export function resolvePromiseWith<T>(value: T | PromiseLike<T>): Promise<T> {
  return new Promise((resolve) => resolve(value));
}

export function rethrowAssertionErrorRejection(e: any) {
  if (e && ObjectPrototypeIsPrototypeOf(AssertionError.prototype, e)) {
    queueMicrotask(() => {
      console.error(`Internal Error: ${e.stack}`);
    });
  }
}

export function setPromiseIsHandledToTrue(promise: Promise<any>) {
  PromisePrototypeThen(promise, undefined, rethrowAssertionErrorRejection);
}

function transformPromiseWith<T, TResult1, TResult2>(
  promise: Promise<T>,
  fulfillmentHandler: (value: T) => TResult1 | PromiseLike<TResult1>,
  rejectionHandler?: (reason: any) => TResult2 | PromiseLike<TResult2>): Promise<TResult1 | TResult2> {
  // @ts-ignore
  return PromisePrototypeThen(promise, fulfillmentHandler, rejectionHandler);
}

function uponFulfillment<T, TResult>(promise: Promise<T>, onFulfilled: (value: T) => TResult | PromiseLike<TResult>): void {
  uponPromise(promise, onFulfilled);
}

function uponRejection<T, TResult>(promise: Promise<T>, onRejected: (value: T) => TResult | PromiseLike<TResult>): void {
  uponPromise(promise, undefined, onRejected);
}

function uponPromise<T, TResult1, TResult2>(promise: Promise<T>, onFulfilled: (value: T) => TResult1 | PromiseLike<TResult1>, onRejected?: (reason: any) => TResult2 | PromiseLike<TResult2>): void {
  PromisePrototypeThen(
    PromisePrototypeThen(promise, onFulfilled, onRejected),
    undefined,
    rethrowAssertionErrorRejection,
  );
}

function isDetachedBuffer(O: ArrayBufferLike): boolean {
  return O.byteLength === 0 && ops.op_arraybuffer_was_detached(O);
}

function canTransferArrayBuffer(O: ArrayBufferLike): boolean {
  assert(typeof O === "object");
  assert(
    ObjectPrototypeIsPrototypeOf(ArrayBufferPrototype, O) ||
      ObjectPrototypeIsPrototypeOf(SharedArrayBuffer.prototype, O),
  );
  if (isDetachedBuffer(O)) {
    return false;
  }
  // TODO(@crowlKats): 4. If SameValue(O.[[ArrayBufferDetachKey]], undefined) is false, return false.
  return true;
}

function transferArrayBuffer(O: ArrayBufferLike): ArrayBufferLike {
  return ops.op_transfer_arraybuffer(O);
}

function cloneAsUint8Array(O: ArrayBufferView): Uint8Array {
  assert(typeof O === "object");
  assert(ArrayBufferIsView(O));
  assert(!isDetachedBuffer(O.buffer));
  const buffer = O.buffer.slice(O.byteOffset, O.byteOffset + O.byteLength);
  return new Uint8Array(buffer);
}

const _abortAlgorithm = Symbol("[[abortAlgorithm]]");
const _abortSteps = Symbol("[[AbortSteps]]");
const _autoAllocateChunkSize = Symbol("[[autoAllocateChunkSize]]");
const _backpressure = Symbol("[[backpressure]]");
const _backpressureChangePromise = Symbol("[[backpressureChangePromise]]");
const _byobRequest = Symbol("[[byobRequest]]");
const _cancelAlgorithm = Symbol("[[cancelAlgorithm]]");
const _cancelSteps = Symbol("[[CancelSteps]]");
const _close = Symbol("close sentinel");
const _closeAlgorithm = Symbol("[[closeAlgorithm]]");
const _closedPromise = Symbol("[[closedPromise]]");
const _closeRequest = Symbol("[[closeRequest]]");
const _closeRequested = Symbol("[[closeRequested]]");
const _controller = Symbol("[[controller]]");
const _detached = Symbol("[[Detached]]");
const _disturbed = Symbol("[[disturbed]]");
const _errorSteps = Symbol("[[ErrorSteps]]");
const _flushAlgorithm = Symbol("[[flushAlgorithm]]");
const _globalObject = Symbol("[[globalObject]]");
const _highWaterMark = Symbol("[[highWaterMark]]");
const _inFlightCloseRequest = Symbol("[[inFlightCloseRequest]]");
const _inFlightWriteRequest = Symbol("[[inFlightWriteRequest]]");
const _pendingAbortRequest = Symbol("[pendingAbortRequest]");
const _pendingPullIntos = Symbol("[[pendingPullIntos]]");
const _preventCancel = Symbol("[[preventCancel]]");
const _pullAgain = Symbol("[[pullAgain]]");
const _pullAlgorithm = Symbol("[[pullAlgorithm]]");
const _pulling = Symbol("[[pulling]]");
const _pullSteps = Symbol("[[PullSteps]]");
const _releaseSteps = Symbol("[[ReleaseSteps]]");
const _queue = Symbol("[[queue]]");
const _queueTotalSize = Symbol("[[queueTotalSize]]");
const _readable = Symbol("[[readable]]");
const _reader = Symbol("[[reader]]");
const _readRequests = Symbol("[[readRequests]]");
const _readIntoRequests = Symbol("[[readIntoRequests]]");
const _readyPromise = Symbol("[[readyPromise]]");
const _signal = Symbol("[[signal]]");
const _started = Symbol("[[started]]");
export const _state = Symbol("[[state]]");
const _storedError = Symbol("[[storedError]]");
const _strategyHWM = Symbol("[[strategyHWM]]");
const _strategySizeAlgorithm = Symbol("[[strategySizeAlgorithm]]");
const _stream = Symbol("[[stream]]");
const _transformAlgorithm = Symbol("[[transformAlgorithm]]");
const _view = Symbol("[[view]]");
const _writable = Symbol("[[writable]]");
const _writeAlgorithm = Symbol("[[writeAlgorithm]]");
const _writer = Symbol("[[writer]]");
const _writeRequests = Symbol("[[writeRequests]]");

function acquireReadableStreamDefaultReader<R>(stream: ReadableStream<R>): ReadableStreamDefaultReader<R> {
  return new ReadableStreamDefaultReader(stream);
}

function acquireReadableStreamBYOBReader<R>(stream: ReadableStream<R>): ReadableStreamBYOBReader<R> {
  const reader = webidl.createBranded(ReadableStreamBYOBReader);
  setUpReadableStreamBYOBReader(reader, stream);
  return reader;
}

function acquireWritableStreamDefaultWriter<W>(stream: WritableStream<W>): WritableStreamDefaultWriter<W> {
  return new WritableStreamDefaultWriter(stream);
}

function createReadableStream<R>(
  startAlgorithm: () => void,
  pullAlgorithm: () => Promise<void>,
  cancelAlgorithm: (reason: any) => Promise<void>,
  highWaterMark: number = 1,
  sizeAlgorithm: ((chunk: R) => number) = () => 1,
): ReadableStream<R> {
  assert(isNonNegativeNumber(highWaterMark));

  const stream: ReadableStream = webidl.createBranded(ReadableStream);
  initializeReadableStream(stream);
  const controller = webidl.createBranded(ReadableStreamDefaultController);
  setUpReadableStreamDefaultController(
    stream,
    controller,
    startAlgorithm,
    pullAlgorithm,
    cancelAlgorithm,
    highWaterMark,
    sizeAlgorithm,
  );
  return stream;
}

function createWritableStream<W>(
  startAlgorithm: (controller: WritableStreamDefaultController<W>) => Promise<void>,
  writeAlgorithm: (chunk: W) => Promise<void>,
  closeAlgorithm: () => Promise<void>,
  abortAlgorithm: (reason: any) => Promise<void>,
  highWaterMark: number,
  sizeAlgorithm: (chunk: W) => number,
): WritableStream<W> {
  assert(isNonNegativeNumber(highWaterMark));
  const stream = webidl.createBranded(WritableStream);
  initializeWritableStream(stream);
  const controller = webidl.createBranded(WritableStreamDefaultController);
  setUpWritableStreamDefaultController(
    stream,
    controller,
    startAlgorithm,
    writeAlgorithm,
    closeAlgorithm,
    abortAlgorithm,
    highWaterMark,
    sizeAlgorithm,
  );
  return stream;
}

// @ts-ignore
function dequeueValue<T>(container: { [_queue]: Array<ValueWithSize<T>>, [_queueTotalSize]: number }): T {
  assert(
    ReflectHas(container, _queue) &&
      ReflectHas(container, _queueTotalSize),
  );
  assert(container[_queue].length);
  const valueWithSize = ArrayPrototypeShift(container[_queue]);
  container[_queueTotalSize] -= valueWithSize.size;
  if (container[_queueTotalSize] < 0) {
    container[_queueTotalSize] = 0;
  }
  return valueWithSize.value;
}

// @ts-ignore
function enqueueValueWithSize<T>(container: { [_queue]: Array<ValueWithSize<T>>, [_queueTotalSize]: number }, value: T, size: number): void {
  assert(
    ReflectHas(container, _queue) &&
      ReflectHas(container, _queueTotalSize),
  );
  if (isNonNegativeNumber(size) === false) {
    throw RangeError("chunk size isn't a positive number");
  }
  if (size === Infinity) {
    throw RangeError("chunk size is invalid");
  }
  ArrayPrototypePush(container[_queue], { value, size });
  container[_queueTotalSize] += size;
}

function extractHighWaterMark(strategy: QueuingStrategy, defaultHWM: number) {
  if (strategy.highWaterMark === undefined) {
    return defaultHWM;
  }
  const highWaterMark = strategy.highWaterMark;
  if (NumberIsNaN(highWaterMark) || highWaterMark < 0) {
    throw RangeError(
      `Expected highWaterMark to be a positive number or Infinity, got "${highWaterMark}".`,
    );
  }
  return highWaterMark;
}

function extractSizeAlgorithm<T>(strategy: QueuingStrategy<T>): (chunk: T) => number {
  if (strategy.size === undefined) {
    return () => 1;
  }
  return (chunk) =>
    webidl.invokeCallbackFunction(
      strategy.size,
      [chunk],
      undefined,
      webidl.converters["unrestricted double"],
      { prefix: "Failed to call `sizeAlgorithm`" },
    );
}

function createReadableByteStream(
  startAlgorithm: () => void,
  pullAlgorithm: () => Promise<void>,
  cancelAlgorithm: (reason: any) => Promise<void>,
): ReadableStream {
  const stream = webidl.createBranded(ReadableStream);
  initializeReadableStream(stream);
  const controller = webidl.createBranded(ReadableByteStreamController);
  setUpReadableByteStreamController(
    stream,
    controller,
    startAlgorithm,
    pullAlgorithm,
    cancelAlgorithm,
    0,
    undefined,
  );
  return stream;
}

function initializeReadableStream(stream: ReadableStream): void {
  stream[_state] = "readable";
  stream[_reader] = stream[_storedError] = undefined;
  stream[_disturbed] = false;
}

function initializeTransformStream<I, O>(
  stream: TransformStream<I, O>,
  startPromise: Deferred<void>,
  writableHighWaterMark: number,
  writableSizeAlgorithm: (chunk: I) => number,
  readableHighWaterMark: number,
  readableSizeAlgorithm: (chunk: O) => number,
) {
  function startAlgorithm() {
    return startPromise.promise;
  }

  function writeAlgorithm(chunk) {
    return transformStreamDefaultSinkWriteAlgorithm(stream, chunk) as Promise<void>;
  }

  function abortAlgorithm(reason) {
    return transformStreamDefaultSinkAbortAlgorithm(stream, reason);
  }

  function closeAlgorithm() {
    return transformStreamDefaultSinkCloseAlgorithm(stream);
  }

  stream[_writable] = createWritableStream(
    startAlgorithm,
    writeAlgorithm,
    closeAlgorithm,
    abortAlgorithm,
    writableHighWaterMark,
    writableSizeAlgorithm,
  );

  function pullAlgorithm() {
    return transformStreamDefaultSourcePullAlgorithm(stream);
  }

  function cancelAlgorithm(reason) {
    transformStreamErrorWritableAndUnblockWrite(stream, reason);
    return resolvePromiseWith(undefined);
  }

  stream[_readable] = createReadableStream(
    startAlgorithm,
    pullAlgorithm,
    cancelAlgorithm,
    readableHighWaterMark,
    readableSizeAlgorithm,
  );

  stream[_backpressure] = stream[_backpressureChangePromise] = undefined;
  transformStreamSetBackpressure(stream, true);
  stream[_controller] = undefined;
}

export function initializeWritableStream(stream: WritableStream) {
  stream[_state] = "writable";
  stream[_storedError] =
    stream[_writer] =
    stream[_controller] =
    stream[_inFlightWriteRequest] =
    stream[_closeRequest] =
    stream[_inFlightCloseRequest] =
    stream[_pendingAbortRequest] =
      undefined;
  stream[_writeRequests] = [];
  stream[_backpressure] = false;
}

export function isNonNegativeNumber(v: unknown): v is number {
  if (typeof v !== "number") {
    return false;
  }
  if (NumberIsNaN(v)) {
    return false;
  }
  if (v < 0) {
    return false;
  }
  return true;
}

export function isReadableStream(value: unknown): value is ReadableStream {
  return !(typeof value !== "object" || value === null ||
    !ReflectHas(value, _controller));
}

export function isReadableStreamLocked(stream: ReadableStream): boolean {
  if (stream[_reader] === undefined) {
    return false;
  }
  return true;
}

export function isReadableStreamDefaultReader(value: unknown): value is ReadableStreamDefaultReader {
  return !(typeof value !== "object" || value === null ||
    !ReflectHas(value, _readRequests));
}

export function isReadableStreamBYOBReader(value: unknown): value is ReadableStreamBYOBReader {
  return !(typeof value !== "object" || value === null ||
    !ReflectHas(value, _readIntoRequests));
}

export function isReadableStreamDisturbed(stream: ReadableStream): boolean {
  assert(isReadableStream(stream));
  return stream[_disturbed];
}

const DEFAULT_CHUNK_SIZE = 64 * 1024; // 64 KiB

// A finalization registry to clean up underlying resources that are GC'ed.
const RESOURCE_REGISTRY = new FinalizationRegistry((rid: number) => {
  core.tryClose(rid);
});

const _readAll = Symbol("[[readAll]]");
const _original = Symbol("[[original]]");
/**
 * Create a new ReadableStream object that is backed by a Resource that
 * implements `Resource::read_return`. This object contains enough metadata to
 * allow callers to bypass the JavaScript ReadableStream implementation and
 * read directly from the underlying resource if they so choose (FastStream).
 *
 * @param rid The resource ID to read from.
 * @param autoClose If the resource should be auto-closed when the stream closes. Defaults to true.
 * @returns
 */
export function readableStreamForRid(rid: number, autoClose: boolean = true): ReadableStream<Uint8Array> {
  const stream = webidl.createBranded(ReadableStream);
  stream[_resourceBacking] = { rid, autoClose };

  const tryClose = () => {
    if (!autoClose) return;
    RESOURCE_REGISTRY.unregister(stream);
    core.tryClose(rid);
  };

  if (autoClose) {
    RESOURCE_REGISTRY.register(stream, rid, stream);
  }

  const underlyingSource: UnderlyingSource<ArrayBuffer> = {
    // @ts-ignore
    type: "bytes",
    async pull(controller) {
      // @ts-ignore
      const v = controller.byobRequest.view;
      try {
        if (controller[_readAll] === true) {
          // fast path for tee'd streams consuming body
          const chunk = await core.readAll(rid);
          if (chunk.byteLength > 0) {
            controller.enqueue(chunk);
          }
          controller.close();
          tryClose();
          return;
        }

        const bytesRead = await core.read(rid, v);
        if (bytesRead === 0) {
          tryClose();
          controller.close();
          // @ts-ignore
          controller.byobRequest.respond(0);
        } else {
          // @ts-ignore
          controller.byobRequest.respond(bytesRead);
        }
      } catch (e) {
        controller.error(e);
        tryClose();
      }
    },
    cancel() {
      tryClose();
    },
    autoAllocateChunkSize: DEFAULT_CHUNK_SIZE,
  };
  initializeReadableStream(stream);
  setUpReadableByteStreamControllerFromUnderlyingSource(
    stream,
    underlyingSource,
    underlyingSource,
    0,
  );
  return stream;
}

const promiseIdSymbol = SymbolFor("Deno.core.internalPromiseId");
const _isUnref = Symbol("isUnref");

/**
 * Create a new ReadableStream object that is backed by a Resource that
 * implements `Resource::read_return`. This readable stream supports being
 * refed and unrefed by calling `readableStreamForRidUnrefableRef` and
 * `readableStreamForRidUnrefableUnref` on it. Unrefable streams are not
 * FastStream compatible.
 *
 * @param rid The resource ID to read from.
 * @returns
 */
export function readableStreamForRidUnrefable(rid: number): ReadableStream<Uint8Array> {
  const stream = webidl.createBranded(ReadableStream);
  stream[promiseIdSymbol] = undefined;
  stream[_isUnref] = false;
  const underlyingSource: UnderlyingSource<ArrayBuffer> = {
    // @ts-ignore
    type: "bytes",
    async pull(controller) {
      // @ts-ignore
      const v = controller.byobRequest.view;
      try {
        const promise = core.read(rid, v);
        const promiseId = stream[promiseIdSymbol] = promise[promiseIdSymbol];
        if (stream[_isUnref]) core.unrefOp(promiseId);
        const bytesRead = await promise;
        stream[promiseIdSymbol] = undefined;
        if (bytesRead === 0) {
          core.tryClose(rid);
          controller.close();
          // @ts-ignore
          controller.byobRequest.respond(0);
        } else {
          // @ts-ignore
          controller.byobRequest.respond(bytesRead);
        }
      } catch (e) {
        controller.error(e);
        core.tryClose(rid);
      }
    },
    cancel() {
      core.tryClose(rid);
    },
    autoAllocateChunkSize: DEFAULT_CHUNK_SIZE,
  };
  initializeReadableStream(stream);
  setUpReadableByteStreamControllerFromUnderlyingSource(
    stream,
    underlyingSource,
    underlyingSource,
    0,
  );
  return stream;
}

export function readableStreamForRidUnrefableRef(stream) {
  if (!(_isUnref in stream)) throw new TypeError("Not an unrefable stream");
  stream[_isUnref] = false;
  if (stream[promiseIdSymbol] !== undefined) {
    core.refOp(stream[promiseIdSymbol]);
  }
}

export function readableStreamForRidUnrefableUnref(stream) {
  if (!(_isUnref in stream)) throw new TypeError("Not an unrefable stream");
  stream[_isUnref] = true;
  if (stream[promiseIdSymbol] !== undefined) {
    core.unrefOp(stream[promiseIdSymbol]);
  }
}

export function getReadableStreamResourceBacking(stream) {
  return stream[_resourceBacking];
}

export async function readableStreamCollectIntoUint8Array(stream) {
  const resourceBacking = getReadableStreamResourceBacking(stream);
  const reader = acquireReadableStreamDefaultReader(stream);

  if (resourceBacking) {
    // fast path, read whole body in a single op call
    try {
      readableStreamDisturb(stream);
      const buf = await core.opAsync("op_read_all", resourceBacking.rid);
      readableStreamThrowIfErrored(stream);
      readableStreamClose(stream);
      return buf;
    } catch (err) {
      readableStreamThrowIfErrored(stream);
      readableStreamError(stream, err);
      throw err;
    } finally {
      if (resourceBacking.autoClose) {
        core.tryClose(resourceBacking.rid);
      }
    }
  }

  // slow path
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  // tee'd stream
  if (stream[_original]) {
    // One of the branches is consuming the stream
    // signal controller.pull that we can consume it in a single op
    stream[_original][_controller][_readAll] = true;
  }

  while (true) {
    const { value: chunk, done } = await reader.read();

    if (done) break;

    if (!ObjectPrototypeIsPrototypeOf(Uint8ArrayPrototype, chunk)) {
      throw new TypeError(
        "Can't convert value to Uint8Array while consuming the stream",
      );
    }

    ArrayPrototypePush(chunks, chunk);
    totalLength += (chunk as Uint8Array).byteLength;
  }

  const finalBuffer = new Uint8Array(totalLength);
  let i = 0;
  for (const chunk of chunks) {
    TypedArrayPrototypeSet(finalBuffer, chunk, i);
    i += chunk.byteLength;
  }
  return finalBuffer;
}

/**
 * Create a new Writable object that is backed by a Resource that implements
 * `Resource::write` / `Resource::write_all`. This object contains enough
 * metadata to allow callers to bypass the JavaScript WritableStream
 * implementation and write directly to the underlying resource if they so
 * choose (FastStream).
 *
 * @param rid The resource ID to write to.
 * @param autoClose If the resource should be auto-closed when the stream closes. Defaults to true.
 * @returns
 */
export function writableStreamForRid(rid: number, autoClose: boolean = true): WritableStream<Uint8Array> {
  const stream = webidl.createBranded(WritableStream);
  stream[_resourceBacking] = { rid, autoClose };

  const tryClose = () => {
    if (!autoClose) return;
    RESOURCE_REGISTRY.unregister(stream);
    core.tryClose(rid);
  };

  if (autoClose) {
    RESOURCE_REGISTRY.register(stream, rid, stream);
  }

  const underlyingSink = {
    async write(chunk, controller) {
      try {
        await core.writeAll(rid, chunk);
      } catch (e) {
        controller.error(e);
        tryClose();
      }
    },
    close() {
      tryClose();
    },
    abort() {
      tryClose();
    },
  };
  initializeWritableStream(stream);
  setUpWritableStreamDefaultControllerFromUnderlyingSink(
    stream,
    underlyingSink,
    underlyingSink,
    1,
    () => 1,
  );
  return stream;
}

export function getWritableStreamResourceBacking(stream) {
  return stream[_resourceBacking];
}

export function readableStreamThrowIfErrored(stream: ReadableStream) {
  if (stream[_state] === "errored") {
    throw stream[_storedError];
  }
}

function isWritableStream(value: unknown): value is WritableStream {
  return !(typeof value !== "object" || value === null ||
    !ReflectHas(value, _controller));
}

function isWritableStreamLocked(stream: WritableStream): boolean {
  if (stream[_writer] === undefined) {
    return false;
  }
  return true;
}

// @ts-ignore
function peekQueueValue<T>(container: { [_queue]: Array<ValueWithSize<T>>, [_queueTotalSize]: number }): T {
  assert(
    ReflectHas(container, _queue) &&
      ReflectHas(container, _queueTotalSize),
  );
  assert(container[_queue].length);
  const valueWithSize = container[_queue][0];
  return valueWithSize.value;
}

function readableByteStreamControllerCallPullIfNeeded(controller: ReadableByteStreamController): void {
  const shouldPull = readableByteStreamControllerShouldCallPull(controller);
  if (!shouldPull) {
    return;
  }
  if (controller[_pulling]) {
    controller[_pullAgain] = true;
    return;
  }
  assert(controller[_pullAgain] === false);
  controller[_pulling] = true;
  const pullPromise: Promise<void> = controller[_pullAlgorithm](controller);
  setPromiseIsHandledToTrue(
    PromisePrototypeThen(
      pullPromise,
      () => {
        controller[_pulling] = false;
        if (controller[_pullAgain]) {
          controller[_pullAgain] = false;
          readableByteStreamControllerCallPullIfNeeded(controller);
        }
      },
      (e) => {
        readableByteStreamControllerError(controller, e);
      },
    ),
  );
}

function readableByteStreamControllerClearAlgorithms(controller: ReadableByteStreamController): void {
  controller[_pullAlgorithm] = undefined;
  controller[_cancelAlgorithm] = undefined;
}

function readableByteStreamControllerError(controller: ReadableByteStreamController, e: any) {
  const stream: ReadableStream<ArrayBuffer> = controller[_stream];
  if (stream[_state] !== "readable") {
    return;
  }
  readableByteStreamControllerClearPendingPullIntos(controller);
  resetQueue(controller);
  readableByteStreamControllerClearAlgorithms(controller);
  readableStreamError(stream, e);
}

function readableByteStreamControllerClearPendingPullIntos(controller: ReadableByteStreamController): void {
  readableByteStreamControllerInvalidateBYOBRequest(controller);
  controller[_pendingPullIntos] = [];
}

function readableByteStreamControllerClose(controller: ReadableByteStreamController): void {
  const stream: ReadableStream<ArrayBuffer> = controller[_stream];
  if (controller[_closeRequested] || stream[_state] !== "readable") {
    return;
  }
  if (controller[_queueTotalSize] > 0) {
    controller[_closeRequested] = true;
    return;
  }
  if (controller[_pendingPullIntos].length !== 0) {
    const firstPendingPullInto = controller[_pendingPullIntos][0];
    if (firstPendingPullInto.bytesFilled > 0) {
      const e = new TypeError(
        "Insufficient bytes to fill elements in the given buffer",
      );
      readableByteStreamControllerError(controller, e);
      throw e;
    }
  }
  readableByteStreamControllerClearAlgorithms(controller);
  readableStreamClose(stream);
}

function readableByteStreamControllerEnqueue(controller: ReadableByteStreamController, chunk: ArrayBufferView) {
  const stream: ReadableStream<ArrayBuffer> = controller[_stream];
  if (
    controller[_closeRequested] ||
    controller[_stream][_state] !== "readable"
  ) {
    return;
  }

  const { buffer, byteOffset, byteLength } = chunk;
  if (isDetachedBuffer(buffer)) {
    throw new TypeError(
      "chunk's buffer is detached and so cannot be enqueued",
    );
  }
  const transferredBuffer = transferArrayBuffer(buffer);
  if (controller[_pendingPullIntos].length !== 0) {
    const firstPendingPullInto = controller[_pendingPullIntos][0];
    if (isDetachedBuffer(firstPendingPullInto.buffer)) {
      throw new TypeError(
        "The BYOB request's buffer has been detached and so cannot be filled with an enqueued chunk",
      );
    }
    readableByteStreamControllerInvalidateBYOBRequest(controller);
    firstPendingPullInto.buffer = transferArrayBuffer(
      firstPendingPullInto.buffer,
    );
    if (firstPendingPullInto.readerType === "none") {
      readableByteStreamControllerEnqueueDetachedPullIntoToQueue(
        controller,
        firstPendingPullInto,
      );
    }
  }
  if (readableStreamHasDefaultReader(stream)) {
    readableByteStreamControllerProcessReadRequestsUsingQueue(controller);
    if (readableStreamGetNumReadRequests(stream) === 0) {
      assert(controller[_pendingPullIntos].length === 0);
      readableByteStreamControllerEnqueueChunkToQueue(
        controller,
        transferredBuffer,
        byteOffset,
        byteLength,
      );
    } else {
      assert(controller[_queue].length === 0);
      if (controller[_pendingPullIntos].length !== 0) {
        assert(controller[_pendingPullIntos][0].readerType === "default");
        readableByteStreamControllerShiftPendingPullInto(controller);
      }
      const transferredView = new Uint8Array(
        transferredBuffer,
        byteOffset,
        byteLength,
      );
      readableStreamFulfillReadRequest(stream, transferredView, false);
    }
  } else if (readableStreamHasBYOBReader(stream)) {
    readableByteStreamControllerEnqueueChunkToQueue(
      controller,
      transferredBuffer,
      byteOffset,
      byteLength,
    );
    readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(
      controller,
    );
  } else {
    assert(isReadableStreamLocked(stream) === false);
    readableByteStreamControllerEnqueueChunkToQueue(
      controller,
      transferredBuffer,
      byteOffset,
      byteLength,
    );
  }
  readableByteStreamControllerCallPullIfNeeded(controller);
}

function readableByteStreamControllerEnqueueChunkToQueue(
  controller: ReadableByteStreamController,
  buffer: ArrayBufferLike,
  byteOffset: number,
  byteLength: number,
): void {
  ArrayPrototypePush(controller[_queue], { buffer, byteOffset, byteLength });
  controller[_queueTotalSize] += byteLength;
}

function readableByteStreamControllerEnqueueClonedChunkToQueue(
  controller: ReadableByteStreamController,
  buffer: ArrayBufferLike,
  byteOffset: number,
  byteLength: number,
): void {
  let cloneResult;
  try {
    cloneResult = buffer.slice(byteOffset, byteOffset + byteLength);
  } catch (e) {
    readableByteStreamControllerError(controller, e);
  }
  readableByteStreamControllerEnqueueChunkToQueue(
    controller,
    cloneResult,
    0,
    byteLength,
  );
}

function readableByteStreamControllerEnqueueDetachedPullIntoToQueue(
  controller: ReadableByteStreamController,
  pullIntoDescriptor: PullIntoDescriptor,
): void {
  assert(pullIntoDescriptor.readerType === "none");
  if (pullIntoDescriptor.bytesFilled > 0) {
    readableByteStreamControllerEnqueueClonedChunkToQueue(
      controller,
      pullIntoDescriptor.buffer,
      pullIntoDescriptor.byteOffset,
      pullIntoDescriptor.bytesFilled,
    );
  }
  readableByteStreamControllerShiftPendingPullInto(controller);
}

function readableByteStreamControllerGetBYOBRequest(controller: ReadableByteStreamController): ReadableStreamBYOBRequest | null {
  if (
    controller[_byobRequest] === null &&
    controller[_pendingPullIntos].length !== 0
  ) {
    const firstDescriptor = controller[_pendingPullIntos][0];
    const view = new Uint8Array(
      firstDescriptor.buffer,
      firstDescriptor.byteOffset + firstDescriptor.bytesFilled,
      firstDescriptor.byteLength - firstDescriptor.bytesFilled,
    );
    const byobRequest = webidl.createBranded(ReadableStreamBYOBRequest);
    byobRequest[_controller] = controller;
    byobRequest[_view] = view;
    controller[_byobRequest] = byobRequest;
  }
  return controller[_byobRequest];
}

function readableByteStreamControllerGetDesiredSize(controller: ReadableByteStreamController): number | null {
  const state = controller[_stream][_state];
  if (state === "errored") {
    return null;
  }
  if (state === "closed") {
    return 0;
  }
  return controller[_strategyHWM] - controller[_queueTotalSize];
}

// @ts-ignore
function resetQueue(container: { [_queue]: any[], [_queueTotalSize]: number }): void {
  container[_queue] = [];
  container[_queueTotalSize] = 0;
}

function readableByteStreamControllerHandleQueueDrain(controller: ReadableByteStreamController): void {
  assert(controller[_stream][_state] === "readable");
  if (
    controller[_queueTotalSize] === 0 && controller[_closeRequested]
  ) {
    readableByteStreamControllerClearAlgorithms(controller);
    readableStreamClose(controller[_stream]);
  } else {
    readableByteStreamControllerCallPullIfNeeded(controller);
  }
}

function readableByteStreamControllerShouldCallPull(controller: ReadableByteStreamController): boolean {
  const stream: ReadableStream<ArrayBuffer> = controller[_stream];
  if (
    stream[_state] !== "readable" ||
    controller[_closeRequested] ||
    !controller[_started]
  ) {
    return false;
  }
  if (
    readableStreamHasDefaultReader(stream) &&
    readableStreamGetNumReadRequests(stream) > 0
  ) {
    return true;
  }
  if (
    readableStreamHasBYOBReader(stream) &&
    readableStreamGetNumReadIntoRequests(stream) > 0
  ) {
    return true;
  }
  const desiredSize = readableByteStreamControllerGetDesiredSize(controller);
  assert(desiredSize !== null);
  return desiredSize > 0;
}

function readableStreamAddReadRequest<R>(stream: ReadableStream<R>, readRequest: ReadRequest<R>): void {
  assert(isReadableStreamDefaultReader(stream[_reader]));
  assert(stream[_state] === "readable");
  ArrayPrototypePush(stream[_reader][_readRequests], readRequest);
}

function readableStreamAddReadIntoRequest(stream: ReadableStream, readRequest: ReadIntoRequest): void {
  assert(isReadableStreamBYOBReader(stream[_reader]));
  assert(stream[_state] === "readable" || stream[_state] === "closed");
  ArrayPrototypePush(stream[_reader][_readIntoRequests], readRequest);
}

function readableStreamCancel<R>(stream: ReadableStream<R>, reason?: any): Promise<void> {
  stream[_disturbed] = true;
  if (stream[_state] === "closed") {
    return resolvePromiseWith(undefined);
  }
  if (stream[_state] === "errored") {
    return PromiseReject(stream[_storedError]);
  }
  readableStreamClose(stream);
  const reader = stream[_reader];
  if (reader !== undefined && isReadableStreamBYOBReader(reader)) {
    const readIntoRequests = reader[_readIntoRequests];
    reader[_readIntoRequests] = [];
    for (const readIntoRequest of readIntoRequests) {
      readIntoRequest.closeSteps(undefined);
    }
  }
  const sourceCancelPromise: Promise<void> = stream[_controller][_cancelSteps](reason);
  return PromisePrototypeThen(sourceCancelPromise, () => undefined) as Promise<void>;
}

export function readableStreamClose<R>(stream: ReadableStream<R>): void {
  assert(stream[_state] === "readable");
  stream[_state] = "closed";
  const reader: ReadableStreamDefaultReader<R> | undefined = stream[_reader];
  if (!reader) {
    return;
  }
  if (isReadableStreamDefaultReader(reader)) {
    const readRequests: Array<ReadRequest<R>> = reader[_readRequests];
    reader[_readRequests] = [];
    for (const readRequest of readRequests) {
      readRequest.closeSteps();
    }
  }
  // This promise can be double resolved.
  // See: https://github.com/whatwg/streams/issues/1100
  reader[_closedPromise].resolve(undefined);
}

export function readableStreamDisturb<R>(stream: ReadableStream<R>): void {
  stream[_disturbed] = true;
}

function readableStreamDefaultControllerCallPullIfNeeded(controller: ReadableStreamDefaultController<any>) {
  const shouldPull = readableStreamDefaultcontrollerShouldCallPull(
    controller,
  );
  if (shouldPull === false) {
    return;
  }
  if (controller[_pulling] === true) {
    controller[_pullAgain] = true;
    return;
  }
  assert(controller[_pullAgain] === false);
  controller[_pulling] = true;
  const pullPromise = controller[_pullAlgorithm](controller);
  uponFulfillment(pullPromise, () => {
    controller[_pulling] = false;
    if (controller[_pullAgain] === true) {
      controller[_pullAgain] = false;
      readableStreamDefaultControllerCallPullIfNeeded(controller);
    }
  });
  uponRejection(pullPromise, (e) => {
    readableStreamDefaultControllerError(controller, e);
  });
}

function readableStreamDefaultControllerCanCloseOrEnqueue(controller: ReadableStreamDefaultController<any>): boolean {
  const state = controller[_stream][_state];
  if (controller[_closeRequested] === false && state === "readable") {
    return true;
  } else {
    return false;
  }
}

function readableStreamDefaultControllerClearAlgorithms(controller: ReadableStreamDefaultController<any>) {
  controller[_pullAlgorithm] = undefined;
  controller[_cancelAlgorithm] = undefined;
  controller[_strategySizeAlgorithm] = undefined;
}

function readableStreamDefaultControllerClose(controller: ReadableStreamDefaultController<any>) {
  if (
    readableStreamDefaultControllerCanCloseOrEnqueue(controller) === false
  ) {
    return;
  }
  const stream = controller[_stream];
  controller[_closeRequested] = true;
  if (controller[_queue].length === 0) {
    readableStreamDefaultControllerClearAlgorithms(controller);
    readableStreamClose(stream);
  }
}

function readableStreamDefaultControllerEnqueue<R>(controller: ReadableStreamDefaultController<R>, chunk: R): void {
  if (
    readableStreamDefaultControllerCanCloseOrEnqueue(controller) === false
  ) {
    return;
  }
  const stream = controller[_stream];
  if (
    isReadableStreamLocked(stream) === true &&
    readableStreamGetNumReadRequests(stream) > 0
  ) {
    readableStreamFulfillReadRequest(stream, chunk, false);
  } else {
    let chunkSize;
    try {
      chunkSize = controller[_strategySizeAlgorithm](chunk);
    } catch (e) {
      readableStreamDefaultControllerError(controller, e);
      throw e;
    }

    try {
      enqueueValueWithSize(controller, chunk, chunkSize);
    } catch (e) {
      readableStreamDefaultControllerError(controller, e);
      throw e;
    }
  }
  readableStreamDefaultControllerCallPullIfNeeded(controller);
}

function readableStreamDefaultControllerError(controller: ReadableStreamDefaultController<any>, e: any) {
  const stream = controller[_stream];
  if (stream[_state] !== "readable") {
    return;
  }
  resetQueue(controller);
  readableStreamDefaultControllerClearAlgorithms(controller);
  readableStreamError(stream, e);
}

function readableStreamDefaultControllerGetDesiredSize(controller: ReadableStreamDefaultController<any>): number | null {
  const state = controller[_stream][_state];
  if (state === "errored") {
    return null;
  }
  if (state === "closed") {
    return 0;
  }
  return controller[_strategyHWM] - controller[_queueTotalSize];
}

function readableStreamDefaultcontrollerHasBackpressure(controller: ReadableStreamDefaultController) {
  if (readableStreamDefaultcontrollerShouldCallPull(controller) === true) {
    return false;
  } else {
    return true;
  }
}

function readableStreamDefaultcontrollerShouldCallPull(controller: ReadableStreamDefaultController<any>): boolean {
  const stream = controller[_stream];
  if (
    readableStreamDefaultControllerCanCloseOrEnqueue(controller) === false
  ) {
    return false;
  }
  if (controller[_started] === false) {
    return false;
  }
  if (
    isReadableStreamLocked(stream) &&
    readableStreamGetNumReadRequests(stream) > 0
  ) {
    return true;
  }
  const desiredSize = readableStreamDefaultControllerGetDesiredSize(
    controller,
  );
  assert(desiredSize !== null);
  if (desiredSize > 0) {
    return true;
  }
  return false;
}

function readableStreamBYOBReaderRead(reader: ReadableStreamBYOBReader, view: ArrayBufferView, readIntoRequest: ReadIntoRequest): void {
  const stream = reader[_stream];
  assert(stream);
  stream[_disturbed] = true;
  if (stream[_state] === "errored") {
    readIntoRequest.errorSteps(stream[_storedError]);
  } else {
    readableByteStreamControllerPullInto(
      stream[_controller],
      view,
      readIntoRequest,
    );
  }
}

function readableStreamBYOBReaderRelease(reader: ReadableStreamBYOBReader) {
  readableStreamReaderGenericRelease(reader);
  const e = new TypeError("The reader was released.");
  readableStreamBYOBReaderErrorReadIntoRequests(reader, e);
}

function readableStreamDefaultReaderErrorReadRequests(reader: ReadableStreamBYOBReader, e: any) {
  const readRequests = reader[_readRequests];
  reader[_readRequests] = [];
  for (const readRequest of readRequests) {
    readRequest.errorSteps(e);
  }
}

function readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(
  controller: ReadableByteStreamController,
) {
  assert(!controller[_closeRequested]);
  while (controller[_pendingPullIntos].length !== 0) {
    if (controller[_queueTotalSize] === 0) {
      return;
    }
    const pullIntoDescriptor = controller[_pendingPullIntos][0];
    if (
      readableByteStreamControllerFillPullIntoDescriptorFromQueue(
        controller,
        pullIntoDescriptor,
      )
    ) {
      readableByteStreamControllerShiftPendingPullInto(controller);
      readableByteStreamControllerCommitPullIntoDescriptor(
        controller[_stream],
        pullIntoDescriptor,
      );
    }
  }
}

function readableByteStreamControllerProcessReadRequestsUsingQueue(
  controller: ReadableByteStreamController,
) {
  const reader = controller[_stream][_reader];
  assert(isReadableStreamDefaultReader(reader));
  while (reader[_readRequests].length !== 0) {
    if (controller[_queueTotalSize] === 0) {
      return;
    }
    const readRequest = ArrayPrototypeShift(reader[_readRequests]);
    readableByteStreamControllerFillReadRequestFromQueue(
      controller,
      readRequest,
    );
  }
}

function readableByteStreamControllerPullInto(
  controller: ReadableByteStreamController,
  view: ArrayBufferView,
  readIntoRequest: ReadIntoRequest,
): void {
  const stream = controller[_stream];
  let elementSize = 1;
  let ctor: any = DataView;

  if (
    ObjectPrototypeIsPrototypeOf(Int8ArrayPrototype, view) ||
    ObjectPrototypeIsPrototypeOf(Uint8ArrayPrototype, view) ||
    ObjectPrototypeIsPrototypeOf(Uint8ClampedArrayPrototype, view) ||
    ObjectPrototypeIsPrototypeOf(Int16ArrayPrototype, view) ||
    ObjectPrototypeIsPrototypeOf(Uint16ArrayPrototype, view) ||
    ObjectPrototypeIsPrototypeOf(Int32ArrayPrototype, view) ||
    ObjectPrototypeIsPrototypeOf(Uint32ArrayPrototype, view) ||
    ObjectPrototypeIsPrototypeOf(BigInt64ArrayPrototype, view) ||
    ObjectPrototypeIsPrototypeOf(BigUint64ArrayPrototype, view)
  ) {
    elementSize = (view.constructor as any).BYTES_PER_ELEMENT;
    ctor = view.constructor;
  }
  const byteOffset = view.byteOffset;
  const byteLength = view.byteLength;

  let buffer: ArrayBufferLike;

  try {
    buffer = transferArrayBuffer(view.buffer);
  } catch (e) {
    readIntoRequest.errorSteps(e);
    return;
  }

  const pullIntoDescriptor: PullIntoDescriptor = {
    buffer,
    bufferByteLength: buffer.byteLength,
    byteOffset,
    byteLength,
    bytesFilled: 0,
    elementSize,
    viewConstructor: ctor,
    readerType: "byob",
  };

  if (controller[_pendingPullIntos].length !== 0) {
    ArrayPrototypePush(controller[_pendingPullIntos], pullIntoDescriptor);
    readableStreamAddReadIntoRequest(stream, readIntoRequest);
    return;
  }
  if (stream[_state] === "closed") {
    const emptyView = new ctor(
      pullIntoDescriptor.buffer,
      pullIntoDescriptor.byteOffset,
      0,
    );
    readIntoRequest.closeSteps(emptyView);
    return;
  }
  if (controller[_queueTotalSize] > 0) {
    if (
      readableByteStreamControllerFillPullIntoDescriptorFromQueue(
        controller,
        pullIntoDescriptor,
      )
    ) {
      const filledView =
        readableByteStreamControllerConvertPullIntoDescriptor(
          pullIntoDescriptor,
        );
      readableByteStreamControllerHandleQueueDrain(controller);
      readIntoRequest.chunkSteps(filledView);
      return;
    }
    if (controller[_closeRequested]) {
      const e = new TypeError(
        "Insufficient bytes to fill elements in the given buffer",
      );
      readableByteStreamControllerError(controller, e);
      readIntoRequest.errorSteps(e);
      return;
    }
  }
  controller[_pendingPullIntos].push(pullIntoDescriptor);
  readableStreamAddReadIntoRequest(stream, readIntoRequest);
  readableByteStreamControllerCallPullIfNeeded(controller);
}

function readableByteStreamControllerRespond(controller: ReadableByteStreamController, bytesWritten: number): void {
  assert(controller[_pendingPullIntos].length !== 0);
  const firstDescriptor = controller[_pendingPullIntos][0];
  const state = controller[_stream][_state];
  if (state === "closed") {
    if (bytesWritten !== 0) {
      throw new TypeError(
        "bytesWritten must be 0 when calling respond() on a closed stream",
      );
    }
  } else {
    assert(state === "readable");
    if (bytesWritten === 0) {
      throw new TypeError(
        "bytesWritten must be greater than 0 when calling respond() on a readable stream",
      );
    }
    if (
      (firstDescriptor.bytesFilled + bytesWritten) >
        firstDescriptor.byteLength
    ) {
      throw new RangeError("bytesWritten out of range");
    }
  }
  firstDescriptor.buffer = transferArrayBuffer(firstDescriptor.buffer);
  readableByteStreamControllerRespondInternal(controller, bytesWritten);
}

function readableByteStreamControllerRespondInReadableState(
  controller: ReadableByteStreamController,
  bytesWritten: number,
  pullIntoDescriptor: PullIntoDescriptor,
): void {
  assert(
    (pullIntoDescriptor.bytesFilled + bytesWritten) <=
      pullIntoDescriptor.byteLength,
  );
  readableByteStreamControllerFillHeadPullIntoDescriptor(
    controller,
    bytesWritten,
    pullIntoDescriptor,
  );
  if (pullIntoDescriptor.readerType === "none") {
    readableByteStreamControllerEnqueueDetachedPullIntoToQueue(
      controller,
      pullIntoDescriptor,
    );
    readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(
      controller,
    );
    return;
  }
  if (pullIntoDescriptor.bytesFilled < pullIntoDescriptor.elementSize) {
    return;
  }
  readableByteStreamControllerShiftPendingPullInto(controller);
  const remainderSize = pullIntoDescriptor.bytesFilled %
    pullIntoDescriptor.elementSize;
  if (remainderSize > 0) {
    const end = pullIntoDescriptor.byteOffset +
      pullIntoDescriptor.bytesFilled;
    readableByteStreamControllerEnqueueClonedChunkToQueue(
      controller,
      pullIntoDescriptor.buffer,
      end - remainderSize,
      remainderSize,
    );
  }
  pullIntoDescriptor.bytesFilled -= remainderSize;
  readableByteStreamControllerCommitPullIntoDescriptor(
    controller[_stream],
    pullIntoDescriptor,
  );
  readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(
    controller,
  );
}

function readableByteStreamControllerRespondInternal(
  controller: ReadableByteStreamController,
  bytesWritten: number,
): void {
  const firstDescriptor = controller[_pendingPullIntos][0];
  assert(canTransferArrayBuffer(firstDescriptor.buffer));
  readableByteStreamControllerInvalidateBYOBRequest(controller);
  const state = controller[_stream][_state];
  if (state === "closed") {
    assert(bytesWritten === 0);
    readableByteStreamControllerRespondInClosedState(
      controller,
      firstDescriptor,
    );
  } else {
    assert(state === "readable");
    assert(bytesWritten > 0);
    readableByteStreamControllerRespondInReadableState(
      controller,
      bytesWritten,
      firstDescriptor,
    );
  }
  readableByteStreamControllerCallPullIfNeeded(controller);
}

function readableByteStreamControllerInvalidateBYOBRequest(controller: ReadableByteStreamController) {
  if (controller[_byobRequest] === null) {
    return;
  }
  controller[_byobRequest][_controller] = undefined;
  controller[_byobRequest][_view] = null;
  controller[_byobRequest] = null;
}

function readableByteStreamControllerRespondInClosedState(
  controller: ReadableByteStreamController,
  firstDescriptor: PullIntoDescriptor,
) {
  assert(firstDescriptor.bytesFilled === 0);
  if (firstDescriptor.readerType === "none") {
    readableByteStreamControllerShiftPendingPullInto(controller);
  }
  const stream = controller[_stream];
  if (readableStreamHasBYOBReader(stream)) {
    while (readableStreamGetNumReadIntoRequests(stream) > 0) {
      const pullIntoDescriptor =
        readableByteStreamControllerShiftPendingPullInto(controller);
      readableByteStreamControllerCommitPullIntoDescriptor(
        stream,
        pullIntoDescriptor,
      );
    }
  }
}

function readableByteStreamControllerCommitPullIntoDescriptor<R>(
  stream: ReadableStream<R>,
  pullIntoDescriptor: PullIntoDescriptor,
) {
  assert(stream[_state] !== "errored");
  assert(pullIntoDescriptor.readerType !== "none");
  let done = false;
  if (stream[_state] === "closed") {
    assert(pullIntoDescriptor.bytesFilled === 0);
    done = true;
  }
  const filledView = readableByteStreamControllerConvertPullIntoDescriptor(
    pullIntoDescriptor,
  );
  if (pullIntoDescriptor.readerType === "default") {
    readableStreamFulfillReadRequest(stream, filledView as R, done);
  } else {
    assert(pullIntoDescriptor.readerType === "byob");
    readableStreamFulfillReadIntoRequest(stream, filledView as R, done);
  }
}

function readableByteStreamControllerRespondWithNewView(controller: ReadableByteStreamController, view: ArrayBufferView) {
  assert(controller[_pendingPullIntos].length !== 0);
  assert(!isDetachedBuffer(view.buffer));
  const firstDescriptor = controller[_pendingPullIntos][0];
  const state = controller[_stream][_state];
  if (state === "closed") {
    if (view.byteLength !== 0) {
      throw new TypeError(
        "The view's length must be 0 when calling respondWithNewView() on a closed stream",
      );
    }
  } else {
    assert(state === "readable");
    if (view.byteLength === 0) {
      throw new TypeError(
        "The view's length must be greater than 0 when calling respondWithNewView() on a readable stream",
      );
    }
  }
  if (
    (firstDescriptor.byteOffset + firstDescriptor.bytesFilled) !==
      view.byteOffset
  ) {
    throw new RangeError(
      "The region specified by view does not match byobRequest",
    );
  }
  if (firstDescriptor.bufferByteLength !== view.buffer.byteLength) {
    throw new RangeError(
      "The buffer of view has different capacity than byobRequest",
    );
  }
  if (
    (firstDescriptor.bytesFilled + view.byteLength) >
      firstDescriptor.byteLength
  ) {
    throw new RangeError(
      "The region specified by view is larger than byobRequest",
    );
  }
  const viewByteLength = view.byteLength;
  firstDescriptor.buffer = transferArrayBuffer(view.buffer);
  readableByteStreamControllerRespondInternal(controller, viewByteLength);
}

function readableByteStreamControllerShiftPendingPullInto(controller: ReadableByteStreamController): PullIntoDescriptor {
  assert(controller[_byobRequest] === null);
  return ArrayPrototypeShift(controller[_pendingPullIntos]);
}

function readableByteStreamControllerFillPullIntoDescriptorFromQueue(
  controller: ReadableByteStreamController,
  pullIntoDescriptor: PullIntoDescriptor,
): boolean {
  const elementSize = pullIntoDescriptor.elementSize;
  const currentAlignedBytes = pullIntoDescriptor.bytesFilled -
    (pullIntoDescriptor.bytesFilled % elementSize);
  const maxBytesToCopy = MathMin(
    controller[_queueTotalSize],
    pullIntoDescriptor.byteLength - pullIntoDescriptor.bytesFilled,
  );
  const maxBytesFilled = pullIntoDescriptor.bytesFilled + maxBytesToCopy;
  const maxAlignedBytes = maxBytesFilled - (maxBytesFilled % elementSize);
  let totalBytesToCopyRemaining = maxBytesToCopy;
  let ready = false;
  if (maxAlignedBytes > currentAlignedBytes) {
    totalBytesToCopyRemaining = maxAlignedBytes -
      pullIntoDescriptor.bytesFilled;
    ready = true;
  }
  const queue = controller[_queue];
  while (totalBytesToCopyRemaining > 0) {
    const headOfQueue = queue[0];
    const bytesToCopy = MathMin(
      totalBytesToCopyRemaining,
      headOfQueue.byteLength,
    );
    const destStart = pullIntoDescriptor.byteOffset +
      pullIntoDescriptor.bytesFilled;

    const destBuffer = new Uint8Array(
      pullIntoDescriptor.buffer,
      destStart,
      bytesToCopy,
    );
    const srcBuffer = new Uint8Array(
      headOfQueue.buffer,
      headOfQueue.byteOffset,
      bytesToCopy,
    );
    destBuffer.set(srcBuffer);

    if (headOfQueue.byteLength === bytesToCopy) {
      ArrayPrototypeShift(queue);
    } else {
      headOfQueue.byteOffset += bytesToCopy;
      headOfQueue.byteLength -= bytesToCopy;
    }
    controller[_queueTotalSize] -= bytesToCopy;
    readableByteStreamControllerFillHeadPullIntoDescriptor(
      controller,
      bytesToCopy,
      pullIntoDescriptor,
    );
    totalBytesToCopyRemaining -= bytesToCopy;
  }
  if (!ready) {
    assert(controller[_queueTotalSize] === 0);
    assert(pullIntoDescriptor.bytesFilled > 0);
    assert(pullIntoDescriptor.bytesFilled < pullIntoDescriptor.elementSize);
  }
  return ready;
}

function readableByteStreamControllerFillReadRequestFromQueue(
  controller: ReadableByteStreamController,
  readRequest: ReadRequest,
): void {
  assert(controller[_queueTotalSize] > 0);
  const entry = ArrayPrototypeShift(controller[_queue]);
  controller[_queueTotalSize] -= entry.byteLength;
  readableByteStreamControllerHandleQueueDrain(controller);
  const view = new Uint8Array(
    entry.buffer,
    entry.byteOffset,
    entry.byteLength,
  );
  readRequest.chunkSteps(view);
}

function readableByteStreamControllerFillHeadPullIntoDescriptor(
  controller: ReadableByteStreamController,
  size: number,
  pullIntoDescriptor: PullIntoDescriptor,
): void {
  assert(
    controller[_pendingPullIntos].length === 0 ||
      controller[_pendingPullIntos][0] === pullIntoDescriptor,
  );
  assert(controller[_byobRequest] === null);
  pullIntoDescriptor.bytesFilled += size;
}

function readableByteStreamControllerConvertPullIntoDescriptor(
  pullIntoDescriptor: PullIntoDescriptor,
): ArrayBufferView {
  const bytesFilled = pullIntoDescriptor.bytesFilled;
  const elementSize = pullIntoDescriptor.elementSize;
  assert(bytesFilled <= pullIntoDescriptor.byteLength);
  assert((bytesFilled % elementSize) === 0);
  const buffer = transferArrayBuffer(pullIntoDescriptor.buffer);
  return new pullIntoDescriptor.viewConstructor(
    buffer,
    pullIntoDescriptor.byteOffset,
    bytesFilled / elementSize,
  );
}

function readableStreamDefaultReaderRead<R>(reader: ReadableStreamDefaultReader<R>, readRequest: ReadRequest<R>): void {
  const stream = reader[_stream];
  assert(stream);
  stream[_disturbed] = true;
  if (stream[_state] === "closed") {
    readRequest.closeSteps();
  } else if (stream[_state] === "errored") {
    readRequest.errorSteps(stream[_storedError]);
  } else {
    assert(stream[_state] === "readable");
    stream[_controller][_pullSteps](readRequest);
  }
}

function readableStreamDefaultReaderRelease<R>(reader: ReadableStreamDefaultReader<R>) {
  readableStreamReaderGenericRelease(reader);
  const e = new TypeError("The reader was released.");
  // @ts-ignore
  readableStreamDefaultReaderErrorReadRequests(reader, e);
}

function readableStreamError<R>(stream: ReadableStream<R>, e: any) {
  assert(stream[_state] === "readable");
  stream[_state] = "errored";
  stream[_storedError] = e;
  const reader: ReadableStreamDefaultReader<R> | undefined = stream[_reader];
  if (reader === undefined) {
    return;
  }
  const closedPromise: Deferred<void> = reader[_closedPromise];
  closedPromise.reject(e);
  setPromiseIsHandledToTrue(closedPromise.promise);
  if (isReadableStreamDefaultReader(reader)) {
    // @ts-ignore
    readableStreamDefaultReaderErrorReadRequests(reader, e);
  } else {
    assert(isReadableStreamBYOBReader(reader));
    readableStreamBYOBReaderErrorReadIntoRequests(reader, e);
  }
}

function readableStreamFulfillReadIntoRequest<R>(stream: ReadableStream<R>, chunk: R, done: boolean) {
  assert(readableStreamHasBYOBReader(stream));
  const reader: ReadableStreamDefaultReader<R> = stream[_reader];
  assert(reader[_readIntoRequests].length !== 0);
  const readIntoRequest: ReadIntoRequest = ArrayPrototypeShift(reader[_readIntoRequests]);
  if (done) {
    // @ts-ignore
    readIntoRequest.closeSteps(chunk);
  } else {
    // @ts-ignore
    readIntoRequest.chunkSteps(chunk);
  }
}

function readableStreamFulfillReadRequest<R>(stream: ReadableStream<R>, chunk: R, done: boolean) {
  assert(readableStreamHasDefaultReader(stream) === true);
  const reader: ReadableStreamDefaultReader<R> = stream[_reader];
  assert(reader[_readRequests].length);
  const readRequest: ReadRequest<R> = ArrayPrototypeShift(reader[_readRequests]);
  if (done) {
    readRequest.closeSteps();
  } else {
    readRequest.chunkSteps(chunk);
  }
}

function readableStreamGetNumReadIntoRequests(stream: ReadableStream): number {
  assert(readableStreamHasBYOBReader(stream) === true);
  return stream[_reader][_readIntoRequests].length;
}

function readableStreamGetNumReadRequests(stream: ReadableStream): number {
  assert(readableStreamHasDefaultReader(stream) === true);
  return stream[_reader][_readRequests].length;
}

function readableStreamHasBYOBReader(stream: ReadableStream): boolean {
  const reader = stream[_reader];
  if (reader === undefined) {
    return false;
  }
  if (isReadableStreamBYOBReader(reader)) {
    return true;
  }
  return false;
}

function readableStreamHasDefaultReader(stream: ReadableStream): boolean {
  const reader = stream[_reader];
  if (reader === undefined) {
    return false;
  }
  if (isReadableStreamDefaultReader(reader)) {
    return true;
  }
  return false;
}

function readableStreamPipeTo<T>(
  source: ReadableStream<T>,
  dest: WritableStream<T>,
  preventClose: boolean,
  preventAbort: boolean,
  preventCancel: boolean,
  signal?: AbortSignal,
): Promise<void> {
  assert(isReadableStream(source));
  assert(isWritableStream(dest));
  assert(
    typeof preventClose === "boolean" && typeof preventAbort === "boolean" &&
      typeof preventCancel === "boolean",
  );
  assert(
    signal === undefined ||
      ObjectPrototypeIsPrototypeOf(AbortSignalPrototype, signal),
  );
  assert(!isReadableStreamLocked(source));
  assert(!isWritableStreamLocked(dest));
  // We use acquireReadableStreamDefaultReader even in case of ReadableByteStreamController
  // as the spec allows us, and the only reason to use BYOBReader is to do some smart things
  // with it, but the spec does not specify what things, so to simplify we stick to DefaultReader.
  const reader = acquireReadableStreamDefaultReader(source);
  const writer = acquireWritableStreamDefaultWriter(dest);
  source[_disturbed] = true;
  let shuttingDown = false;
  let currentWrite = resolvePromiseWith(undefined);

  const promise: Deferred<void> = new Deferred();
  let abortAlgorithm: () => void;
  if (signal) {
    abortAlgorithm = () => {
      const error = signal.reason;
      const actions: Array<() => Promise<void>> = [];
      if (preventAbort === false) {
        ArrayPrototypePush(actions, () => {
          if (dest[_state] === "writable") {
            return writableStreamAbort(dest, error);
          } else {
            return resolvePromiseWith(undefined);
          }
        });
      }
      if (preventCancel === false) {
        ArrayPrototypePush(actions, () => {
          if (source[_state] === "readable") {
            return readableStreamCancel(source, error);
          } else {
            return resolvePromiseWith(undefined);
          }
        });
      }
      shutdownWithAction(
        () =>
          // @ts-ignore
          SafePromiseAll(ArrayPrototypeMap(actions, (action) => action())),
        true,
        error,
      );
    };

    if (signal.aborted) {
      abortAlgorithm();
      return promise.promise;
    }
    signal[add](abortAlgorithm);
  }

  function pipeLoop() {
    return new Promise((resolveLoop, rejectLoop) => {
      function next(done: boolean) {
        if (done) {
          resolveLoop(undefined);
        } else {
          uponPromise(pipeStep(), next, rejectLoop);
        }
      }
      next(false);
    });
  }

  function pipeStep(): Promise<boolean> {
    if (shuttingDown === true) {
      return resolvePromiseWith(true);
    }

    return transformPromiseWith(writer[_readyPromise].promise, () => {
      return new Promise((resolveRead, rejectRead) => {
        readableStreamDefaultReaderRead(
          reader,
          {
            chunkSteps(chunk) {
              currentWrite = transformPromiseWith(
                writableStreamDefaultWriterWrite(writer, chunk),
                undefined,
                () => {},
              );
              resolveRead(false);
            },
            closeSteps() {
              resolveRead(true);
            },
            errorSteps: rejectRead,
          },
        );
      });
    });
  }

  isOrBecomesErrored(
    source,
    reader[_closedPromise].promise,
    (storedError) => {
      if (preventAbort === false) {
        shutdownWithAction(
          () => writableStreamAbort(dest, storedError),
          true,
          storedError,
        );
      } else {
        shutdown(true, storedError);
      }
    },
  );

  isOrBecomesErrored(dest, writer[_closedPromise].promise, (storedError) => {
    if (preventCancel === false) {
      shutdownWithAction(
        () => readableStreamCancel(source, storedError),
        true,
        storedError,
      );
    } else {
      shutdown(true, storedError);
    }
  });

  isOrBecomesClosed(source, reader[_closedPromise].promise, () => {
    if (preventClose === false) {
      shutdownWithAction(() =>
        writableStreamDefaultWriterCloseWithErrorPropagation(writer)
      );
    } else {
      shutdown();
    }
  });

  if (
    writableStreamCloseQueuedOrInFlight(dest) === true ||
    dest[_state] === "closed"
  ) {
    const destClosed = new TypeError(
      "The destination writable stream closed before all the data could be piped to it.",
    );
    if (preventCancel === false) {
      shutdownWithAction(
        () => readableStreamCancel(source, destClosed),
        true,
        destClosed,
      );
    } else {
      shutdown(true, destClosed);
    }
  }

  setPromiseIsHandledToTrue(pipeLoop());

  return promise.promise as Promise<void>;

  function waitForWritesToFinish(): Promise<void> {
    const oldCurrentWrite = currentWrite;
    return transformPromiseWith(
      currentWrite,
      () =>
        oldCurrentWrite !== currentWrite
          ? waitForWritesToFinish()
          : undefined,
    );
  }

  function isOrBecomesErrored(stream: ReadableStream | WritableStream, promise: Promise<any>, action: (e: any) => void) {
    if (stream[_state] === "errored") {
      action(stream[_storedError]);
    } else {
      uponRejection(promise, action);
    }
  }

  function isOrBecomesClosed(stream: ReadableStream, promise: Promise<any>, action: () => void) {
    if (stream[_state] === "closed") {
      action();
    } else {
      uponFulfillment(promise, action);
    }
  }

  function shutdownWithAction(action: () => Promise<void[] | void>, originalIsError?: boolean, originalError?: any) {
    function doTheRest() {
      uponPromise(
        action(),
        () => finalize(originalIsError, originalError),
        (newError) => finalize(true, newError),
      );
    }

    if (shuttingDown === true) {
      return;
    }
    shuttingDown = true;

    if (
      dest[_state] === "writable" &&
      writableStreamCloseQueuedOrInFlight(dest) === false
    ) {
      uponFulfillment(waitForWritesToFinish(), doTheRest);
    } else {
      doTheRest();
    }
  }

  function shutdown(isError?: boolean, error?: any) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (
      dest[_state] === "writable" &&
      writableStreamCloseQueuedOrInFlight(dest) === false
    ) {
      uponFulfillment(
        waitForWritesToFinish(),
        () => finalize(isError, error),
      );
    } else {
      finalize(isError, error);
    }
  }

  function finalize(isError?: boolean, error?: any) {
    writableStreamDefaultWriterRelease(writer);
    readableStreamDefaultReaderRelease(reader);

    if (signal !== undefined) {
      signal[remove](abortAlgorithm);
    }
    if (isError) {
      promise.reject(error);
    } else {
      promise.resolve(undefined);
    }
  }
}

function readableStreamReaderGenericCancel(reader: ReadableStreamGenericReader<any> | ReadableStreamBYOBReader, reason: any): Promise<void> {
  const stream = reader[_stream];
  assert(stream !== undefined);
  return readableStreamCancel(stream, reason);
}

function readableStreamReaderGenericInitialize<R>(reader: ReadableStreamDefaultReader<R> | ReadableStreamBYOBReader, stream: ReadableStream<R>) {
  reader[_stream] = stream;
  stream[_reader] = reader;
  if (stream[_state] === "readable") {
    reader[_closedPromise] = new Deferred();
  } else if (stream[_state] === "closed") {
    reader[_closedPromise] = new Deferred();
    reader[_closedPromise].resolve(undefined);
  } else {
    assert(stream[_state] === "errored");
    reader[_closedPromise] = new Deferred();
    reader[_closedPromise].reject(stream[_storedError]);
    setPromiseIsHandledToTrue(reader[_closedPromise].promise);
  }
}

function readableStreamReaderGenericRelease<R>(reader: ReadableStreamGenericReader<R> | ReadableStreamBYOBReader) {
  const stream = reader[_stream];
  assert(stream !== undefined);
  assert(stream[_reader] === reader);
  if (stream[_state] === "readable") {
    reader[_closedPromise].reject(
      new TypeError(
        "Reader was released and can no longer be used to monitor the stream's closedness.",
      ),
    );
  } else {
    reader[_closedPromise] = new Deferred();
    reader[_closedPromise].reject(
      new TypeError(
        "Reader was released and can no longer be used to monitor the stream's closedness.",
      ),
    );
  }
  setPromiseIsHandledToTrue(reader[_closedPromise].promise);
  stream[_controller][_releaseSteps]();
  stream[_reader] = undefined;
  reader[_stream] = undefined;
}

function readableStreamBYOBReaderErrorReadIntoRequests(reader: ReadableStreamBYOBReader, e: any) {
  const readIntoRequests = reader[_readIntoRequests];
  reader[_readIntoRequests] = [];
  for (const readIntoRequest of readIntoRequests) {
    readIntoRequest.errorSteps(e);
  }
}

function readableStreamTee<R>(stream: ReadableStream<R>, cloneForBranch2: boolean): [ReadableStream<R>, ReadableStream<R>] {
  assert(isReadableStream(stream));
  assert(typeof cloneForBranch2 === "boolean");
  if (
    ObjectPrototypeIsPrototypeOf(
      ReadableByteStreamControllerPrototype,
      stream[_controller],
    )
  ) {
    return readableByteStreamTee(stream);
  } else {
    return readableStreamDefaultTee(stream, cloneForBranch2);
  }
}

function readableStreamDefaultTee<R>(stream: ReadableStream<R>, cloneForBranch2: boolean): [ReadableStream<R>, ReadableStream<R>] {
  assert(isReadableStream(stream));
  assert(typeof cloneForBranch2 === "boolean");
  const reader = acquireReadableStreamDefaultReader(stream);
  let reading: boolean = false;
  let readAgain: boolean = false;
  let canceled1: boolean = false;
  let canceled2: boolean = false;
  let reason1: any;
  let reason2: any;
  // deno-lint-ignore prefer-const
  let branch1: ReadableStream<R>;
  // deno-lint-ignore prefer-const
  let branch2: ReadableStream<R>;

  const cancelPromise: Deferred<void> = new Deferred();

  function pullAlgorithm() {
    if (reading === true) {
      readAgain = true;
      return resolvePromiseWith(undefined);
    }
    reading = true;
    const readRequest: ReadRequest<R> = {
      chunkSteps(value) {
        queueMicrotask(() => {
          readAgain = false;
          const value1 = value;
          const value2 = value;

          // TODO(lucacasonato): respect clonedForBranch2.

          if (canceled1 === false) {
            readableStreamDefaultControllerEnqueue(
              branch1[
                _controller
              ] as ReadableStreamDefaultController<any>,
              value1,
            );
          }
          if (canceled2 === false) {
            readableStreamDefaultControllerEnqueue(
              branch2[
                _controller
              ] as ReadableStreamDefaultController<any>,
              value2,
            );
          }

          reading = false;
          // @ts-ignore
          if (readAgain === true) {
            pullAlgorithm();
          }
        });
      },
      closeSteps() {
        reading = false;
        if (canceled1 === false) {
          readableStreamDefaultControllerClose(
            branch1[
              _controller
            ] as ReadableStreamDefaultController<any>,
          );
        }
        if (canceled2 === false) {
          readableStreamDefaultControllerClose(
            branch2[
              _controller
            ] as ReadableStreamDefaultController<any>,
          );
        }
        if (canceled1 === false || canceled2 === false) {
          cancelPromise.resolve(undefined);
        }
      },
      errorSteps() {
        reading = false;
      },
    };
    readableStreamDefaultReaderRead(reader, readRequest);
    return resolvePromiseWith(undefined);
  }

  function cancel1Algorithm(reason: any): Promise<void> {
    canceled1 = true;
    reason1 = reason;
    if (canceled2 === true) {
      const compositeReason = [reason1, reason2];
      const cancelResult = readableStreamCancel(stream, compositeReason);
      cancelPromise.resolve(cancelResult);
    }
    return cancelPromise.promise;
  }

  function cancel2Algorithm(reason: any): Promise<void> {
    canceled2 = true;
    reason2 = reason;
    if (canceled1 === true) {
      const compositeReason = [reason1, reason2];
      const cancelResult = readableStreamCancel(stream, compositeReason);
      cancelPromise.resolve(cancelResult);
    }
    return cancelPromise.promise;
  }

  function startAlgorithm() {}

  branch1 = createReadableStream(
    startAlgorithm,
    pullAlgorithm,
    cancel1Algorithm,
  );
  branch2 = createReadableStream(
    startAlgorithm,
    pullAlgorithm,
    cancel2Algorithm,
  );

  uponRejection(reader[_closedPromise].promise, (r) => {
    readableStreamDefaultControllerError(
      branch1[
        _controller
      ] as ReadableStreamDefaultController<any>,
      r,
    );
    readableStreamDefaultControllerError(
      branch2[
        _controller
      ] as ReadableStreamDefaultController<any>,
      r,
    );
    if (canceled1 === false || canceled2 === false) {
      cancelPromise.resolve(undefined);
    }
  });

  return [branch1, branch2];
}

function readableByteStreamTee<R>(stream: ReadableStream<R>): [ReadableStream<R>, ReadableStream<R>] {
  assert(isReadableStream(stream));
  assert(
    ObjectPrototypeIsPrototypeOf(
      ReadableByteStreamControllerPrototype,
      stream[_controller],
    ),
  );
  let reader = acquireReadableStreamDefaultReader(stream);
  let reading = false;
  let readAgainForBranch1 = false;
  let readAgainForBranch2 = false;
  let canceled1 = false;
  let canceled2 = false;
  let reason1 = undefined;
  let reason2 = undefined;
  let branch1 = undefined;
  let branch2 = undefined;

  const cancelPromise: Deferred<void> = new Deferred();

  function forwardReaderError(thisReader: ReadableStreamBYOBReader) {
    PromisePrototypeCatch(thisReader[_closedPromise].promise, (e) => {
      if (thisReader !== reader) {
        return;
      }
      readableByteStreamControllerError(branch1[_controller], e);
      readableByteStreamControllerError(branch2[_controller], e);
      if (!canceled1 || !canceled2) {
        cancelPromise.resolve(undefined);
      }
    });
  }

  function pullWithDefaultReader() {
    if (isReadableStreamBYOBReader(reader)) {
      assert(reader[_readIntoRequests].length === 0);
      readableStreamBYOBReaderRelease(reader);
      reader = acquireReadableStreamDefaultReader(stream);
      // @ts-ignore
      forwardReaderError(reader);
    }

    const readRequest: ReadRequest = {
      chunkSteps(chunk) {
        queueMicrotask(() => {
          readAgainForBranch1 = false;
          readAgainForBranch2 = false;
          const chunk1 = chunk;
          let chunk2 = chunk;
          if (!canceled1 && !canceled2) {
            try {
              chunk2 = cloneAsUint8Array(chunk);
            } catch (e) {
              readableByteStreamControllerError(branch1[_controller], e);
              readableByteStreamControllerError(branch2[_controller], e);
              cancelPromise.resolve(readableStreamCancel(stream, e));
              return;
            }
          }
          if (!canceled1) {
            readableByteStreamControllerEnqueue(branch1[_controller], chunk1);
          }
          if (!canceled2) {
            readableByteStreamControllerEnqueue(branch2[_controller], chunk2);
          }
          reading = false;
          if (readAgainForBranch1) {
            pull1Algorithm();
          } else if (readAgainForBranch2) {
            pull2Algorithm();
          }
        });
      },
      closeSteps() {
        reading = false;
        if (!canceled1) {
          readableByteStreamControllerClose(branch1[_controller]);
        }
        if (!canceled2) {
          readableByteStreamControllerClose(branch2[_controller]);
        }
        if (branch1[_controller][_pendingPullIntos].length !== 0) {
          readableByteStreamControllerRespond(branch1[_controller], 0);
        }
        if (branch2[_controller][_pendingPullIntos].length !== 0) {
          readableByteStreamControllerRespond(branch2[_controller], 0);
        }
        if (!canceled1 || !canceled2) {
          cancelPromise.resolve(undefined);
        }
      },
      errorSteps() {
        reading = false;
      },
    };
    readableStreamDefaultReaderRead(reader, readRequest);
  }

  function pullWithBYOBReader(view, forBranch2) {
    if (isReadableStreamDefaultReader(reader)) {
      assert(reader[_readRequests].length === 0);
      readableStreamDefaultReaderRelease(reader);
      // @ts-ignore
      reader = acquireReadableStreamBYOBReader(stream);
      // @ts-ignore
      forwardReaderError(reader);
    }
    const byobBranch = forBranch2 ? branch2 : branch1;
    const otherBranch = forBranch2 ? branch1 : branch2;

    const readIntoRequest: ReadIntoRequest = {
      chunkSteps(chunk) {
        queueMicrotask(() => {
          readAgainForBranch1 = false;
          readAgainForBranch2 = false;
          const byobCanceled = forBranch2 ? canceled2 : canceled1;
          const otherCanceled = forBranch2 ? canceled1 : canceled2;
          if (!otherCanceled) {
            let clonedChunk;
            try {
              clonedChunk = cloneAsUint8Array(chunk);
            } catch (e) {
              readableByteStreamControllerError(byobBranch[_controller], e);
              readableByteStreamControllerError(otherBranch[_controller], e);
              cancelPromise.resolve(readableStreamCancel(stream, e));
              return;
            }
            if (!byobCanceled) {
              readableByteStreamControllerRespondWithNewView(
                byobBranch[_controller],
                chunk,
              );
            }
            readableByteStreamControllerEnqueue(
              otherBranch[_controller],
              clonedChunk,
            );
          } else if (!byobCanceled) {
            readableByteStreamControllerRespondWithNewView(
              byobBranch[_controller],
              chunk,
            );
          }
          reading = false;
          if (readAgainForBranch1) {
            pull1Algorithm();
          } else if (readAgainForBranch2) {
            pull2Algorithm();
          }
        });
      },
      closeSteps(chunk) {
        reading = false;
        const byobCanceled = forBranch2 ? canceled2 : canceled1;
        const otherCanceled = forBranch2 ? canceled1 : canceled2;
        if (!byobCanceled) {
          readableByteStreamControllerClose(byobBranch[_controller]);
        }
        if (!otherCanceled) {
          readableByteStreamControllerClose(otherBranch[_controller]);
        }
        if (chunk !== undefined) {
          assert(chunk.byteLength === 0);
          if (!byobCanceled) {
            readableByteStreamControllerRespondWithNewView(
              byobBranch[_controller],
              chunk,
            );
          }
          if (
            !otherCanceled &&
            otherBranch[_controller][_pendingPullIntos].length !== 0
          ) {
            readableByteStreamControllerRespond(otherBranch[_controller], 0);
          }
        }
        if (!byobCanceled || !otherCanceled) {
          cancelPromise.resolve(undefined);
        }
      },
      errorSteps() {
        reading = false;
      },
    };
    // @ts-ignore
    readableStreamBYOBReaderRead(reader, view, readIntoRequest);
  }

  function pull1Algorithm() {
    if (reading) {
      readAgainForBranch1 = true;
      return PromiseResolve(undefined);
    }
    reading = true;
    const byobRequest = readableByteStreamControllerGetBYOBRequest(
      branch1[_controller],
    );
    if (byobRequest === null) {
      pullWithDefaultReader();
    } else {
      pullWithBYOBReader(byobRequest[_view], false);
    }
    return PromiseResolve(undefined);
  }

  function pull2Algorithm() {
    if (reading) {
      readAgainForBranch2 = true;
      return PromiseResolve(undefined);
    }
    reading = true;
    const byobRequest = readableByteStreamControllerGetBYOBRequest(
      branch2[_controller],
    );
    if (byobRequest === null) {
      pullWithDefaultReader();
    } else {
      pullWithBYOBReader(byobRequest[_view], true);
    }
    return PromiseResolve(undefined);
  }

  function cancel1Algorithm(reason) {
    canceled1 = true;
    reason1 = reason;
    if (canceled2) {
      const compositeReason = [reason1, reason2];
      const cancelResult = readableStreamCancel(stream, compositeReason);
      cancelPromise.resolve(cancelResult);
    }
    return cancelPromise.promise;
  }

  function cancel2Algorithm(reason) {
    canceled2 = true;
    reason2 = reason;
    if (canceled1) {
      const compositeReason = [reason1, reason2];
      const cancelResult = readableStreamCancel(stream, compositeReason);
      cancelPromise.resolve(cancelResult);
    }
    return cancelPromise.promise;
  }

  function startAlgorithm() {
    return undefined;
  }

  branch1 = createReadableByteStream(
    startAlgorithm,
    pull1Algorithm,
    cancel1Algorithm,
  );
  branch2 = createReadableByteStream(
    startAlgorithm,
    pull2Algorithm,
    cancel2Algorithm,
  );

  branch1[_original] = stream;
  branch2[_original] = stream;
  // @ts-ignore
  forwardReaderError(reader);
  return [branch1, branch2];
}

function setUpReadableByteStreamController(
  stream: ReadableStream<ArrayBuffer>,
  controller: ReadableByteStreamController,
  startAlgorithm: () => void,
  pullAlgorithm: () => Promise<void>,
  cancelAlgorithm: (reason: any) => Promise<void>,
  highWaterMark: number,
  autoAllocateChunkSize?: number,
) {
  assert(stream[_controller] === undefined);
  if (autoAllocateChunkSize !== undefined) {
    assert(NumberIsInteger(autoAllocateChunkSize));
    assert(autoAllocateChunkSize >= 0);
  }
  controller[_stream] = stream;
  controller[_pullAgain] = controller[_pulling] = false;
  controller[_byobRequest] = null;
  resetQueue(controller);
  controller[_closeRequested] = controller[_started] = false;
  controller[_strategyHWM] = highWaterMark;
  controller[_pullAlgorithm] = pullAlgorithm;
  controller[_cancelAlgorithm] = cancelAlgorithm;
  controller[_autoAllocateChunkSize] = autoAllocateChunkSize;
  controller[_pendingPullIntos] = [];
  stream[_controller] = controller;
  const startResult = startAlgorithm();
  const startPromise = resolvePromiseWith(startResult);
  setPromiseIsHandledToTrue(
    PromisePrototypeThen(
      startPromise,
      () => {
        controller[_started] = true;
        assert(controller[_pulling] === false);
        assert(controller[_pullAgain] === false);
        readableByteStreamControllerCallPullIfNeeded(controller);
      },
      (r) => {
        readableByteStreamControllerError(controller, r);
      },
    ),
  );
}

function setUpReadableByteStreamControllerFromUnderlyingSource(
  stream: ReadableStream<ArrayBuffer>,
  underlyingSource: UnderlyingSource<ArrayBuffer>,
  underlyingSourceDict: UnderlyingSource<ArrayBuffer>,
  highWaterMark: number,
) {
  const controller = webidl.createBranded(ReadableByteStreamController);
  let startAlgorithm: () => void = () => undefined;
  let pullAlgorithm: () => Promise<void> = () => resolvePromiseWith(undefined);
  let cancelAlgorithm: (reason: any) => Promise<void> = (_reason) => resolvePromiseWith(undefined);
  if (underlyingSourceDict.start !== undefined) {
    startAlgorithm = () =>
      webidl.invokeCallbackFunction(
        underlyingSourceDict.start,
        [controller],
        underlyingSource,
        webidl.converters.any,
        {
          prefix:
            "Failed to call 'startAlgorithm' on 'ReadableByteStreamController'",
        },
      );
  }
  if (underlyingSourceDict.pull !== undefined) {
    pullAlgorithm = () =>
      webidl.invokeCallbackFunction(
        underlyingSourceDict.pull,
        [controller],
        underlyingSource,
        webidl.converters["Promise<undefined>"],
        {
          prefix:
            "Failed to call 'pullAlgorithm' on 'ReadableByteStreamController'",
          returnsPromise: true,
        },
      );
  }
  if (underlyingSourceDict.cancel !== undefined) {
    cancelAlgorithm = (reason) =>
      webidl.invokeCallbackFunction(
        underlyingSourceDict.cancel,
        [reason],
        underlyingSource,
        webidl.converters["Promise<undefined>"],
        {
          prefix:
            "Failed to call 'cancelAlgorithm' on 'ReadableByteStreamController'",
          returnsPromise: true,
        },
      );
  }
  const autoAllocateChunkSize = underlyingSourceDict["autoAllocateChunkSize"];
  if (autoAllocateChunkSize === 0) {
    throw new TypeError("autoAllocateChunkSize must be greater than 0");
  }
  setUpReadableByteStreamController(
    stream,
    controller,
    startAlgorithm,
    pullAlgorithm,
    cancelAlgorithm,
    highWaterMark,
    autoAllocateChunkSize,
  );
}

function setUpReadableStreamDefaultController<R>(
  stream: ReadableStream<R>,
  controller: ReadableStreamDefaultController<R>,
  startAlgorithm: (controller: ReadableStreamDefaultController<R>) => void | Promise<void>,
  pullAlgorithm: (controller: ReadableStreamDefaultController<R>) => Promise<void>,
  cancelAlgorithm: (reason: any) => Promise<void>,
  highWaterMark: number,
  sizeAlgorithm: (chunk: R) => number,
) {
  assert(stream[_controller] === undefined);
  controller[_stream] = stream;
  resetQueue(controller);
  controller[_started] =
    controller[_closeRequested] =
    controller[_pullAgain] =
    controller[_pulling] =
      false;
  controller[_strategySizeAlgorithm] = sizeAlgorithm;
  controller[_strategyHWM] = highWaterMark;
  controller[_pullAlgorithm] = pullAlgorithm;
  controller[_cancelAlgorithm] = cancelAlgorithm;
  stream[_controller] = controller;
  const startResult = startAlgorithm(controller);
  const startPromise = resolvePromiseWith(startResult);
  uponPromise(startPromise, () => {
    controller[_started] = true;
    assert(controller[_pulling] === false);
    assert(controller[_pullAgain] === false);
    readableStreamDefaultControllerCallPullIfNeeded(controller);
  }, (r) => {
    readableStreamDefaultControllerError(controller, r);
  });
}

function setUpReadableStreamDefaultControllerFromUnderlyingSource<R>(
  stream: ReadableStream<R>,
  underlyingSource: UnderlyingSource<R>,
  underlyingSourceDict: UnderlyingSource<R>,
  highWaterMark: number,
  sizeAlgorithm: (chunk: R) => number,
) {
  const controller = webidl.createBranded(ReadableStreamDefaultController);
  let startAlgorithm: () => Promise<void> = () => undefined;
  let pullAlgorithm: () => Promise<void> = () => resolvePromiseWith(undefined);
  let cancelAlgorithm: (reason?: any) => Promise<void> = () => resolvePromiseWith(undefined);
  if (underlyingSourceDict.start !== undefined) {
    startAlgorithm = () =>
      webidl.invokeCallbackFunction(
        underlyingSourceDict.start,
        [controller],
        underlyingSource,
        webidl.converters.any,
        {
          prefix:
            "Failed to call 'startAlgorithm' on 'ReadableStreamDefaultController'",
        },
      );
  }
  if (underlyingSourceDict.pull !== undefined) {
    pullAlgorithm = () =>
      webidl.invokeCallbackFunction(
        underlyingSourceDict.pull,
        [controller],
        underlyingSource,
        webidl.converters["Promise<undefined>"],
        {
          prefix:
            "Failed to call 'pullAlgorithm' on 'ReadableStreamDefaultController'",
          returnsPromise: true,
        },
      );
  }
  if (underlyingSourceDict.cancel !== undefined) {
    cancelAlgorithm = (reason) =>
      webidl.invokeCallbackFunction(
        underlyingSourceDict.cancel,
        [reason],
        underlyingSource,
        webidl.converters["Promise<undefined>"],
        {
          prefix:
            "Failed to call 'cancelAlgorithm' on 'ReadableStreamDefaultController'",
          returnsPromise: true,
        },
      );
  }
  setUpReadableStreamDefaultController(
    stream,
    controller,
    startAlgorithm,
    pullAlgorithm,
    cancelAlgorithm,
    highWaterMark,
    sizeAlgorithm,
  );
}

function setUpReadableStreamBYOBReader<R>(reader: ReadableStreamBYOBReader, stream: ReadableStream<R>) {
  if (isReadableStreamLocked(stream)) {
    throw new TypeError("ReadableStream is locked.");
  }
  if (
    !(ObjectPrototypeIsPrototypeOf(
      ReadableByteStreamControllerPrototype,
      stream[_controller],
    ))
  ) {
    throw new TypeError("Cannot use a BYOB reader with a non-byte stream");
  }
  readableStreamReaderGenericInitialize(reader, stream);
  reader[_readIntoRequests] = [];
}

function setUpReadableStreamDefaultReader<R>(reader: ReadableStreamDefaultReader<R>, stream: ReadableStream<R>) {
  if (isReadableStreamLocked(stream)) {
    throw new TypeError("ReadableStream is locked.");
  }
  readableStreamReaderGenericInitialize(reader, stream);
  reader[_readRequests] = [];
}

function setUpTransformStreamDefaultController<O>(
  stream: TransformStream<any, O>,
  controller: TransformStreamDefaultController<O>,
  transformAlgorithm: (chunk: O, controller: TransformStreamDefaultController<O>) => Promise<void>,
  flushAlgorithm: (controller: TransformStreamDefaultController<O>) => Promise<void>,
) {
  assert(ObjectPrototypeIsPrototypeOf(TransformStreamPrototype, stream));
  assert(stream[_controller] === undefined);
  controller[_stream] = stream;
  stream[_controller] = controller;
  controller[_transformAlgorithm] = transformAlgorithm;
  controller[_flushAlgorithm] = flushAlgorithm;
}

function setUpTransformStreamDefaultControllerFromTransformer<I, O>(
  stream: TransformStream<I, O>,
  transformer: Transformer<I, O>,
  transformerDict: Transformer<I, O>,
) {
  const controller: TransformStreamDefaultController<O> = webidl.createBranded(TransformStreamDefaultController);
  let transformAlgorithm: (chunk: O, controller: TransformStreamDefaultController<O>) => Promise<void> = (chunk) => {
    try {
      transformStreamDefaultControllerEnqueue(controller, chunk);
    } catch (e) {
      return PromiseReject(e);
    }
    return resolvePromiseWith(undefined);
  };

  let flushAlgorithm: (controller: TransformStreamDefaultController<O>) => Promise<void> = () => resolvePromiseWith(undefined);
  if (transformerDict.transform !== undefined) {
    transformAlgorithm = (chunk, controller) =>
      webidl.invokeCallbackFunction(
        transformerDict.transform,
        [chunk, controller],
        transformer,
        webidl.converters["Promise<undefined>"],
        {
          prefix:
            "Failed to call 'transformAlgorithm' on 'TransformStreamDefaultController'",
          returnsPromise: true,
        },
      );
  }
  if (transformerDict.flush !== undefined) {
    flushAlgorithm = (controller) =>
      webidl.invokeCallbackFunction(
        transformerDict.flush,
        [controller],
        transformer,
        webidl.converters["Promise<undefined>"],
        {
          prefix:
            "Failed to call 'flushAlgorithm' on 'TransformStreamDefaultController'",
          returnsPromise: true,
        },
      );
  }
  setUpTransformStreamDefaultController(
    stream,
    controller,
    transformAlgorithm,
    flushAlgorithm,
  );
}

function setUpWritableStreamDefaultController<W>(
  stream: WritableStream<W>,
  controller: WritableStreamDefaultController<W>,
  startAlgorithm: (controller: WritableStreamDefaultController<W>) => Promise<void>,
  writeAlgorithm: (chunk: W, controller: WritableStreamDefaultController<W>) => Promise<void>,
  closeAlgorithm: () => Promise<void>,
  abortAlgorithm: (reason?: any) => Promise<void>,
  highWaterMark: number,
  sizeAlgorithm: (chunk: W) => number,
) {
  assert(isWritableStream(stream));
  assert(stream[_controller] === undefined);
  controller[_stream] = stream;
  stream[_controller] = controller;
  resetQueue(controller);
  controller[_signal] = newSignal();
  controller[_started] = false;
  controller[_strategySizeAlgorithm] = sizeAlgorithm;
  controller[_strategyHWM] = highWaterMark;
  controller[_writeAlgorithm] = writeAlgorithm;
  controller[_closeAlgorithm] = closeAlgorithm;
  controller[_abortAlgorithm] = abortAlgorithm;
  const backpressure = writableStreamDefaultControllerGetBackpressure(
    controller,
  );
  writableStreamUpdateBackpressure(stream, backpressure);
  const startResult = startAlgorithm(controller);
  const startPromise = resolvePromiseWith(startResult);
  uponPromise(startPromise, () => {
    assert(stream[_state] === "writable" || stream[_state] === "erroring");
    controller[_started] = true;
    writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
  }, (r) => {
    assert(stream[_state] === "writable" || stream[_state] === "erroring");
    controller[_started] = true;
    writableStreamDealWithRejection(stream, r);
  });
}

function setUpWritableStreamDefaultControllerFromUnderlyingSink<W>(
  stream: WritableStream<W>,
  underlyingSink: UnderlyingSink<W>,
  underlyingSinkDict: UnderlyingSink<W>,
  highWaterMark: number,
  sizeAlgorithm: (chunk: W) => number,
) {
  const controller = webidl.createBranded(WritableStreamDefaultController);
  let startAlgorithm: (controller: WritableStreamDefaultController<W>) => any = () => undefined;
  let writeAlgorithm: (chunk: W, controller: WritableStreamDefaultController<W>) => Promise<void> = () => resolvePromiseWith(undefined);
  let closeAlgorithm = () => resolvePromiseWith(undefined);
  let abortAlgorithm: (reason?: any) => Promise<void> = () => resolvePromiseWith(undefined);

  if (underlyingSinkDict.start !== undefined) {
    startAlgorithm = () =>
      webidl.invokeCallbackFunction(
        underlyingSinkDict.start,
        [controller],
        underlyingSink,
        webidl.converters.any,
        {
          prefix:
            "Failed to call 'startAlgorithm' on 'WritableStreamDefaultController'",
        },
      );
  }
  if (underlyingSinkDict.write !== undefined) {
    writeAlgorithm = (chunk) =>
      webidl.invokeCallbackFunction(
        underlyingSinkDict.write,
        [chunk, controller],
        underlyingSink,
        webidl.converters["Promise<undefined>"],
        {
          prefix:
            "Failed to call 'writeAlgorithm' on 'WritableStreamDefaultController'",
          returnsPromise: true,
        },
      );
  }
  if (underlyingSinkDict.close !== undefined) {
    closeAlgorithm = () =>
      webidl.invokeCallbackFunction(
        underlyingSinkDict.close,
        [],
        underlyingSink,
        webidl.converters["Promise<undefined>"],
        {
          prefix:
            "Failed to call 'closeAlgorithm' on 'WritableStreamDefaultController'",
          returnsPromise: true,
        },
      );
  }
  if (underlyingSinkDict.abort !== undefined) {
    abortAlgorithm = (reason) =>
      webidl.invokeCallbackFunction(
        underlyingSinkDict.abort,
        [reason],
        underlyingSink,
        webidl.converters["Promise<undefined>"],
        {
          prefix:
            "Failed to call 'abortAlgorithm' on 'WritableStreamDefaultController'",
          returnsPromise: true,
        },
      );
  }
  setUpWritableStreamDefaultController(
    stream,
    controller,
    startAlgorithm,
    writeAlgorithm,
    closeAlgorithm,
    abortAlgorithm,
    highWaterMark,
    sizeAlgorithm,
  );
}

function setUpWritableStreamDefaultWriter<W>(writer: WritableStreamDefaultWriter<W>, stream: WritableStream<W>) {
  if (isWritableStreamLocked(stream) === true) {
    throw new TypeError("The stream is already locked.");
  }
  writer[_stream] = stream;
  stream[_writer] = writer;
  const state = stream[_state];
  if (state === "writable") {
    if (
      writableStreamCloseQueuedOrInFlight(stream) === false &&
      stream[_backpressure] === true
    ) {
      writer[_readyPromise] = new Deferred();
    } else {
      writer[_readyPromise] = new Deferred();
      writer[_readyPromise].resolve(undefined);
    }
    writer[_closedPromise] = new Deferred();
  } else if (state === "erroring") {
    writer[_readyPromise] = new Deferred();
    writer[_readyPromise].reject(stream[_storedError]);
    setPromiseIsHandledToTrue(writer[_readyPromise].promise);
    writer[_closedPromise] = new Deferred();
  } else if (state === "closed") {
    writer[_readyPromise] = new Deferred();
    writer[_readyPromise].resolve(undefined);
    writer[_closedPromise] = new Deferred();
    writer[_closedPromise].resolve(undefined);
  } else {
    assert(state === "errored");
    const storedError = stream[_storedError];
    writer[_readyPromise] = new Deferred();
    writer[_readyPromise].reject(storedError);
    setPromiseIsHandledToTrue(writer[_readyPromise].promise);
    writer[_closedPromise] = new Deferred();
    writer[_closedPromise].reject(storedError);
    setPromiseIsHandledToTrue(writer[_closedPromise].promise);
  }
}

function transformStreamDefaultControllerClearAlgorithms(controller: TransformStreamDefaultController) {
  controller[_transformAlgorithm] = undefined;
  controller[_flushAlgorithm] = undefined;
}

function transformStreamDefaultControllerEnqueue<O>(controller: TransformStreamDefaultController<O>, chunk: O) {
  const stream = controller[_stream];
  const readableController: ReadableStreamDefaultController<O> = stream[_readable][_controller];
  if (
    readableStreamDefaultControllerCanCloseOrEnqueue(
      readableController,
    ) === false
  ) {
    throw new TypeError("Readable stream is unavailable.");
  }
  try {
    readableStreamDefaultControllerEnqueue(
      readableController,
      chunk,
    );
  } catch (e) {
    transformStreamErrorWritableAndUnblockWrite(stream, e);
    throw stream[_readable][_storedError];
  }
  const backpressure = readableStreamDefaultcontrollerHasBackpressure(
    readableController,
  );
  if (backpressure !== stream[_backpressure]) {
    assert(backpressure === true);
    transformStreamSetBackpressure(stream, true);
  }
}

function transformStreamDefaultControllerError(controller: TransformStreamDefaultController, e?: any) {
  transformStreamError(controller[_stream], e);
}

function transformStreamDefaultControllerPerformTransform<O>(controller: TransformStreamDefaultController<O>, chunk: any): Promise<void> {
  const transformPromise = controller[_transformAlgorithm](chunk, controller);
  return transformPromiseWith(transformPromise, undefined, (r) => {
    transformStreamError(controller[_stream], r);
    throw r;
  });
}

function transformStreamDefaultControllerTerminate(controller: TransformStreamDefaultController) {
  const stream = controller[_stream];
  const readableController: ReadableStreamDefaultController = stream[_readable][_controller];
  readableStreamDefaultControllerClose(
    readableController,
  );
  const error = new TypeError("The stream has been terminated.");
  transformStreamErrorWritableAndUnblockWrite(stream, error);
}

function transformStreamDefaultSinkAbortAlgorithm(stream: TransformStream, reason?: any): Promise<void> {
  transformStreamError(stream, reason);
  return resolvePromiseWith(undefined);
}

function transformStreamDefaultSinkCloseAlgorithm<I, O>(stream: TransformStream<I, O>): Promise<void> {
  const readable = stream[_readable];
  const controller = stream[_controller];
  const flushPromise = controller[_flushAlgorithm](controller);
  transformStreamDefaultControllerClearAlgorithms(controller);
  return transformPromiseWith(flushPromise, () => {
    if (readable[_state] === "errored") {
      throw readable[_storedError];
    }
    readableStreamDefaultControllerClose(
      readable[_controller] as ReadableStreamDefaultController,
    );
  }, (r) => {
    transformStreamError(stream, r);
    throw readable[_storedError];
  });
}

function transformStreamDefaultSinkWriteAlgorithm<I, O>(stream: TransformStream<I, O>, chunk: I): Promise<void> {
  assert(stream[_writable][_state] === "writable");
  const controller = stream[_controller];
  if (stream[_backpressure] === true) {
    const backpressureChangePromise = stream[_backpressureChangePromise];
    assert(backpressureChangePromise !== undefined);
    return transformPromiseWith(backpressureChangePromise.promise, () => {
      const writable = stream[_writable];
      const state = writable[_state];
      if (state === "erroring") {
        throw writable[_storedError];
      }
      assert(state === "writable");
      return transformStreamDefaultControllerPerformTransform(
        controller,
        chunk,
      );
    });
  }
  return transformStreamDefaultControllerPerformTransform(controller, chunk);
}

function transformStreamDefaultSourcePullAlgorithm(stream: TransformStream): Promise<void> {
  assert(stream[_backpressure] === true);
  assert(stream[_backpressureChangePromise] !== undefined);
  transformStreamSetBackpressure(stream, false);
  return stream[_backpressureChangePromise].promise;
}

function transformStreamError(stream: TransformStream, e?: any) {
  readableStreamDefaultControllerError(
    stream[_readable][
      _controller
    ] as ReadableStreamDefaultController,
    e,
  );
  transformStreamErrorWritableAndUnblockWrite(stream, e);
}

function transformStreamErrorWritableAndUnblockWrite(stream: TransformStream, e?: any) {
  transformStreamDefaultControllerClearAlgorithms(stream[_controller]);
  writableStreamDefaultControllerErrorIfNeeded(
    stream[_writable][_controller],
    e,
  );
  if (stream[_backpressure] === true) {
    transformStreamSetBackpressure(stream, false);
  }
}

function transformStreamSetBackpressure(stream: TransformStream, backpressure: boolean) {
  assert(stream[_backpressure] !== backpressure);
  if (stream[_backpressureChangePromise] !== undefined) {
    stream[_backpressureChangePromise].resolve(undefined);
  }
  stream[_backpressureChangePromise] = new Deferred();
  stream[_backpressure] = backpressure;
}

function writableStreamAbort(stream: WritableStream, reason?: any): Promise<void> {
  const state = stream[_state];
  if (state === "closed" || state === "errored") {
    return resolvePromiseWith(undefined);
  }
  stream[_controller][_signal][signalAbort](reason);
  if (state === "closed" || state === "errored") {
    return resolvePromiseWith(undefined);
  }
  if (stream[_pendingAbortRequest] !== undefined) {
    return stream[_pendingAbortRequest].deferred.promise;
  }
  assert(state === "writable" || state === "erroring");
  let wasAlreadyErroring = false;
  if (state === "erroring") {
    wasAlreadyErroring = true;
    reason = undefined;
  }
  const deferred: Deferred<void> = new Deferred();
  stream[_pendingAbortRequest] = {
    deferred,
    reason,
    wasAlreadyErroring,
  };
  if (wasAlreadyErroring === false) {
    writableStreamStartErroring(stream, reason);
  }
  return deferred.promise;
}

function writableStreamAddWriteRequest(stream: WritableStream): Promise<void> {
  assert(isWritableStreamLocked(stream) === true);
  assert(stream[_state] === "writable");
  const deferred: Deferred<void> = new Deferred();
  ArrayPrototypePush(stream[_writeRequests], deferred);
  return deferred.promise;
}

export function writableStreamClose(stream: WritableStream): Promise<void> {
  const state = stream[_state];
  if (state === "closed" || state === "errored") {
    return PromiseReject(
      new TypeError("Writable stream is closed or errored."),
    );
  }
  assert(state === "writable" || state === "erroring");
  assert(writableStreamCloseQueuedOrInFlight(stream) === false);
  const deferred: Deferred<void> = new Deferred();
  stream[_closeRequest] = deferred;
  const writer = stream[_writer];
  if (
    writer !== undefined && stream[_backpressure] === true &&
    state === "writable"
  ) {
    writer[_readyPromise].resolve(undefined);
  }
  writableStreamDefaultControllerClose(stream[_controller]);
  return deferred.promise;
}

function writableStreamCloseQueuedOrInFlight(stream: WritableStream): boolean {
  if (
    stream[_closeRequest] === undefined &&
    stream[_inFlightCloseRequest] === undefined
  ) {
    return false;
  }
  return true;
}

function writableStreamDealWithRejection(stream: WritableStream, error?: any) {
  const state = stream[_state];
  if (state === "writable") {
    writableStreamStartErroring(stream, error);
    return;
  }
  assert(state === "erroring");
  writableStreamFinishErroring(stream);
}

function writableStreamDefaultControllerAdvanceQueueIfNeeded<W>(controller: WritableStreamDefaultController<W>) {
  const stream = controller[_stream];
  if (controller[_started] === false) {
    return;
  }
  if (stream[_inFlightWriteRequest] !== undefined) {
    return;
  }
  const state = stream[_state];
  assert(state !== "closed" && state !== "errored");
  if (state === "erroring") {
    writableStreamFinishErroring(stream);
    return;
  }
  if (controller[_queue].length === 0) {
    return;
  }
  const value = peekQueueValue(controller);
  if (value === _close) {
    writableStreamDefaultControllerProcessClose(controller);
  } else {
    writableStreamDefaultControllerProcessWrite(controller, value);
  }
}

function writableStreamDefaultControllerClearAlgorithms(controller) {
  controller[_writeAlgorithm] = undefined;
  controller[_closeAlgorithm] = undefined;
  controller[_abortAlgorithm] = undefined;
  controller[_strategySizeAlgorithm] = undefined;
}

function writableStreamDefaultControllerClose(controller: WritableStreamDefaultController) {
  enqueueValueWithSize(controller, _close, 0);
  writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
}

function writableStreamDefaultControllerError(controller: WritableStreamDefaultController, error: any) {
  const stream = controller[_stream];
  assert(stream[_state] === "writable");
  writableStreamDefaultControllerClearAlgorithms(controller);
  writableStreamStartErroring(stream, error);
}

function writableStreamDefaultControllerErrorIfNeeded(controller: WritableStreamDefaultController, error: any) {
  if (controller[_stream][_state] === "writable") {
    writableStreamDefaultControllerError(controller, error);
  }
}

function writableStreamDefaultControllerGetBackpressure(controller: WritableStreamDefaultController): boolean {
  const desiredSize = writableStreamDefaultControllerGetDesiredSize(
    controller,
  );
  return desiredSize <= 0;
}

function writableStreamDefaultControllerGetChunkSize<W>(controller: WritableStreamDefaultController<W>, chunk: W): number {
  let value;
  try {
    value = controller[_strategySizeAlgorithm](chunk);
  } catch (e) {
    writableStreamDefaultControllerErrorIfNeeded(controller, e);
    return 1;
  }
  return value;
}

function writableStreamDefaultControllerGetDesiredSize(controller: WritableStreamDefaultController): number {
  return controller[_strategyHWM] - controller[_queueTotalSize];
}

function writableStreamDefaultControllerProcessClose(controller: WritableStreamDefaultController) {
  const stream = controller[_stream];
  writableStreamMarkCloseRequestInFlight(stream);
  dequeueValue(controller);
  assert(controller[_queue].length === 0);
  const sinkClosePromise = controller[_closeAlgorithm]();
  writableStreamDefaultControllerClearAlgorithms(controller);
  uponPromise(sinkClosePromise, () => {
    writableStreamFinishInFlightClose(stream);
  }, (reason) => {
    writableStreamFinishInFlightCloseWithError(stream, reason);
  });
}

function writableStreamDefaultControllerProcessWrite<W>(controller: WritableStreamDefaultController<W>, chunk: W) {
  const stream = controller[_stream];
  writableStreamMarkFirstWriteRequestInFlight(stream);
  const sinkWritePromise = controller[_writeAlgorithm](chunk, controller);
  uponPromise(sinkWritePromise, () => {
    writableStreamFinishInFlightWrite(stream);
    const state = stream[_state];
    assert(state === "writable" || state === "erroring");
    dequeueValue(controller);
    if (
      writableStreamCloseQueuedOrInFlight(stream) === false &&
      state === "writable"
    ) {
      const backpressure = writableStreamDefaultControllerGetBackpressure(
        controller,
      );
      writableStreamUpdateBackpressure(stream, backpressure);
    }
    writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
  }, (reason) => {
    if (stream[_state] === "writable") {
      writableStreamDefaultControllerClearAlgorithms(controller);
    }
    writableStreamFinishInFlightWriteWithError(stream, reason);
  });
}

function writableStreamDefaultControllerWrite<W>(controller: WritableStreamDefaultController<W>, chunk: W, chunkSize: number) {
  try {
    enqueueValueWithSize(controller, chunk, chunkSize);
  } catch (e) {
    writableStreamDefaultControllerErrorIfNeeded(controller, e);
    return;
  }
  const stream = controller[_stream];
  if (
    writableStreamCloseQueuedOrInFlight(stream) === false &&
    stream[_state] === "writable"
  ) {
    const backpressure = writableStreamDefaultControllerGetBackpressure(
      controller,
    );
    writableStreamUpdateBackpressure(stream, backpressure);
  }
  writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
}

function writableStreamDefaultWriterAbort(writer: WritableStreamDefaultWriter, reason?: any): Promise<void> {
  const stream = writer[_stream];
  assert(stream !== undefined);
  return writableStreamAbort(stream, reason);
}

function writableStreamDefaultWriterClose(writer: WritableStreamDefaultWriter): Promise<void> {
  const stream = writer[_stream];
  assert(stream !== undefined);
  return writableStreamClose(stream);
}

function writableStreamDefaultWriterCloseWithErrorPropagation(writer: WritableStreamDefaultWriter): Promise<void> {
  const stream = writer[_stream];
  assert(stream !== undefined);
  const state = stream[_state];
  if (
    writableStreamCloseQueuedOrInFlight(stream) === true || state === "closed"
  ) {
    return resolvePromiseWith(undefined);
  }
  if (state === "errored") {
    return PromiseReject(stream[_storedError]);
  }
  assert(state === "writable" || state === "erroring");
  return writableStreamDefaultWriterClose(writer);
}

function writableStreamDefaultWriterEnsureClosedPromiseRejected(
  writer: WritableStreamDefaultWriter,
  error?: any,
) {
  if (writer[_closedPromise].state === "pending") {
    writer[_closedPromise].reject(error);
  } else {
    writer[_closedPromise] = new Deferred();
    writer[_closedPromise].reject(error);
  }
  setPromiseIsHandledToTrue(writer[_closedPromise].promise);
}

function writableStreamDefaultWriterEnsureReadyPromiseRejected(
  writer: WritableStreamDefaultWriter,
  error?: any,
) {
  if (writer[_readyPromise].state === "pending") {
    writer[_readyPromise].reject(error);
  } else {
    writer[_readyPromise] = new Deferred();
    writer[_readyPromise].reject(error);
  }
  setPromiseIsHandledToTrue(writer[_readyPromise].promise);
}

function writableStreamDefaultWriterGetDesiredSize(writer: WritableStreamDefaultWriter): number | null {
  const stream = writer[_stream];
  const state = stream[_state];
  if (state === "errored" || state === "erroring") {
    return null;
  }
  if (state === "closed") {
    return 0;
  }
  return writableStreamDefaultControllerGetDesiredSize(stream[_controller]);
}

function writableStreamDefaultWriterRelease(writer: WritableStreamDefaultWriter) {
  const stream = writer[_stream];
  assert(stream !== undefined);
  assert(stream[_writer] === writer);
  const releasedError = new TypeError(
    "The writer has already been released.",
  );
  writableStreamDefaultWriterEnsureReadyPromiseRejected(
    writer,
    releasedError,
  );
  writableStreamDefaultWriterEnsureClosedPromiseRejected(
    writer,
    releasedError,
  );
  stream[_writer] = undefined;
  writer[_stream] = undefined;
}

function writableStreamDefaultWriterWrite<W>(writer: WritableStreamDefaultWriter<W>, chunk: W): Promise<void> {
  const stream = writer[_stream];
  assert(stream !== undefined);
  const controller = stream[_controller];
  const chunkSize = writableStreamDefaultControllerGetChunkSize(
    controller,
    chunk,
  );
  if (stream !== writer[_stream]) {
    return PromiseReject(new TypeError("Writer's stream is unexpected."));
  }
  const state = stream[_state];
  if (state === "errored") {
    return PromiseReject(stream[_storedError]);
  }
  if (
    writableStreamCloseQueuedOrInFlight(stream) === true || state === "closed"
  ) {
    return PromiseReject(
      new TypeError("The stream is closing or is closed."),
    );
  }
  if (state === "erroring") {
    return PromiseReject(stream[_storedError]);
  }
  assert(state === "writable");
  const promise = writableStreamAddWriteRequest(stream);
  writableStreamDefaultControllerWrite(controller, chunk, chunkSize);
  return promise;
}

function writableStreamFinishErroring(stream: WritableStream) {
  assert(stream[_state] === "erroring");
  assert(writableStreamHasOperationMarkedInFlight(stream) === false);
  stream[_state] = "errored";
  stream[_controller][_errorSteps]();
  const storedError = stream[_storedError];
  for (const writeRequest of stream[_writeRequests]) {
    writeRequest.reject(storedError);
  }
  stream[_writeRequests] = [];
  if (stream[_pendingAbortRequest] === undefined) {
    writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
    return;
  }
  const abortRequest = stream[_pendingAbortRequest];
  stream[_pendingAbortRequest] = undefined;
  if (abortRequest.wasAlreadyErroring === true) {
    abortRequest.deferred.reject(storedError);
    writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
    return;
  }
  const promise = stream[_controller][_abortSteps](abortRequest.reason);
  uponPromise(promise, () => {
    abortRequest.deferred.resolve(undefined);
    writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
  }, (reason) => {
    abortRequest.deferred.reject(reason);
    writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
  });
}

function writableStreamFinishInFlightClose(stream: WritableStream) {
  assert(stream[_inFlightCloseRequest] !== undefined);
  stream[_inFlightCloseRequest].resolve(undefined);
  stream[_inFlightCloseRequest] = undefined;
  const state = stream[_state];
  assert(state === "writable" || state === "erroring");
  if (state === "erroring") {
    stream[_storedError] = undefined;
    if (stream[_pendingAbortRequest] !== undefined) {
      stream[_pendingAbortRequest].deferred.resolve(undefined);
      stream[_pendingAbortRequest] = undefined;
    }
  }
  stream[_state] = "closed";
  const writer = stream[_writer];
  if (writer !== undefined) {
    writer[_closedPromise].resolve(undefined);
  }
  assert(stream[_pendingAbortRequest] === undefined);
  assert(stream[_storedError] === undefined);
}

function writableStreamFinishInFlightCloseWithError(stream: WritableStream, error?: any) {
  assert(stream[_inFlightCloseRequest] !== undefined);
  stream[_inFlightCloseRequest].reject(error);
  stream[_inFlightCloseRequest] = undefined;
  assert(stream[_state] === "writable" || stream[_state] === "erroring");
  if (stream[_pendingAbortRequest] !== undefined) {
    stream[_pendingAbortRequest].deferred.reject(error);
    stream[_pendingAbortRequest] = undefined;
  }
  writableStreamDealWithRejection(stream, error);
}

function writableStreamFinishInFlightWrite(stream: WritableStream) {
  assert(stream[_inFlightWriteRequest] !== undefined);
  stream[_inFlightWriteRequest].resolve(undefined);
  stream[_inFlightWriteRequest] = undefined;
}

function writableStreamFinishInFlightWriteWithError(stream: WritableStream, error?: any) {
  assert(stream[_inFlightWriteRequest] !== undefined);
  stream[_inFlightWriteRequest].reject(error);
  stream[_inFlightWriteRequest] = undefined;
  assert(stream[_state] === "writable" || stream[_state] === "erroring");
  writableStreamDealWithRejection(stream, error);
}

function writableStreamHasOperationMarkedInFlight(stream: WritableStream): boolean {
  if (
    stream[_inFlightWriteRequest] === undefined &&
    stream[_inFlightCloseRequest] === undefined
  ) {
    return false;
  }
  return true;
}

function writableStreamMarkCloseRequestInFlight(stream: WritableStream) {
  assert(stream[_inFlightCloseRequest] === undefined);
  assert(stream[_closeRequest] !== undefined);
  stream[_inFlightCloseRequest] = stream[_closeRequest];
  stream[_closeRequest] = undefined;
}

function writableStreamMarkFirstWriteRequestInFlight<W>(stream: WritableStream<W>) {
  assert(stream[_inFlightWriteRequest] === undefined);
  assert(stream[_writeRequests].length);
  const writeRequest = stream[_writeRequests].shift();
  stream[_inFlightWriteRequest] = writeRequest;
}

function writableStreamRejectCloseAndClosedPromiseIfNeeded(stream: WritableStream) {
  assert(stream[_state] === "errored");
  if (stream[_closeRequest] !== undefined) {
    assert(stream[_inFlightCloseRequest] === undefined);
    stream[_closeRequest].reject(stream[_storedError]);
    stream[_closeRequest] = undefined;
  }
  const writer = stream[_writer];
  if (writer !== undefined) {
    writer[_closedPromise].reject(stream[_storedError]);
    setPromiseIsHandledToTrue(writer[_closedPromise].promise);
  }
}

function writableStreamStartErroring(stream: WritableStream, reason?: any) {
  assert(stream[_storedError] === undefined);
  assert(stream[_state] === "writable");
  const controller = stream[_controller];
  assert(controller !== undefined);
  stream[_state] = "erroring";
  stream[_storedError] = reason;
  const writer = stream[_writer];
  if (writer !== undefined) {
    writableStreamDefaultWriterEnsureReadyPromiseRejected(writer, reason);
  }
  if (
    writableStreamHasOperationMarkedInFlight(stream) === false &&
    controller[_started] === true
  ) {
    writableStreamFinishErroring(stream);
  }
}

function writableStreamUpdateBackpressure(stream: WritableStream, backpressure: boolean) {
  assert(stream[_state] === "writable");
  assert(writableStreamCloseQueuedOrInFlight(stream) === false);
  const writer = stream[_writer];
  if (writer !== undefined && backpressure !== stream[_backpressure]) {
    if (backpressure === true) {
      writer[_readyPromise] = new Deferred();
    } else {
      assert(backpressure === false);
      writer[_readyPromise].resolve(undefined);
    }
  }
  stream[_backpressure] = backpressure;
}

export function createIteratorResult<T>(value: T, done: boolean): IteratorResult<T> {
  const result = ObjectCreate(null);
  ObjectDefineProperties(result, {
    value: { value, writable: true, enumerable: true, configurable: true },
    done: {
      value: done,
      writable: true,
      enumerable: true,
      configurable: true,
    },
  });
  return result;
}

const asyncIteratorPrototype: AsyncIterator<unknown, unknown> = ObjectGetPrototypeOf(
  ObjectGetPrototypeOf(async function* () {}).prototype,
);

const readableStreamAsyncIteratorPrototype: AsyncIterator<unknown> = ObjectSetPrototypeOf({

  next(): Promise<IteratorResult<unknown>> {
    const reader: ReadableStreamDefaultReader = this[_reader];
    if (reader[_stream] === undefined) {
      return PromiseReject(
        new TypeError(
          "Cannot get the next iteration result once the reader has been released.",
        ),
      );
    }

    const promise: Deferred<IteratorResult<any>> = new Deferred();

    const readRequest: ReadRequest = {
      chunkSteps(chunk) {
        promise.resolve(createIteratorResult(chunk, false));
      },
      closeSteps() {
        readableStreamDefaultReaderRelease(reader);
        promise.resolve(createIteratorResult(undefined, true));
      },
      errorSteps(e) {
        readableStreamDefaultReaderRelease(reader);
        promise.reject(e);
      },
    };
    readableStreamDefaultReaderRead(reader, readRequest);
    return promise.promise;
  },

  async return(arg: unknown): Promise<IteratorResult<unknown>> {
    const reader: ReadableStreamDefaultReader = this[_reader];
    if (reader[_stream] === undefined) {
      return createIteratorResult(undefined, true);
    }
    assert(reader[_readRequests].length === 0);
    if (this[_preventCancel] === false) {
      const result = readableStreamReaderGenericCancel(reader, arg);
      readableStreamDefaultReaderRelease(reader);
      await result;
      return createIteratorResult(arg, true);
    }
    readableStreamDefaultReaderRelease(reader);
    return createIteratorResult(undefined, true);
  },
}, asyncIteratorPrototype);

export class ByteLengthQueuingStrategy {
  constructor(init: { highWaterMark: number }) {
    const prefix = "Failed to construct 'ByteLengthQueuingStrategy'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    init = webidl.converters.QueuingStrategyInit(init, {
      prefix,
      context: "Argument 1",
    });
    this[webidl.brand] = webidl.brand;
    this[_globalObject] = window;
    this[_highWaterMark] = init.highWaterMark;
  }

  get highWaterMark(): number {
    webidl.assertBranded(this, ByteLengthQueuingStrategyPrototype);
    return this[_highWaterMark];
  }

  get size(): (chunk: ArrayBufferView) => number {
    webidl.assertBranded(this, ByteLengthQueuingStrategyPrototype);
    initializeByteLengthSizeFunction(this[_globalObject]);
    return WeakMapPrototypeGet(byteSizeFunctionWeakMap, this[_globalObject]);
  }

  [SymbolFor("Deno.customInspect")](inspect) {
    return inspect(consoleInternal.createFilteredInspectProxy({
      object: this,
      evaluate: ObjectPrototypeIsPrototypeOf(
        ByteLengthQueuingStrategyPrototype,
        this,
      ),
      keys: [
        "highWaterMark",
        "size",
      ],
    }));
  }
}

webidl.configurePrototype(ByteLengthQueuingStrategy);
const ByteLengthQueuingStrategyPrototype =
  ByteLengthQueuingStrategy.prototype;

const byteSizeFunctionWeakMap: WeakMap<typeof globalThis, (chunk: ArrayBufferView) => number> = new WeakMap();

function initializeByteLengthSizeFunction(globalObject) {
  if (WeakMapPrototypeHas(byteSizeFunctionWeakMap, globalObject)) {
    return;
  }
  const size = (chunk) => chunk.byteLength;
  WeakMapPrototypeSet(byteSizeFunctionWeakMap, globalObject, size);
}

export class CountQueuingStrategy {
  constructor(init: { highWaterMark: number }) {
    const prefix = "Failed to construct 'CountQueuingStrategy'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    init = webidl.converters.QueuingStrategyInit(init, {
      prefix,
      context: "Argument 1",
    });
    this[webidl.brand] = webidl.brand;
    this[_globalObject] = window;
    this[_highWaterMark] = init.highWaterMark;
  }

  get highWaterMark(): number {
    webidl.assertBranded(this, CountQueuingStrategyPrototype);
    return this[_highWaterMark];
  }

  get size(): (chunk: any) => 1 {
    webidl.assertBranded(this, CountQueuingStrategyPrototype);
    initializeCountSizeFunction(this[_globalObject]);
    return WeakMapPrototypeGet(countSizeFunctionWeakMap, this[_globalObject]);
  }

  [SymbolFor("Deno.customInspect")](inspect) {
    return inspect(consoleInternal.createFilteredInspectProxy({
      object: this,
      evaluate: ObjectPrototypeIsPrototypeOf(
        CountQueuingStrategyPrototype,
        this,
      ),
      keys: [
        "highWaterMark",
        "size",
      ],
    }));
  }
}

webidl.configurePrototype(CountQueuingStrategy);
const CountQueuingStrategyPrototype = CountQueuingStrategy.prototype;

const countSizeFunctionWeakMap: WeakMap<typeof globalThis, () => 1> = new WeakMap();

function initializeCountSizeFunction(globalObject: typeof globalThis) {
  if (WeakMapPrototypeHas(countSizeFunctionWeakMap, globalObject)) {
    return;
  }
  const size = () => 1;
  WeakMapPrototypeSet(countSizeFunctionWeakMap, globalObject, size);
}

const _resourceBacking = Symbol("[[resourceBacking]]");
export class ReadableStream<R = any> {
  // @ts-ignore
  [_controller]: ReadableStreamDefaultController | ReadableByteStreamController;
  // @ts-ignore
  [_detached]: boolean;
  // @ts-ignore
  [_disturbed]: boolean;
  // @ts-ignore
  [_reader]: ReadableStreamDefaultReader<R> | ReadableStreamBYOBReader<R>;
  // @ts-ignore
  [_state]: "readable" | "closed" | "errored";
  // @ts-ignore
  [_storedError]: any;
  // @ts-ignore
  [_resourceBacking]: { rid: number, autoClose: boolean } | null = null;

  constructor(underlyingSource: UnderlyingSource<R> = undefined, strategy: QueuingStrategy<R> = undefined) {
    const prefix = "Failed to construct 'ReadableStream'";
    if (underlyingSource !== undefined) {
      underlyingSource = webidl.converters.object(underlyingSource, {
        prefix,
        context: "Argument 1",
      });
    } else {
      underlyingSource = null;
    }
    if (strategy !== undefined) {
      strategy = webidl.converters.QueuingStrategy(strategy, {
        prefix,
        context: "Argument 2",
      });
    } else {
      strategy = {};
    }
    this[webidl.brand] = webidl.brand;
    let underlyingSourceDict: any = {};
    if (underlyingSource !== undefined) {
      underlyingSourceDict = webidl.converters.UnderlyingSource(
        underlyingSource,
        { prefix, context: "underlyingSource" },
      );
    }
    initializeReadableStream(this);
    if (underlyingSourceDict.type === "bytes") {
      if (strategy.size !== undefined) {
        throw new RangeError(
          `${prefix}: When underlying source is "bytes", strategy.size must be undefined.`,
        );
      }
      const highWaterMark = extractHighWaterMark(strategy, 0);
      setUpReadableByteStreamControllerFromUnderlyingSource(
        // @ts-ignore cannot easily assert this is ReadableStream<ArrayBuffer>
        this,
        underlyingSource,
        underlyingSourceDict,
        highWaterMark,
      );
    } else {
      assert(!(ReflectHas(underlyingSourceDict, "type")));
      const sizeAlgorithm = extractSizeAlgorithm(strategy);
      const highWaterMark = extractHighWaterMark(strategy, 1);
      setUpReadableStreamDefaultControllerFromUnderlyingSource(
        this,
        underlyingSource,
        underlyingSourceDict,
        highWaterMark,
        sizeAlgorithm,
      );
    }
  }

  get locked(): boolean {
    webidl.assertBranded(this, ReadableStreamPrototype);
    return isReadableStreamLocked(this);
  }

  cancel(reason: any = undefined): Promise<void> {
    try {
      webidl.assertBranded(this, ReadableStreamPrototype);
      if (reason !== undefined) {
        reason = webidl.converters.any(reason);
      }
    } catch (err) {
      return PromiseReject(err);
    }
    if (isReadableStreamLocked(this)) {
      return PromiseReject(
        new TypeError("Cannot cancel a locked ReadableStream."),
      );
    }
    return readableStreamCancel(this, reason);
  }

  getReader(options: ReadableStreamGetReaderOptions = undefined): ReadableStreamDefaultReader<R> | ReadableStreamBYOBReader {
    webidl.assertBranded(this, ReadableStreamPrototype);
    const prefix = "Failed to execute 'getReader' on 'ReadableStream'";
    if (options !== undefined) {
      options = webidl.converters.ReadableStreamGetReaderOptions(options, {
        prefix,
        context: "Argument 1",
      });
    } else {
      options = {};
    }
    if (options.mode === undefined) {
      return acquireReadableStreamDefaultReader(this);
    } else {
      assert(options.mode === "byob");
      return acquireReadableStreamBYOBReader(this);
    }
  }

  pipeThrough<T>(transform: { readable: ReadableStream<T>, writable: WritableStream<R> }, options: PipeOptions = {}): ReadableStream<T> {
    webidl.assertBranded(this, ReadableStreamPrototype);
    const prefix = "Failed to execute 'pipeThrough' on 'ReadableStream'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    transform = webidl.converters.ReadableWritablePair(transform, {
      prefix,
      context: "Argument 1",
    });
    options = webidl.converters.StreamPipeOptions(options, {
      prefix,
      context: "Argument 2",
    });
    const { readable, writable } = transform;
    const { preventClose, preventAbort, preventCancel, signal } = options;
    if (isReadableStreamLocked(this)) {
      throw new TypeError("ReadableStream is already locked.");
    }
    if (isWritableStreamLocked(writable)) {
      throw new TypeError("Target WritableStream is already locked.");
    }
    const promise = readableStreamPipeTo(
      this,
      writable,
      preventClose,
      preventAbort,
      preventCancel,
      signal,
    );
    setPromiseIsHandledToTrue(promise);
    return readable;
  }

  pipeTo(destination: WritableStream<R>, options: PipeOptions = {}): Promise<void> {
    try {
      webidl.assertBranded(this, ReadableStreamPrototype);
      const prefix = "Failed to execute 'pipeTo' on 'ReadableStream'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      destination = webidl.converters.WritableStream(destination, {
        prefix,
        context: "Argument 1",
      });
      options = webidl.converters.StreamPipeOptions(options, {
        prefix,
        context: "Argument 2",
      });
    } catch (err) {
      return PromiseReject(err);
    }
    const { preventClose, preventAbort, preventCancel, signal } = options;
    if (isReadableStreamLocked(this)) {
      return PromiseReject(
        new TypeError("ReadableStream is already locked."),
      );
    }
    if (isWritableStreamLocked(destination)) {
      return PromiseReject(
        new TypeError("destination WritableStream is already locked."),
      );
    }
    return readableStreamPipeTo(
      this,
      destination,
      preventClose,
      preventAbort,
      preventCancel,
      signal,
    ) as Promise<void>;
  }

  tee(): [ReadableStream<R>, ReadableStream<R>] {
    webidl.assertBranded(this, ReadableStreamPrototype);
    return readableStreamTee(this, false);
  }

  // TODO(lucacasonato): should be moved to webidl crate
  values(options: ReadableStreamIteratorOptions = {}): AsyncIterableIterator<R> {
    webidl.assertBranded(this, ReadableStreamPrototype);
    const prefix = "Failed to execute 'values' on 'ReadableStream'";
    options = webidl.converters.ReadableStreamIteratorOptions(options, {
      prefix,
      context: "Argument 1",
    });

    const iterator: AsyncIterableIterator<R> = ObjectCreate(readableStreamAsyncIteratorPrototype);
    const reader = acquireReadableStreamDefaultReader(this);
    iterator[_reader] = reader;
    iterator[_preventCancel] = options.preventCancel;
    return iterator;
  }

  [SymbolFor("Deno.privateCustomInspect")](inspect) {
    return `${this.constructor.name} ${inspect({ locked: this.locked })}`;
  }
}

// TODO(lucacasonato): should be moved to webidl crate
ReadableStream.prototype[SymbolAsyncIterator] =
  ReadableStream.prototype.values;
ObjectDefineProperty(ReadableStream.prototype, SymbolAsyncIterator, {
  writable: true,
  enumerable: false,
  configurable: true,
});

webidl.configurePrototype(ReadableStream);
export const ReadableStreamPrototype = ReadableStream.prototype;

export function errorReadableStream(stream, e) {
  readableStreamDefaultControllerError(stream[_controller], e);
}
export class ReadableStreamDefaultReader<R = any> {
  // @ts-ignore
  [_closedPromise]: Deferred<void>;
  // @ts-ignore
  [_stream]: ReadableStream<R> | undefined;
  // @ts-ignore
  [_readRequests]: ReadRequest[];

  constructor(stream: ReadableStream<R>) {
    const prefix = "Failed to construct 'ReadableStreamDefaultReader'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    stream = webidl.converters.ReadableStream(stream, {
      prefix,
      context: "Argument 1",
    });
    this[webidl.brand] = webidl.brand;
    setUpReadableStreamDefaultReader(this, stream);
  }

  read(): Promise<ReadableStreamReadResult<R>> {
    try {
      webidl.assertBranded(this, ReadableStreamDefaultReaderPrototype);
    } catch (err) {
      return PromiseReject(err);
    }
    if (this[_stream] === undefined) {
      return PromiseReject(
        new TypeError("Reader has no associated stream."),
      );
    }

    const promise: Deferred<ReadableStreamReadResult<R>> = new Deferred();

    const readRequest: ReadRequest<R> = {
      chunkSteps(chunk) {
        promise.resolve({ value: chunk, done: false });
      },
      closeSteps() {
        promise.resolve({ value: undefined, done: true });
      },
      errorSteps(e) {
        promise.reject(e);
      },
    };
    readableStreamDefaultReaderRead(this, readRequest);
    return promise.promise;
  }

  releaseLock(): void {
    webidl.assertBranded(this, ReadableStreamDefaultReaderPrototype);
    if (this[_stream] === undefined) {
      return;
    }
    readableStreamDefaultReaderRelease(this);
  }

  get closed() {
    try {
      webidl.assertBranded(this, ReadableStreamDefaultReaderPrototype);
    } catch (err) {
      return PromiseReject(err);
    }
    return this[_closedPromise].promise;
  }

  cancel(reason: any = undefined): Promise<void> {
    try {
      webidl.assertBranded(this, ReadableStreamDefaultReaderPrototype);
      if (reason !== undefined) {
        reason = webidl.converters.any(reason);
      }
    } catch (err) {
      return PromiseReject(err);
    }

    if (this[_stream] === undefined) {
      return PromiseReject(
        new TypeError("Reader has no associated stream."),
      );
    }
    return readableStreamReaderGenericCancel(this, reason);
  }

  [SymbolFor("Deno.privateCustomInspect")](inspect) {
    return `${this.constructor.name} ${inspect({ closed: this.closed })}`;
  }
}

webidl.configurePrototype(ReadableStreamDefaultReader);
const ReadableStreamDefaultReaderPrototype =
  ReadableStreamDefaultReader.prototype;

export class ReadableStreamBYOBReader<R = any> {
  // @ts-ignore
  [_closedPromise]: Deferred<void>;
  // @ts-ignore
  [_stream]: ReadableStream<R> | undefined;
  // @ts-ignore
  [_readIntoRequests]: ReadIntoRequest[];

  constructor(stream: ReadableStream<R>) {
    const prefix = "Failed to construct 'ReadableStreamBYOBReader'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    stream = webidl.converters.ReadableStream(stream, {
      prefix,
      context: "Argument 1",
    });
    this[webidl.brand] = webidl.brand;
    setUpReadableStreamBYOBReader(this, stream);
  }

  read(view: ArrayBufferView): Promise<ReadableStreamBYOBReadResult<ArrayBufferView>> {
    try {
      webidl.assertBranded(this, ReadableStreamBYOBReaderPrototype);
      const prefix = "Failed to execute 'read' on 'ReadableStreamBYOBReader'";
      view = webidl.converters.ArrayBufferView(view, {
        prefix,
        context: "Argument 1",
      });
    } catch (err) {
      return PromiseReject(err);
    }

    if (view.byteLength === 0) {
      return PromiseReject(
        new TypeError("view must have non-zero byteLength"),
      );
    }
    if (view.buffer.byteLength === 0) {
      return PromiseReject(
        new TypeError("view's buffer must have non-zero byteLength"),
      );
    }
    if (isDetachedBuffer(view.buffer)) {
      return PromiseReject(
        new TypeError("view's buffer has been detached"),
      );
    }
    if (this[_stream] === undefined) {
      return PromiseReject(
        new TypeError("Reader has no associated stream."),
      );
    }
    const promise: Deferred<ReadableStreamBYOBReadResult<ArrayBufferView>> = new Deferred();

    const readIntoRequest: ReadIntoRequest = {
      chunkSteps(chunk) {
        promise.resolve({ value: chunk, done: false });
      },
      closeSteps(chunk) {
        promise.resolve({ value: chunk, done: true });
      },
      errorSteps(e) {
        promise.reject(e);
      },
    };
    readableStreamBYOBReaderRead(this, view, readIntoRequest);
    return promise.promise;
  }

  releaseLock(): void {
    webidl.assertBranded(this, ReadableStreamBYOBReaderPrototype);
    if (this[_stream] === undefined) {
      return;
    }
    readableStreamBYOBReaderRelease(this);
  }

  get closed() {
    try {
      webidl.assertBranded(this, ReadableStreamBYOBReaderPrototype);
    } catch (err) {
      return PromiseReject(err);
    }
    return this[_closedPromise].promise;
  }

  cancel(reason: any = undefined): Promise<void> {
    try {
      webidl.assertBranded(this, ReadableStreamBYOBReaderPrototype);
      if (reason !== undefined) {
        reason = webidl.converters.any(reason);
      }
    } catch (err) {
      return PromiseReject(err);
    }

    if (this[_stream] === undefined) {
      return PromiseReject(
        new TypeError("Reader has no associated stream."),
      );
    }
    return readableStreamReaderGenericCancel(this, reason);
  }

  [SymbolFor("Deno.privateCustomInspect")](inspect) {
    return `${this.constructor.name} ${inspect({ closed: this.closed })}`;
  }
}

webidl.configurePrototype(ReadableStreamBYOBReader);
const ReadableStreamBYOBReaderPrototype = ReadableStreamBYOBReader.prototype;

export class ReadableStreamBYOBRequest {
  // @ts-ignore
  [_controller]: ReadableByteStreamController;
  // @ts-ignore
  [_view]: ArrayBufferView | null;

  get view(): ArrayBufferView | null {
    webidl.assertBranded(this, ReadableStreamBYOBRequestPrototype);
    return this[_view];
  }

  constructor() {
    webidl.illegalConstructor();
  }

  respond(bytesWritten) {
    webidl.assertBranded(this, ReadableStreamBYOBRequestPrototype);
    const prefix =
      "Failed to execute 'respond' on 'ReadableStreamBYOBRequest'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    bytesWritten = webidl.converters["unsigned long long"](bytesWritten, {
      enforceRange: true,
      prefix,
      context: "Argument 1",
    });

    if (this[_controller] === undefined) {
      throw new TypeError("This BYOB request has been invalidated");
    }
    if (isDetachedBuffer(this[_view].buffer)) {
      throw new TypeError(
        "The BYOB request's buffer has been detached and so cannot be used as a response",
      );
    }
    assert(this[_view].byteLength > 0);
    assert(this[_view].buffer.byteLength > 0);
    readableByteStreamControllerRespond(this[_controller], bytesWritten);
  }

  respondWithNewView(view) {
    webidl.assertBranded(this, ReadableStreamBYOBRequestPrototype);
    const prefix =
      "Failed to execute 'respondWithNewView' on 'ReadableStreamBYOBRequest'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    view = webidl.converters.ArrayBufferView(view, {
      prefix,
      context: "Argument 1",
    });

    if (this[_controller] === undefined) {
      throw new TypeError("This BYOB request has been invalidated");
    }
    if (isDetachedBuffer(view.buffer)) {
      throw new TypeError(
        "The given view's buffer has been detached and so cannot be used as a response",
      );
    }
    readableByteStreamControllerRespondWithNewView(this[_controller], view);
  }
}

webidl.configurePrototype(ReadableStreamBYOBRequest);
const ReadableStreamBYOBRequestPrototype =
  ReadableStreamBYOBRequest.prototype;

export class ReadableByteStreamController {
  // @ts-ignore
  [_autoAllocateChunkSize]: number | undefined;
  // @ts-ignore
  [_byobRequest]: ReadableStreamBYOBRequest | null;
  // @ts-ignore
  [_cancelAlgorithm]: (reason: any) => Promise<void>;
  // @ts-ignore
  [_closeRequested]: boolean;
  // @ts-ignore
  [_pullAgain]: boolean;
  // @ts-ignore
  [_pullAlgorithm]: (controller: this) => Promise<void>;
  // @ts-ignore
  [_pulling]: boolean;
  // @ts-ignore
  [_pendingPullIntos]: PullIntoDescriptor[];
  // @ts-ignore
  [_queue]: ReadableByteStreamQueueEntry[];
  // @ts-ignore
  [_queueTotalSize]: number;
  // @ts-ignore
  [_started]: boolean;
  // @ts-ignore
  [_strategyHWM]: number;
  // @ts-ignore
  [_stream]: ReadableStream<ArrayBuffer>;

  constructor() {
    webidl.illegalConstructor();
  }

  get byobRequest(): ReadableStreamBYOBRequest | null {
    webidl.assertBranded(this, ReadableByteStreamControllerPrototype);
    return readableByteStreamControllerGetBYOBRequest(this);
  }

  get desiredSize(): number | null {
    webidl.assertBranded(this, ReadableByteStreamControllerPrototype);
    return readableByteStreamControllerGetDesiredSize(this);
  }

  close(): void {
    webidl.assertBranded(this, ReadableByteStreamControllerPrototype);
    if (this[_closeRequested] === true) {
      throw new TypeError("Closed already requested.");
    }
    if (this[_stream][_state] !== "readable") {
      throw new TypeError(
        "ReadableByteStreamController's stream is not in a readable state.",
      );
    }
    readableByteStreamControllerClose(this);
  }

  enqueue(chunk: ArrayBufferView): void {
    webidl.assertBranded(this, ReadableByteStreamControllerPrototype);
    const prefix =
      "Failed to execute 'enqueue' on 'ReadableByteStreamController'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    const arg1 = "Argument 1";
    chunk = webidl.converters.ArrayBufferView(chunk, {
      prefix,
      context: arg1,
    });
    if (chunk.byteLength === 0) {
      throw webidl.makeException(TypeError, "length must be non-zero", {
        prefix,
        context: arg1,
      });
    }
    if (chunk.buffer.byteLength === 0) {
      throw webidl.makeException(
        TypeError,
        "buffer length must be non-zero",
        { prefix, context: arg1 },
      );
    }
    if (this[_closeRequested] === true) {
      throw new TypeError(
        "Cannot enqueue chunk after a close has been requested.",
      );
    }
    if (this[_stream][_state] !== "readable") {
      throw new TypeError(
        "Cannot enqueue chunk when underlying stream is not readable.",
      );
    }
    return readableByteStreamControllerEnqueue(this, chunk);
  }

  error(e: any = undefined): void {
    webidl.assertBranded(this, ReadableByteStreamControllerPrototype);
    if (e !== undefined) {
      e = webidl.converters.any(e);
    }
    readableByteStreamControllerError(this, e);
  }

  [SymbolFor("Deno.customInspect")](inspect) {
    return inspect(consoleInternal.createFilteredInspectProxy({
      object: this,
      evaluate: ObjectPrototypeIsPrototypeOf(
        ReadableByteStreamControllerPrototype,
        this,
      ),
      keys: ["desiredSize"],
    }));
  }

  [_cancelSteps](reason: any): Promise<void> {
    readableByteStreamControllerClearPendingPullIntos(this);
    resetQueue(this);
    const result = this[_cancelAlgorithm](reason);
    readableByteStreamControllerClearAlgorithms(this);
    return result;
  }

  [_pullSteps](readRequest: ReadRequest<ArrayBuffer>): void {
    const stream: ReadableStream<ArrayBuffer> = this[_stream];
    assert(readableStreamHasDefaultReader(stream));
    if (this[_queueTotalSize] > 0) {
      assert(readableStreamGetNumReadRequests(stream) === 0);
      readableByteStreamControllerFillReadRequestFromQueue(this, readRequest);
      return;
    }
    const autoAllocateChunkSize = this[_autoAllocateChunkSize];
    if (autoAllocateChunkSize !== undefined) {
      let buffer;
      try {
        buffer = new ArrayBuffer(autoAllocateChunkSize);
      } catch (e) {
        readRequest.errorSteps(e);
        return;
      }

      const pullIntoDescriptor: PullIntoDescriptor = {
        buffer,
        bufferByteLength: autoAllocateChunkSize,
        byteOffset: 0,
        byteLength: autoAllocateChunkSize,
        bytesFilled: 0,
        elementSize: 1,
        viewConstructor: Uint8Array,
        readerType: "default",
      };
      ArrayPrototypePush(this[_pendingPullIntos], pullIntoDescriptor);
    }
    readableStreamAddReadRequest(stream, readRequest);
    readableByteStreamControllerCallPullIfNeeded(this);
  }

  [_releaseSteps]() {
    if (this[_pendingPullIntos].length !== 0) {
      const firstPendingPullInto: PullIntoDescriptor = this[_pendingPullIntos][0];
      firstPendingPullInto.readerType = "none";
      this[_pendingPullIntos] = [firstPendingPullInto];
    }
  }
}

webidl.configurePrototype(ReadableByteStreamController);
const ReadableByteStreamControllerPrototype =
  ReadableByteStreamController.prototype;

export class ReadableStreamDefaultController<R = any> {
  // @ts-ignore
  [_cancelAlgorithm]: (reason: any) => Promise<void>;
  // @ts-ignore
  [_closeRequested]: boolean;
  // @ts-ignore
  [_pullAgain]: boolean;
  // @ts-ignore
  [_pullAlgorithm]: (controller: this) => Promise<void>;
  // @ts-ignore
  [_pulling]: boolean;
  // @ts-ignore
  [_queue]: Array<ValueWithSize<R>>;
  // @ts-ignore
  [_queueTotalSize]: number;
  // @ts-ignore
  [_started]: boolean;
  // @ts-ignore
  [_strategyHWM]: number;
  // @ts-ignore
  [_strategySizeAlgorithm]: (chunk: R) => number;
  // @ts-ignore
  [_stream]: ReadableStream<R>;

  constructor() {
    webidl.illegalConstructor();
  }

  get desiredSize(): number | null {
    webidl.assertBranded(this, ReadableStreamDefaultControllerPrototype);
    return readableStreamDefaultControllerGetDesiredSize(this);
  }

  close(): void {
    webidl.assertBranded(this, ReadableStreamDefaultControllerPrototype);
    if (readableStreamDefaultControllerCanCloseOrEnqueue(this) === false) {
      throw new TypeError("The stream controller cannot close or enqueue.");
    }
    readableStreamDefaultControllerClose(this);
  }

  enqueue(chunk: R = undefined): void {
    webidl.assertBranded(this, ReadableStreamDefaultControllerPrototype);
    if (chunk !== undefined) {
      chunk = webidl.converters.any(chunk);
    }
    if (readableStreamDefaultControllerCanCloseOrEnqueue(this) === false) {
      throw new TypeError("The stream controller cannot close or enqueue.");
    }
    readableStreamDefaultControllerEnqueue(this, chunk);
  }

  error(e: any = undefined): void {
    webidl.assertBranded(this, ReadableStreamDefaultControllerPrototype);
    if (e !== undefined) {
      e = webidl.converters.any(e);
    }
    readableStreamDefaultControllerError(this, e);
  }

  [SymbolFor("Deno.customInspect")](inspect) {
    return inspect(consoleInternal.createFilteredInspectProxy({
      object: this,
      evaluate: ObjectPrototypeIsPrototypeOf(
        ReadableStreamDefaultController.prototype,
        this,
      ),
      keys: ["desiredSize"],
    }));
  }

  [_cancelSteps](reason: any): Promise<void> {
    resetQueue(this);
    const result = this[_cancelAlgorithm](reason);
    readableStreamDefaultControllerClearAlgorithms(this);
    return result;
  }

  [_pullSteps](readRequest: ReadRequest<R>): void {
    const stream = this[_stream];
    if (this[_queue].length) {
      const chunk: R = dequeueValue(this);
      if (this[_closeRequested] && this[_queue].length === 0) {
        readableStreamDefaultControllerClearAlgorithms(this);
        readableStreamClose(stream);
      } else {
        readableStreamDefaultControllerCallPullIfNeeded(this);
      }
      readRequest.chunkSteps(chunk);
    } else {
      readableStreamAddReadRequest(stream, readRequest);
      readableStreamDefaultControllerCallPullIfNeeded(this);
    }
  }

  [_releaseSteps]() {
    return;
  }
}

webidl.configurePrototype(ReadableStreamDefaultController);
const ReadableStreamDefaultControllerPrototype =
  ReadableStreamDefaultController.prototype;

export class TransformStream<I = any, O = any> {
  // @ts-ignore
  [_backpressure]: boolean;
  // @ts-ignore
  [_backpressureChangePromise]: Deferred<void>;
  // @ts-ignore
  [_controller]: TransformStreamDefaultController<O>;
  // @ts-ignore
  [_detached]: boolean;
  // @ts-ignore
  [_readable]: ReadableStream<O>;
  // @ts-ignore
  [_writable]: WritableStream<I>;

  constructor(
    transformer: Transformer<I, O> = undefined,
    writableStrategy: QueuingStrategy<I> = {},
    readableStrategy: QueuingStrategy<O> = {},
  ) {
    const prefix = "Failed to construct 'TransformStream'";
    if (transformer !== undefined) {
      transformer = webidl.converters.object(transformer, {
        prefix,
        context: "Argument 1",
      });
    }
    writableStrategy = webidl.converters.QueuingStrategy(writableStrategy, {
      prefix,
      context: "Argument 2",
    });
    readableStrategy = webidl.converters.QueuingStrategy(readableStrategy, {
      prefix,
      context: "Argument 2",
    });
    this[webidl.brand] = webidl.brand;
    if (transformer === undefined) {
      transformer = null;
    }
    const transformerDict = webidl.converters.Transformer(transformer, {
      prefix,
      context: "transformer",
    });
    if (transformerDict.readableType !== undefined) {
      throw new RangeError(
        `${prefix}: readableType transformers not supported.`,
      );
    }
    if (transformerDict.writableType !== undefined) {
      throw new RangeError(
        `${prefix}: writableType transformers not supported.`,
      );
    }
    const readableHighWaterMark = extractHighWaterMark(readableStrategy, 0);
    const readableSizeAlgorithm = extractSizeAlgorithm(readableStrategy);
    const writableHighWaterMark = extractHighWaterMark(writableStrategy, 1);
    const writableSizeAlgorithm = extractSizeAlgorithm(writableStrategy);
    const startPromise: Deferred<void> = new Deferred();
    initializeTransformStream(
      this,
      startPromise,
      writableHighWaterMark,
      writableSizeAlgorithm,
      readableHighWaterMark,
      readableSizeAlgorithm,
    );
    setUpTransformStreamDefaultControllerFromTransformer(
      this,
      transformer,
      transformerDict,
    );
    if (transformerDict.start) {
      startPromise.resolve(
        webidl.invokeCallbackFunction(
          transformerDict.start,
          [this[_controller]],
          transformer,
          webidl.converters.any,
          {
            prefix:
              "Failed to call 'start' on 'TransformStreamDefaultController'",
          },
        ),
      );
    } else {
      startPromise.resolve(undefined);
    }
  }

  get readable(): ReadableStream<O> {
    webidl.assertBranded(this, TransformStreamPrototype);
    return this[_readable];
  }

  get writable(): WritableStream<I> {
    webidl.assertBranded(this, TransformStreamPrototype);
    return this[_writable];
  }

  [SymbolFor("Deno.privateCustomInspect")](inspect) {
    return `${this.constructor.name} ${
      inspect({ readable: this.readable, writable: this.writable })
    }`;
  }
}

webidl.configurePrototype(TransformStream);
const TransformStreamPrototype = TransformStream.prototype;

export class TransformStreamDefaultController<O = any> {
  // @ts-ignore
  [_flushAlgorithm]: (controller: this) => Promise<void>;
  // @ts-ignore
  [_stream]: TransformStream<O>;
  // @ts-ignore
  [_transformAlgorithm]: (chunk: O, controller: this) => Promise<void>;

  constructor() {
    webidl.illegalConstructor();
  }

  get desiredSize(): number | null {
    webidl.assertBranded(this, TransformStreamDefaultController.prototype);
    const readableController: ReadableStreamDefaultController<O> = this[_stream][_readable][_controller];
    return readableStreamDefaultControllerGetDesiredSize(
      readableController,
    );
  }

  enqueue(chunk: 0 = undefined): void {
    webidl.assertBranded(this, TransformStreamDefaultController.prototype);
    if (chunk !== undefined) {
      chunk = webidl.converters.any(chunk);
    }
    transformStreamDefaultControllerEnqueue(this, chunk as O);
  }

  error(reason: any = undefined): void {
    webidl.assertBranded(this, TransformStreamDefaultController.prototype);
    if (reason !== undefined) {
      reason = webidl.converters.any(reason);
    }
    transformStreamDefaultControllerError(this, reason);
  }

  terminate(): void {
    webidl.assertBranded(this, TransformStreamDefaultControllerPrototype);
    transformStreamDefaultControllerTerminate(this);
  }

  [SymbolFor("Deno.customInspect")](inspect) {
    return inspect(consoleInternal.createFilteredInspectProxy({
      object: this,
      evaluate: ObjectPrototypeIsPrototypeOf(
        TransformStreamDefaultController.prototype,
        this,
      ),
      keys: ["desiredSize"],
    }));
  }
}

webidl.configurePrototype(TransformStreamDefaultController);
const TransformStreamDefaultControllerPrototype =
  TransformStreamDefaultController.prototype;

export class WritableStream<W = any> {
  // @ts-ignore
  [_backpressure]: boolean;
  // @ts-ignore
  [_closeRequest]: Deferred<void> | undefined;
  // @ts-ignore
  [_controller]: WritableStreamDefaultController<W>;
  // @ts-ignore
  [_detached]: boolean;
  // @ts-ignore
  [_inFlightWriteRequest]: Deferred<void> | undefined;
  // @ts-ignore
  [_inFlightCloseRequest]: Deferred<void> | undefined;
  // @ts-ignore
  [_pendingAbortRequest]: PendingAbortRequest | undefined;
  // @ts-ignore
  [_state]: "writable" | "closed" | "erroring" | "errored";
  // @ts-ignore
  [_storedError]: WritableStreamDefaultWriter<W>;
  // @ts-ignore
  [_writer];
  // @ts-ignore
  [_writeRequests]: Deferred<void>[];

  constructor(underlyingSink: UnderlyingSink<W> = undefined, strategy: QueuingStrategy<W> = {}) {
    const prefix = "Failed to construct 'WritableStream'";
    if (underlyingSink !== undefined) {
      underlyingSink = webidl.converters.object(underlyingSink, {
        prefix,
        context: "Argument 1",
      });
    }
    strategy = webidl.converters.QueuingStrategy(strategy, {
      prefix,
      context: "Argument 2",
    });
    this[webidl.brand] = webidl.brand;
    if (underlyingSink === undefined) {
      underlyingSink = null;
    }
    const underlyingSinkDict = webidl.converters.UnderlyingSink(
      underlyingSink,
      { prefix, context: "underlyingSink" },
    );
    if (underlyingSinkDict.type != null) {
      throw new RangeError(
        `${prefix}: WritableStream does not support 'type' in the underlying sink.`,
      );
    }
    initializeWritableStream(this);
    const sizeAlgorithm = extractSizeAlgorithm(strategy);
    const highWaterMark = extractHighWaterMark(strategy, 1);
    setUpWritableStreamDefaultControllerFromUnderlyingSink(
      this,
      underlyingSink,
      underlyingSinkDict,
      highWaterMark,
      sizeAlgorithm,
    );
  }

  get locked(): boolean {
    webidl.assertBranded(this, WritableStreamPrototype);
    return isWritableStreamLocked(this);
  }

  abort(reason: any = undefined): Promise<void> {
    try {
      webidl.assertBranded(this, WritableStreamPrototype);
    } catch (err) {
      return PromiseReject(err);
    }
    if (reason !== undefined) {
      reason = webidl.converters.any(reason);
    }
    if (isWritableStreamLocked(this)) {
      return PromiseReject(
        new TypeError(
          "The writable stream is locked, therefore cannot be aborted.",
        ),
      );
    }
    return writableStreamAbort(this, reason);
  }

  close(): Promise<void> {
    try {
      webidl.assertBranded(this, WritableStreamPrototype);
    } catch (err) {
      return PromiseReject(err);
    }
    if (isWritableStreamLocked(this)) {
      return PromiseReject(
        new TypeError(
          "The writable stream is locked, therefore cannot be closed.",
        ),
      );
    }
    if (writableStreamCloseQueuedOrInFlight(this) === true) {
      return PromiseReject(
        new TypeError("The writable stream is already closing."),
      );
    }
    return writableStreamClose(this);
  }

  getWriter(): WritableStreamDefaultWriter<W> {
    webidl.assertBranded(this, WritableStreamPrototype);
    return acquireWritableStreamDefaultWriter(this);
  }

  [SymbolFor("Deno.privateCustomInspect")](inspect) {
    return `${this.constructor.name} ${inspect({ locked: this.locked })}`;
  }
}

webidl.configurePrototype(WritableStream);
const WritableStreamPrototype = WritableStream.prototype;

export class WritableStreamDefaultWriter<W = any> {
  // @ts-ignore
  [_closedPromise]: Deferred<void>;
  // @ts-ignore
  [_readyPromise]: Deferred<void>;
  // @ts-ignore
  [_stream]: WritableStream<W>;

  constructor(stream: WritableStream<W>) {
    const prefix = "Failed to construct 'WritableStreamDefaultWriter'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    stream = webidl.converters.WritableStream(stream, {
      prefix,
      context: "Argument 1",
    });
    this[webidl.brand] = webidl.brand;
    setUpWritableStreamDefaultWriter(this, stream);
  }

  get closed(): Promise<void> {
    try {
      webidl.assertBranded(this, WritableStreamDefaultWriterPrototype);
    } catch (err) {
      return PromiseReject(err);
    }
    return this[_closedPromise].promise;
  }

  get desiredSize(): number {
    webidl.assertBranded(this, WritableStreamDefaultWriterPrototype);
    if (this[_stream] === undefined) {
      throw new TypeError(
        "A writable stream is not associated with the writer.",
      );
    }
    return writableStreamDefaultWriterGetDesiredSize(this);
  }

  get ready(): Promise<void> {
    try {
      webidl.assertBranded(this, WritableStreamDefaultWriterPrototype);
    } catch (err) {
      return PromiseReject(err);
    }
    return this[_readyPromise].promise;
  }

  abort(reason: any = undefined): Promise<void> {
    try {
      webidl.assertBranded(this, WritableStreamDefaultWriterPrototype);
    } catch (err) {
      return PromiseReject(err);
    }
    if (reason !== undefined) {
      reason = webidl.converters.any(reason);
    }
    if (this[_stream] === undefined) {
      return PromiseReject(
        new TypeError("A writable stream is not associated with the writer."),
      );
    }
    return writableStreamDefaultWriterAbort(this, reason);
  }

  close(): Promise<void> {
    try {
      webidl.assertBranded(this, WritableStreamDefaultWriterPrototype);
    } catch (err) {
      return PromiseReject(err);
    }
    const stream = this[_stream];
    if (stream === undefined) {
      return PromiseReject(
        new TypeError("A writable stream is not associated with the writer."),
      );
    }
    if (writableStreamCloseQueuedOrInFlight(stream) === true) {
      return PromiseReject(
        new TypeError("The associated stream is already closing."),
      );
    }
    return writableStreamDefaultWriterClose(this) as Promise<void>;
  }

  releaseLock(): void {
    webidl.assertBranded(this, WritableStreamDefaultWriterPrototype);
    const stream = this[_stream];
    if (stream === undefined) {
      return;
    }
    assert(stream[_writer] !== undefined);
    writableStreamDefaultWriterRelease(this);
  }

  write(chunk: W = undefined): Promise<void> {
    try {
      webidl.assertBranded(this, WritableStreamDefaultWriterPrototype);
      if (chunk !== undefined) {
        chunk = webidl.converters.any(chunk);
      }
    } catch (err) {
      return PromiseReject(err);
    }
    if (this[_stream] === undefined) {
      return PromiseReject(
        new TypeError("A writable stream is not associate with the writer."),
      );
    }
    return writableStreamDefaultWriterWrite(this, chunk) as Promise<void>;
  }

  [SymbolFor("Deno.customInspect")](inspect) {
    return inspect(consoleInternal.createFilteredInspectProxy({
      object: this,
      evaluate: ObjectPrototypeIsPrototypeOf(
        WritableStreamDefaultWriter.prototype,
        this,
      ),
      keys: [
        "closed",
        "desiredSize",
        "ready",
      ],
    }));
  }
}

webidl.configurePrototype(WritableStreamDefaultWriter);
const WritableStreamDefaultWriterPrototype =
  WritableStreamDefaultWriter.prototype;

export class WritableStreamDefaultController<W = any> {
  // @ts-ignore
  [_abortAlgorithm]: (reason?: any) => Promise<void>;
  // @ts-ignore
  [_closeAlgorithm]: () => Promise<void>;
  // @ts-ignore
  [_queue]: ValueWithSize<W>[];
  // @ts-ignore
  [_queueTotalSize]: number;
  // @ts-ignore
  [_started]: boolean;
  // @ts-ignore
  [_strategyHWM]: number;
  // @ts-ignore
  [_strategySizeAlgorithm]: (chunk: W) => number;
  // @ts-ignore
  [_stream]: WritableStream<W>;
  // @ts-ignore
  [_writeAlgorithm]: (chunk: W, controller: this) => Promise<void>;
  // @ts-ignore
  [_signal]: AbortSignal;

  get signal() {
    webidl.assertBranded(this, WritableStreamDefaultControllerPrototype);
    return this[_signal];
  }

  constructor() {
    webidl.illegalConstructor();
  }

  error(e: any = undefined): void {
    webidl.assertBranded(this, WritableStreamDefaultControllerPrototype);
    if (e !== undefined) {
      e = webidl.converters.any(e);
    }
    const state = this[_stream][_state];
    if (state !== "writable") {
      return;
    }
    writableStreamDefaultControllerError(this, e);
  }

  [SymbolFor("Deno.customInspect")](inspect) {
    return inspect(consoleInternal.createFilteredInspectProxy({
      object: this,
      evaluate: ObjectPrototypeIsPrototypeOf(
        WritableStreamDefaultController.prototype,
        this,
      ),
      keys: [],
    }));
  }

  [_abortSteps](reason?: any): Promise<void> {
    const result = this[_abortAlgorithm](reason);
    writableStreamDefaultControllerClearAlgorithms(this);
    return result;
  }

  [_errorSteps]() {
    resetQueue(this);
  }
}

webidl.configurePrototype(WritableStreamDefaultController);
const WritableStreamDefaultControllerPrototype =
  WritableStreamDefaultController.prototype;

export function createProxy(stream: ReadableStream) {
  return stream.pipeThrough(new TransformStream());
}

webidl.converters.ReadableStream = webidl
  .createInterfaceConverter("ReadableStream", ReadableStream.prototype);
webidl.converters.WritableStream = webidl
  .createInterfaceConverter("WritableStream", WritableStream.prototype);

webidl.converters.ReadableStreamType = webidl.createEnumConverter(
  "ReadableStreamType",
  ["bytes"],
);

webidl.converters.UnderlyingSource = webidl
  .createDictionaryConverter("UnderlyingSource", [
    {
      key: "start",
      converter: webidl.converters.Function,
    },
    {
      key: "pull",
      converter: webidl.converters.Function,
    },
    {
      key: "cancel",
      converter: webidl.converters.Function,
    },
    {
      key: "type",
      converter: webidl.converters.ReadableStreamType,
    },
    {
      key: "autoAllocateChunkSize",
      converter: (V, opts) =>
        webidl.converters["unsigned long long"](V, {
          ...opts,
          enforceRange: true,
        }),
    },
  ]);
webidl.converters.UnderlyingSink = webidl
  .createDictionaryConverter("UnderlyingSink", [
    {
      key: "start",
      converter: webidl.converters.Function,
    },
    {
      key: "write",
      converter: webidl.converters.Function,
    },
    {
      key: "close",
      converter: webidl.converters.Function,
    },
    {
      key: "abort",
      converter: webidl.converters.Function,
    },
    {
      key: "type",
      converter: webidl.converters.any,
    },
  ]);
webidl.converters.Transformer = webidl
  .createDictionaryConverter("Transformer", [
    {
      key: "start",
      converter: webidl.converters.Function,
    },
    {
      key: "transform",
      converter: webidl.converters.Function,
    },
    {
      key: "flush",
      converter: webidl.converters.Function,
    },
    {
      key: "readableType",
      converter: webidl.converters.any,
    },
    {
      key: "writableType",
      converter: webidl.converters.any,
    },
  ]);
webidl.converters.QueuingStrategy = webidl
  .createDictionaryConverter("QueuingStrategy", [
    {
      key: "highWaterMark",
      converter: webidl.converters["unrestricted double"],
    },
    {
      key: "size",
      converter: webidl.converters.Function,
    },
  ]);
webidl.converters.QueuingStrategyInit = webidl
  .createDictionaryConverter("QueuingStrategyInit", [
    {
      key: "highWaterMark",
      converter: webidl.converters["unrestricted double"],
      required: true,
    },
  ]);

webidl.converters.ReadableStreamIteratorOptions = webidl
  .createDictionaryConverter("ReadableStreamIteratorOptions", [
    {
      key: "preventCancel",
      defaultValue: false,
      converter: webidl.converters.boolean,
    },
  ]);

webidl.converters.ReadableStreamReaderMode = webidl
  .createEnumConverter("ReadableStreamReaderMode", ["byob"]);
webidl.converters.ReadableStreamGetReaderOptions = webidl
  .createDictionaryConverter("ReadableStreamGetReaderOptions", [{
    key: "mode",
    converter: webidl.converters.ReadableStreamReaderMode,
  }]);

webidl.converters.ReadableWritablePair = webidl
  .createDictionaryConverter("ReadableWritablePair", [
    {
      key: "readable",
      converter: webidl.converters.ReadableStream,
      required: true,
    },
    {
      key: "writable",
      converter: webidl.converters.WritableStream,
      required: true,
    },
  ]);
webidl.converters.StreamPipeOptions = webidl
  .createDictionaryConverter("StreamPipeOptions", [
    {
      key: "preventClose",
      defaultValue: false,
      converter: webidl.converters.boolean,
    },
    {
      key: "preventAbort",
      defaultValue: false,
      converter: webidl.converters.boolean,
    },
    {
      key: "preventCancel",
      defaultValue: false,
      converter: webidl.converters.boolean,
    },
    { key: "signal", converter: webidl.converters.AbortSignal },
  ]);
