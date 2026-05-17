// WHATWG Streams — ReadableStream (default controller only)
// Adapted from refs/node/lib/internal/webstreams/readablestream.js
// Copyright (c) Node.js contributors. MIT license.
// Modifications: Removed primordials, BYOB/byte stream, transfer/inspect,
//   Node.js error codes, assert. Rewritten in TypeScript for GJS.

import {
  kState, kType,
  isBrandCheck,
  createPromiseCallback,
  dequeueValue,
  enqueueValueWithSize,
  extractHighWaterMark,
  extractSizeAlgorithm,
  resetQueue,
  setPromiseHandled,
  nonOpCancel,
  nonOpPull,
  nonOpStart,
  getIterator,
  iteratorNext,
  AsyncIterator,
  transferArrayBuffer,
  isDetachedBuffer,
  typedArrayConstructorByTag,
  elementSizeByTag,
} from './util.js';

import {
  WritableStreamDefaultWriter,
  isWritableStream,
  isWritableStreamLocked,
  writableStreamAbort,
  writableStreamCloseQueuedOrInFlight,
  writableStreamDefaultWriterCloseWithErrorPropagation,
  writableStreamDefaultWriterRelease,
  writableStreamDefaultWriterWrite,
} from './writable-stream.js';

// ---- Internal symbols ----

const kCancel = Symbol('kCancel');
const kClose = Symbol('kClose');
const kChunk = Symbol('kChunk');
const kError = Symbol('kError');
const kPull = Symbol('kPull');
const kRelease = Symbol('kRelease');
const kSkipThrow = Symbol('kSkipThrow');

// ---- Lazy error singletons ----

let releasedError: TypeError | undefined;
let releasingError: TypeError | undefined;

function lazyReadableReleasedError(): TypeError {
  if (releasedError) return releasedError;
  releasedError = new TypeError('Reader released');
  return releasedError;
}

function lazyReadableReleasingError(): TypeError {
  if (releasingError) return releasingError;
  releasingError = new TypeError('Releasing reader');
  return releasingError;
}

// ---- DOMException helper ----

function createAbortError(): Error {
  if (typeof globalThis.DOMException === 'function') {
    return new DOMException('The operation was aborted', 'AbortError');
  }
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

import { queueMicrotask as _queueMicrotask } from '@gjsify/utils';

// ---- ReadableStream state factory ----

function createReadableStreamState() {
  return {
    disturbed: false,
    reader: undefined as ReadableStreamDefaultReader | undefined,
    state: 'readable' as string,
    storedError: undefined as unknown,
    controller: undefined as ReadableStreamDefaultController | undefined,
    // closedPromise tracks stream-level close for watchers (pipeTo, etc.)
    closedPromise: Promise.withResolvers<void>(),
  };
}

// ---- ReadableStream ----

class ReadableStream {
  [kType] = 'ReadableStream';
  [kState]: any;

  constructor(source: any = {}, strategy: any = {}) {
    if (source != null && typeof source !== 'object') {
      throw new TypeError('source must be an object');
    }
    if (strategy != null && typeof strategy !== 'object') {
      throw new TypeError('strategy must be an object');
    }

    this[kState] = createReadableStreamState();

    // The spec requires handling of the strategy first.
    const size = strategy?.size;
    const highWaterMark = strategy?.highWaterMark;
    const type = source?.type;

    if (type !== undefined) {
      if (`${type}` === 'bytes') {
        if (size !== undefined) {
          throw new RangeError('strategy.size must not be set for a byte stream');
        }
        setupReadableByteStreamControllerFromSource(
          this,
          source,
          extractHighWaterMark(highWaterMark, 0),
        );
        return;
      }
      throw new RangeError(`Invalid type: ${type}`);
    }

    setupReadableStreamDefaultControllerFromSource(
      this,
      source,
      extractHighWaterMark(highWaterMark, 1),
      extractSizeAlgorithm(size),
    );
  }

  get locked(): boolean {
    if (!isReadableStream(this)) throw new TypeError('Invalid this');
    return isReadableStreamLocked(this);
  }

  static from(iterable: unknown): ReadableStream {
    return readableStreamFromIterable(iterable);
  }

  cancel(reason: unknown = undefined): Promise<void> {
    if (!isReadableStream(this))
      return Promise.reject(new TypeError('Invalid this'));
    if (isReadableStreamLocked(this))
      return Promise.reject(new TypeError('ReadableStream is locked'));
    return readableStreamCancel(this, reason);
  }

  getReader(options: any = {}): ReadableStreamDefaultReader | ReadableStreamBYOBReader {
    if (!isReadableStream(this)) throw new TypeError('Invalid this');
    if (options != null && typeof options !== 'object') {
      throw new TypeError('options must be an object');
    }
    const mode = options?.mode;
    if (mode === undefined)
      return new ReadableStreamDefaultReader(this);
    if (`${mode}` === 'byob')
      return new ReadableStreamBYOBReader(this);
    throw new RangeError(`Invalid mode: ${mode}`);
  }

  pipeThrough(transform: any, options: any = {}): ReadableStream {
    if (!isReadableStream(this)) throw new TypeError('Invalid this');
    const readable = transform?.readable;
    if (!isReadableStream(readable)) {
      throw new TypeError('transform.readable must be a ReadableStream');
    }
    const writable = transform?.writable;
    if (!isWritableStream(writable)) {
      throw new TypeError('transform.writable must be a WritableStream');
    }

    if (options != null && typeof options !== 'object') {
      throw new TypeError('options must be an object');
    }
    const preventAbort = options?.preventAbort;
    const preventCancel = options?.preventCancel;
    const preventClose = options?.preventClose;
    const signal = options?.signal;

    if (signal !== undefined && !(signal instanceof Object && 'aborted' in signal)) {
      throw new TypeError('options.signal must be an AbortSignal');
    }

    if (isReadableStreamLocked(this))
      throw new TypeError('The ReadableStream is locked');
    if (isWritableStreamLocked(writable))
      throw new TypeError('The WritableStream is locked');

    const promise = readableStreamPipeTo(
      this,
      writable,
      !!preventClose,
      !!preventAbort,
      !!preventCancel,
      signal,
    );
    setPromiseHandled(promise);

    return readable;
  }

  pipeTo(destination: any, options: any = {}): Promise<void> {
    try {
      if (!isReadableStream(this)) throw new TypeError('Invalid this');
      if (!isWritableStream(destination)) {
        throw new TypeError('destination must be a WritableStream');
      }

      if (options != null && typeof options !== 'object') {
        throw new TypeError('options must be an object');
      }
      const preventAbort = options?.preventAbort;
      const preventCancel = options?.preventCancel;
      const preventClose = options?.preventClose;
      const signal = options?.signal;

      if (signal !== undefined && !(signal instanceof Object && 'aborted' in signal)) {
        throw new TypeError('options.signal must be an AbortSignal');
      }

      if (isReadableStreamLocked(this))
        throw new TypeError('The ReadableStream is locked');
      if (isWritableStreamLocked(destination))
        throw new TypeError('The WritableStream is locked');

      return readableStreamPipeTo(
        this,
        destination,
        !!preventClose,
        !!preventAbort,
        !!preventCancel,
        signal,
      );
    } catch (error) {
      return Promise.reject(error);
    }
  }

  tee(): [ReadableStream, ReadableStream] {
    if (!isReadableStream(this)) throw new TypeError('Invalid this');
    const controller = this[kState].controller;
    if (isReadableByteStreamController(controller)) {
      return readableByteStreamTee(this);
    }
    return readableStreamDefaultTee(this, false);
  }

  values(options: any = {}): AsyncIterableIterator<any> {
    if (!isReadableStream(this)) throw new TypeError('Invalid this');
    if (options != null && typeof options !== 'object') {
      throw new TypeError('options must be an object');
    }
    const preventCancel = !!(options?.preventCancel);

    const reader = new ReadableStreamDefaultReader(this);

    const state = {
      done: false,
      current: undefined as Promise<unknown> | undefined,
    };
    let started = false;

    function nextSteps(): Promise<IteratorResult<unknown>> {
      if (state.done)
        return Promise.resolve({ done: true, value: undefined });

      if (reader[kState].stream === undefined) {
        return Promise.reject(
          new TypeError('The reader is not bound to a ReadableStream'));
      }
      const { promise, resolve, reject } = Promise.withResolvers<IteratorResult<unknown>>();

      readableStreamDefaultReaderRead(reader, {
        [kChunk](chunk: unknown) {
          state.current = undefined;
          resolve({ value: chunk, done: false });
        },
        [kClose]() {
          state.current = undefined;
          state.done = true;
          readableStreamReaderGenericRelease(reader);
          resolve({ done: true, value: undefined });
        },
        [kError](error: unknown) {
          state.current = undefined;
          state.done = true;
          readableStreamReaderGenericRelease(reader);
          reject(error);
        },
      });
      return promise;
    }

    async function returnSteps(value: unknown): Promise<IteratorResult<unknown>> {
      if (state.done)
        return { done: true, value };
      state.done = true;

      if (reader[kState].stream === undefined) {
        throw new TypeError('The reader is not bound to a ReadableStream');
      }
      if (!preventCancel) {
        const result = readableStreamReaderGenericCancel(reader, value);
        readableStreamReaderGenericRelease(reader);
        await result;
        return { done: true, value };
      }

      readableStreamReaderGenericRelease(reader);
      return { done: true, value };
    }

    return Object.setPrototypeOf({
      next() {
        if (!started) {
          state.current = Promise.resolve();
          started = true;
        }
        state.current = state.current !== undefined
          ? state.current.then(nextSteps, nextSteps)
          : nextSteps();
        return state.current;
      },

      return(error: unknown) {
        started = true;
        state.current = state.current !== undefined
          ? state.current.then(
              () => returnSteps(error),
              () => returnSteps(error))
          : returnSteps(error);
        return state.current;
      },

      [Symbol.asyncIterator]() { return this; },
    }, AsyncIterator);
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<any> {
    return this.values();
  }

  get [Symbol.toStringTag]() {
    return 'ReadableStream';
  }
}

// ---- Async iterator read request (used by values()) ----
// Inlined into the values() method above as an object literal.

// ---- DefaultReadRequest ----

class DefaultReadRequest {
  [kState]: { promise: Promise<ReadableStreamReadResult<unknown>>; resolve: ((v: ReadableStreamReadResult<unknown>) => void) | undefined; reject: ((e: unknown) => void) | undefined };

  constructor() {
    this[kState] = Promise.withResolvers<ReadableStreamReadResult<unknown>>();
  }

  [kChunk](value: unknown) {
    this[kState].resolve?.({ value, done: false });
  }

  [kClose]() {
    this[kState].resolve?.({ value: undefined, done: true });
  }

  [kError](error: unknown) {
    this[kState].reject?.(error);
  }

  get promise() { return this[kState].promise; }
}

// ---- ReadableStreamDefaultReader ----

class ReadableStreamDefaultReader {
  [kType] = 'ReadableStreamDefaultReader';
  [kState]: any;

  constructor(stream: ReadableStream) {
    if (!isReadableStream(stream))
      throw new TypeError('Expected a ReadableStream');
    this[kState] = {
      readRequests: [] as DefaultReadRequest[],
      stream: undefined as ReadableStream | undefined,
      close: {
        promise: undefined as Promise<void> | undefined,
        resolve: undefined as (() => void) | undefined,
        reject: undefined as ((reason?: unknown) => void) | undefined,
      },
    };
    setupReadableStreamDefaultReader(this, stream);
  }

  read(): Promise<{ value: any; done: boolean }> {
    if (!isReadableStreamDefaultReader(this))
      return Promise.reject(new TypeError('Invalid this'));
    if (this[kState].stream === undefined) {
      return Promise.reject(
        new TypeError('The reader is not attached to a stream'));
    }

    const stream = this[kState].stream;
    const controller = stream[kState].controller;

    // Fast path: if data is already buffered in a default controller,
    // return a resolved promise immediately without creating a read request.
    if (stream[kState].state === 'readable' &&
        isReadableStreamDefaultController(controller) &&
        controller[kState].queue.length > 0) {
      stream[kState].disturbed = true;
      const chunk = dequeueValue(controller);

      if (controller[kState].closeRequested && !controller[kState].queue.length) {
        readableStreamDefaultControllerClearAlgorithms(controller);
        readableStreamClose(stream);
      } else {
        readableStreamDefaultControllerCallPullIfNeeded(controller);
      }

      return Promise.resolve({ value: chunk, done: false });
    }

    // Slow path: create request and go through normal flow
    const readRequest = new DefaultReadRequest();
    readableStreamDefaultReaderRead(this, readRequest);
    return readRequest.promise;
  }

  releaseLock(): void {
    if (!isReadableStreamDefaultReader(this))
      throw new TypeError('Invalid this');
    if (this[kState].stream === undefined)
      return;
    readableStreamDefaultReaderRelease(this);
  }

  get closed(): Promise<void> {
    if (!isReadableStreamDefaultReader(this))
      return Promise.reject(new TypeError('Invalid this'));
    return this[kState].close.promise;
  }

  cancel(reason: unknown = undefined): Promise<void> {
    if (!isReadableStreamDefaultReader(this))
      return Promise.reject(new TypeError('Invalid this'));
    if (this[kState].stream === undefined) {
      return Promise.reject(new TypeError('The reader is not attached to a stream'));
    }
    return readableStreamReaderGenericCancel(this, reason);
  }

  get [Symbol.toStringTag]() {
    return 'ReadableStreamDefaultReader';
  }
}

// ---- ReadableStreamDefaultController ----

class ReadableStreamDefaultController {
  [kType] = 'ReadableStreamDefaultController';
  [kState]: any = {};

  constructor(skipThrowSymbol?: symbol) {
    if (skipThrowSymbol !== kSkipThrow) {
      throw new TypeError('Illegal constructor');
    }
  }

  get desiredSize(): number | null {
    return readableStreamDefaultControllerGetDesiredSize(this);
  }

  close(): void {
    if (!readableStreamDefaultControllerCanCloseOrEnqueue(this))
      throw new TypeError('Controller is already closed');
    readableStreamDefaultControllerClose(this);
  }

  enqueue(chunk: any = undefined): void {
    if (!readableStreamDefaultControllerCanCloseOrEnqueue(this))
      throw new TypeError('Controller is already closed');
    readableStreamDefaultControllerEnqueue(this, chunk);
  }

  error(error: unknown = undefined): void {
    readableStreamDefaultControllerError(this, error);
  }

  [kCancel](reason: unknown) {
    return readableStreamDefaultControllerCancelSteps(this, reason);
  }

  [kPull](readRequest: any) {
    readableStreamDefaultControllerPullSteps(this, readRequest);
  }

  [kRelease]() {}

  get [Symbol.toStringTag]() {
    return 'ReadableStreamDefaultController';
  }
}

// ---- Brand checks ----

const isReadableStream = isBrandCheck('ReadableStream');
const isReadableStreamDefaultController = isBrandCheck('ReadableStreamDefaultController');
const isReadableStreamDefaultReader = isBrandCheck('ReadableStreamDefaultReader');

// ---- Stream state helpers ----

function isReadableStreamLocked(stream: any): boolean {
  return stream[kState].reader !== undefined;
}

function readableStreamCancel(stream: any, reason: unknown): Promise<void> {
  stream[kState].disturbed = true;
  switch (stream[kState].state) {
    case 'closed':
      return Promise.resolve();
    case 'errored':
      return Promise.reject(stream[kState].storedError);
  }
  readableStreamClose(stream);

  // BYOB readers: drain read-into requests with empty close (per spec).
  const reader = stream[kState].reader;
  if (reader !== undefined && readableStreamHasBYOBReader(stream)) {
    const readIntoRequests = reader[kState].readIntoRequests;
    reader[kState].readIntoRequests = [];
    for (let n = 0; n < readIntoRequests.length; n++) {
      readIntoRequests[n][kClose](undefined);
    }
  }

  return stream[kState].controller[kCancel](reason).then(() => {});
}

function readableStreamClose(stream: any): void {
  stream[kState].state = 'closed';
  stream[kState].closedPromise.resolve();
  const { reader } = stream[kState];

  if (reader === undefined) return;

  reader[kState].close.resolve?.();

  if (readableStreamHasDefaultReader(stream)) {
    for (let n = 0; n < reader[kState].readRequests.length; n++)
      reader[kState].readRequests[n][kClose]();
    reader[kState].readRequests = [];
  }
  // BYOB readers do NOT auto-error pending read-into requests on close —
  // the byte controller resolves them with empty views via
  // readableByteStreamControllerRespondInClosedState when the pull-into
  // descriptors are committed. So nothing to do here for BYOB.
}

function readableStreamError(stream: any, error: unknown): void {
  stream[kState].state = 'errored';
  stream[kState].storedError = error;
  setPromiseHandled(stream[kState].closedPromise.promise);
  stream[kState].closedPromise.reject(error);

  const { reader } = stream[kState];

  if (reader === undefined) return;

  setPromiseHandled(reader[kState].close.promise);
  reader[kState].close.reject?.(error);

  if (readableStreamHasDefaultReader(stream)) {
    for (let n = 0; n < reader[kState].readRequests.length; n++)
      reader[kState].readRequests[n][kError](error);
    reader[kState].readRequests = [];
  } else if (readableStreamHasBYOBReader(stream)) {
    for (let n = 0; n < reader[kState].readIntoRequests.length; n++)
      reader[kState].readIntoRequests[n][kError](error);
    reader[kState].readIntoRequests = [];
  }
}

function readableStreamHasDefaultReader(stream: any): boolean {
  const { reader } = stream[kState];
  if (reader === undefined) return false;
  return reader[kState] !== undefined && reader[kType] === 'ReadableStreamDefaultReader';
}

function readableStreamGetNumReadRequests(stream: any): number {
  return stream[kState].reader[kState].readRequests.length;
}

function readableStreamFulfillReadRequest(stream: any, chunk: unknown, done: boolean): void {
  const { reader } = stream[kState];
  const readRequest = reader[kState].readRequests.shift();

  if (done)
    readRequest[kClose]();
  else
    readRequest[kChunk](chunk);
}

function readableStreamAddReadRequest(stream: any, readRequest: any): void {
  stream[kState].reader[kState].readRequests.push(readRequest);
}

// ---- Reader generic operations ----

function readableStreamReaderGenericCancel(reader: any, reason: unknown): Promise<void> {
  const { stream } = reader[kState];
  return readableStreamCancel(stream, reason);
}

function readableStreamReaderGenericInitialize(reader: any, stream: any): void {
  reader[kState].stream = stream;
  stream[kState].reader = reader;
  switch (stream[kState].state) {
    case 'readable':
      reader[kState].close = Promise.withResolvers<void>();
      break;
    case 'closed':
      reader[kState].close = {
        promise: Promise.resolve(),
        resolve: undefined,
        reject: undefined,
      };
      break;
    case 'errored':
      reader[kState].close = {
        promise: Promise.reject(stream[kState].storedError),
        resolve: undefined,
        reject: undefined,
      };
      setPromiseHandled(reader[kState].close.promise);
      break;
  }
}

function readableStreamReaderGenericRelease(reader: any): void {
  const { stream } = reader[kState];

  const releasedStateError = lazyReadableReleasedError();
  if (stream[kState].state === 'readable') {
    reader[kState].close.reject?.(releasedStateError);
  } else {
    reader[kState].close = {
      promise: Promise.reject(releasedStateError),
      resolve: undefined,
      reject: undefined,
    };
  }
  setPromiseHandled(reader[kState].close.promise);

  stream[kState].controller[kRelease]();

  stream[kState].reader = undefined;
  reader[kState].stream = undefined;
}

function readableStreamDefaultReaderRelease(reader: any): void {
  readableStreamReaderGenericRelease(reader);
  readableStreamDefaultReaderErrorReadRequests(reader, lazyReadableReleasingError());
}

function readableStreamDefaultReaderErrorReadRequests(reader: any, e: unknown): void {
  for (let n = 0; n < reader[kState].readRequests.length; ++n) {
    reader[kState].readRequests[n][kError](e);
  }
  reader[kState].readRequests = [];
}

function readableStreamDefaultReaderRead(reader: any, readRequest: any): void {
  const { stream } = reader[kState];
  stream[kState].disturbed = true;
  switch (stream[kState].state) {
    case 'closed':
      readRequest[kClose]();
      break;
    case 'errored':
      readRequest[kError](stream[kState].storedError);
      break;
    case 'readable':
      stream[kState].controller[kPull](readRequest);
      break;
  }
}

function setupReadableStreamDefaultReader(reader: any, stream: any): void {
  if (isReadableStreamLocked(stream))
    throw new TypeError('ReadableStream is locked');
  readableStreamReaderGenericInitialize(reader, stream);
  reader[kState].readRequests = [];
}

// ---- Default controller internals ----

function readableStreamDefaultControllerClose(controller: any): void {
  if (!readableStreamDefaultControllerCanCloseOrEnqueue(controller))
    return;
  controller[kState].closeRequested = true;
  if (!controller[kState].queue.length) {
    readableStreamDefaultControllerClearAlgorithms(controller);
    readableStreamClose(controller[kState].stream);
  }
}

function readableStreamDefaultControllerEnqueue(controller: any, chunk: any): void {
  if (!readableStreamDefaultControllerCanCloseOrEnqueue(controller))
    return;

  const { stream } = controller[kState];

  if (isReadableStreamLocked(stream) &&
      readableStreamGetNumReadRequests(stream)) {
    readableStreamFulfillReadRequest(stream, chunk, false);
  } else {
    try {
      const chunkSize = controller[kState].sizeAlgorithm(chunk);
      enqueueValueWithSize(controller, chunk, chunkSize);
    } catch (error) {
      readableStreamDefaultControllerError(controller, error);
      throw error;
    }
  }
  readableStreamDefaultControllerCallPullIfNeeded(controller);
}

function readableStreamDefaultControllerCanCloseOrEnqueue(controller: any): boolean {
  const { stream } = controller[kState];
  return !controller[kState].closeRequested &&
         stream[kState].state === 'readable';
}

function readableStreamDefaultControllerGetDesiredSize(controller: any): number | null {
  const { stream, highWaterMark, queueTotalSize } = controller[kState];
  switch (stream[kState].state) {
    case 'errored': return null;
    case 'closed': return 0;
    default: return highWaterMark - queueTotalSize;
  }
}

function readableStreamDefaultControllerHasBackpressure(controller: any): boolean {
  return !readableStreamDefaultControllerShouldCallPull(controller);
}

function readableStreamDefaultControllerShouldCallPull(controller: any): boolean {
  const { stream } = controller[kState];
  if (!readableStreamDefaultControllerCanCloseOrEnqueue(controller) ||
      !controller[kState].started)
    return false;

  if (isReadableStreamLocked(stream) &&
      readableStreamGetNumReadRequests(stream)) {
    return true;
  }

  const desiredSize = readableStreamDefaultControllerGetDesiredSize(controller);
  return desiredSize !== null && desiredSize > 0;
}

function readableStreamDefaultControllerCallPullIfNeeded(controller: any): void {
  if (!readableStreamDefaultControllerShouldCallPull(controller))
    return;
  if (controller[kState].pulling) {
    controller[kState].pullAgain = true;
    return;
  }
  controller[kState].pulling = true;
  controller[kState].pullAlgorithm(controller).then(
    () => {
      controller[kState].pulling = false;
      if (controller[kState].pullAgain) {
        controller[kState].pullAgain = false;
        readableStreamDefaultControllerCallPullIfNeeded(controller);
      }
    },
    (error: unknown) => readableStreamDefaultControllerError(controller, error),
  );
}

function readableStreamDefaultControllerClearAlgorithms(controller: any): void {
  controller[kState].pullAlgorithm = undefined;
  controller[kState].cancelAlgorithm = undefined;
  controller[kState].sizeAlgorithm = undefined;
}

function readableStreamDefaultControllerError(controller: any, error: unknown): void {
  const { stream } = controller[kState];
  if (stream[kState].state === 'readable') {
    resetQueue(controller);
    readableStreamDefaultControllerClearAlgorithms(controller);
    readableStreamError(stream, error);
  }
}

function readableStreamDefaultControllerCancelSteps(controller: any, reason: unknown): Promise<void> {
  resetQueue(controller);
  const result = controller[kState].cancelAlgorithm(reason);
  readableStreamDefaultControllerClearAlgorithms(controller);
  return result;
}

function readableStreamDefaultControllerPullSteps(controller: any, readRequest: any): void {
  const { stream, queue } = controller[kState];
  if (queue.length) {
    const chunk = dequeueValue(controller);
    if (controller[kState].closeRequested && !queue.length) {
      readableStreamDefaultControllerClearAlgorithms(controller);
      readableStreamClose(stream);
    } else {
      readableStreamDefaultControllerCallPullIfNeeded(controller);
    }
    readRequest[kChunk](chunk);
    return;
  }
  readableStreamAddReadRequest(stream, readRequest);
  readableStreamDefaultControllerCallPullIfNeeded(controller);
}

// ---- Setup functions ----

function setupReadableStreamDefaultController(
  stream: any,
  controller: any,
  startAlgorithm: Function,
  pullAlgorithm: Function,
  cancelAlgorithm: Function,
  highWaterMark: number,
  sizeAlgorithm: (chunk: any) => number,
): void {
  controller[kState] = {
    cancelAlgorithm,
    closeRequested: false,
    highWaterMark,
    pullAgain: false,
    pullAlgorithm,
    pulling: false,
    queue: [] as { value: unknown; size: number }[],
    queueTotalSize: 0,
    started: false,
    sizeAlgorithm,
    stream,
  };
  stream[kState].controller = controller;

  const startResult = startAlgorithm();

  new Promise((r) => r(startResult)).then(
    () => {
      controller[kState].started = true;
      readableStreamDefaultControllerCallPullIfNeeded(controller);
    },
    (error) => readableStreamDefaultControllerError(controller, error),
  );
}

function setupReadableStreamDefaultControllerFromSource(
  stream: any,
  source: any,
  highWaterMark: number,
  sizeAlgorithm: (chunk: any) => number,
): void {
  const controller = new ReadableStreamDefaultController(kSkipThrow);
  const start = source?.start;
  const pull = source?.pull;
  const cancel = source?.cancel;
  const startAlgorithm = start
    ? start.bind(source, controller)
    : nonOpStart;
  const pullAlgorithm = pull
    ? createPromiseCallback('source.pull', pull, source)
    : nonOpPull;
  const cancelAlgorithm = cancel
    ? createPromiseCallback('source.cancel', cancel, source)
    : nonOpCancel;

  setupReadableStreamDefaultController(
    stream,
    controller,
    startAlgorithm,
    pullAlgorithm,
    cancelAlgorithm,
    highWaterMark,
    sizeAlgorithm,
  );
}

// ---- Internal factory (used by TransformStream and tee) ----

function createReadableStream(
  start: Function,
  pull: Function,
  cancel: Function,
  highWaterMark = 1,
  size: (chunk: any) => number = () => 1,
): ReadableStream {
  const stream = Object.create(ReadableStream.prototype);
  stream[kType] = 'ReadableStream';
  stream[kState] = createReadableStreamState();

  const controller = new ReadableStreamDefaultController(kSkipThrow);
  setupReadableStreamDefaultController(
    stream, controller, start, pull, cancel, highWaterMark, size,
  );
  return stream;
}

// ---- readableStreamFromIterable (static from()) ----

function readableStreamFromIterable(iterable: unknown): ReadableStream {
  let stream: any;
  const iteratorRecord = getIterator(iterable as Record<string | symbol, unknown>, 'async');

  const startAlgorithm = nonOpStart;

  async function pullAlgorithm() {
    const nextResult = iteratorNext(iteratorRecord);
    const nextPromise = Promise.resolve(nextResult);
    return nextPromise.then((iterResult: Record<string, unknown>) => {
      if (typeof iterResult !== 'object' || iterResult === null) {
        throw new TypeError(
          'The promise returned by the iterator.next() method must fulfill with an object');
      }
      if (iterResult.done) {
        readableStreamDefaultControllerClose(stream[kState].controller);
      } else {
        readableStreamDefaultControllerEnqueue(stream[kState].controller, iterResult.value);
      }
    });
  }

  async function cancelAlgorithm(reason: unknown) {
    const iterator = iteratorRecord.iterator;
    const returnMethod = iterator.return;
    if (returnMethod === undefined) {
      return Promise.resolve();
    }
    const returnResult = returnMethod.call(iterator, reason);
    const returnPromise = Promise.resolve(returnResult);
    return returnPromise.then((iterResult: Record<string, unknown>) => {
      if (typeof iterResult !== 'object' || iterResult === null) {
        throw new TypeError(
          'The promise returned by the iterator.return() method must fulfill with an object');
      }
      return undefined;
    });
  }

  stream = createReadableStream(
    startAlgorithm,
    pullAlgorithm,
    cancelAlgorithm,
    0,
  );

  return stream;
}

// ---- readableStreamPipeTo ----

function readableStreamPipeTo(
  source: any,
  dest: any,
  preventClose: boolean,
  preventAbort: boolean,
  preventCancel: boolean,
  signal: any,
): Promise<void> {
  let reader: any;
  let writer: any;

  // Both of these can throw synchronously. We want to capture
  // the error and return a rejected promise instead.
  try {
    reader = new ReadableStreamDefaultReader(source);
    writer = new WritableStreamDefaultWriter(dest);
  } catch (error) {
    return Promise.reject(error);
  }

  source[kState].disturbed = true;

  let shuttingDown = false;

  const { promise, resolve, reject } = Promise.withResolvers<void>();

  const state = {
    currentWrite: Promise.resolve() as Promise<void>,
  };

  let abortListener: (() => void) | undefined;

  // The error here can be undefined. The rejected arg
  // tells us that the promise must be rejected even
  // when error is undefined.
  function finalize(rejected: boolean, error?: unknown) {
    writableStreamDefaultWriterRelease(writer);
    readableStreamReaderGenericRelease(reader);
    if (signal !== undefined && abortListener) {
      signal.removeEventListener('abort', abortListener);
      abortListener = undefined;
    }
    if (rejected)
      reject(error);
    else
      resolve();
  }

  async function waitForCurrentWrite() {
    const write = state.currentWrite;
    await write;
    if (write !== state.currentWrite)
      await waitForCurrentWrite();
  }

  function shutdownWithAnAction(
    action: () => Promise<unknown>,
    rejected?: boolean,
    originalError?: unknown,
  ) {
    if (shuttingDown) return;
    shuttingDown = true;
    if (dest[kState].state === 'writable' &&
        !writableStreamCloseQueuedOrInFlight(dest)) {
      waitForCurrentWrite().then(complete, (error) => finalize(true, error));
      return;
    }
    complete();

    function complete() {
      action().then(
        () => finalize(!!rejected, originalError),
        (error) => finalize(true, error),
      );
    }
  }

  function shutdown(rejected?: boolean, error?: unknown) {
    if (shuttingDown) return;
    shuttingDown = true;
    if (dest[kState].state === 'writable' &&
        !writableStreamCloseQueuedOrInFlight(dest)) {
      waitForCurrentWrite().then(
        () => finalize(!!rejected, error),
        (err) => finalize(true, err),
      );
      return;
    }
    finalize(!!rejected, error);
  }

  function abortAlgorithm() {
    let error: unknown;
    if (signal.reason && (signal.reason as { name?: string }).name === 'AbortError') {
      // Cannot use the signal.reason directly if it's not a DOMException.
      error = createAbortError();
    } else {
      error = signal.reason;
    }

    const actions: (() => Promise<void>)[] = [];
    if (!preventAbort) {
      actions.push(() => {
        if (dest[kState].state === 'writable')
          return writableStreamAbort(dest, error);
        return Promise.resolve();
      });
    }
    if (!preventCancel) {
      actions.push(() => {
        if (source[kState].state === 'readable')
          return readableStreamCancel(source, error);
        return Promise.resolve();
      });
    }

    shutdownWithAnAction(
      () => Promise.all(actions.map((action) => action())).then(() => undefined),
      true,
      error,
    );
  }

  function watchErrored(stream: any, watchPromise: Promise<unknown>, action: (error: unknown) => void) {
    if (stream[kState].state === 'errored')
      action(stream[kState].storedError);
    else
      watchPromise.then(undefined, action);
  }

  function watchClosed(stream: any, watchPromise: Promise<unknown>, action: () => void) {
    if (stream[kState].state === 'closed')
      action();
    else
      watchPromise.then(action, () => {});
  }

  // PipeTo read request for the slow path
  class PipeToReadRequest {
    [kChunk](chunk: unknown) {
      // Per spec, pipeTo must queue a microtask for the write to avoid
      // synchronous write during enqueue().
      _queueMicrotask(() => {
        state.currentWrite = writableStreamDefaultWriterWrite(writer, chunk);
        setPromiseHandled(state.currentWrite);
        stepPromise.resolve!(false);
      });
    }
    [kClose]() {
      stepPromise.resolve!(true);
    }
    [kError](error: unknown) {
      stepPromise.reject!(error);
    }
  }

  let stepPromise: { resolve: ((v: boolean) => void) | null; reject: ((e: unknown) => void) | null } = {
    resolve: null,
    reject: null,
  };

  async function step(): Promise<boolean> {
    if (shuttingDown) return true;

    if (dest[kState].backpressure) {
      await writer[kState].ready.promise;
      if (shuttingDown) return true;
    }

    const controller = source[kState].controller;

    // Fast path: batch reads when data is buffered in a default controller.
    if (source[kState].state === 'readable' &&
        isReadableStreamDefaultController(controller) &&
        controller[kState].queue.length > 0) {

      while (controller[kState].queue.length > 0) {
        if (shuttingDown) return true;

        const chunk = dequeueValue(controller);

        if (controller[kState].closeRequested && !controller[kState].queue.length) {
          readableStreamDefaultControllerClearAlgorithms(controller);
          readableStreamClose(source);
        }

        // Write the chunk
        state.currentWrite = writableStreamDefaultWriterWrite(writer, chunk);
        setPromiseHandled(state.currentWrite);

        // Check backpressure after each write
        if (dest[kState].backpressure) {
          break;
        } else if (dest[kState].state !== 'writable' || writableStreamCloseQueuedOrInFlight(dest)) {
          break;
        }
      }

      // Trigger pull if needed after batch
      readableStreamDefaultControllerCallPullIfNeeded(controller);

      // Check if stream closed during batch
      if (source[kState].state === 'closed') {
        return true;
      }

      // Yield to microtask queue between batches
      return false;
    }

    // Slow path: use read request for async reads
    const { promise: readPromise, resolve: readResolve, reject: readReject } = Promise.withResolvers<boolean>();
    stepPromise = { resolve: readResolve, reject: readReject };
    readableStreamDefaultReaderRead(reader, new PipeToReadRequest());

    return readPromise;
  }

  async function run() {
    // Run until step resolves as true
    while (!await step());
  }

  if (signal !== undefined) {
    if (signal.aborted) {
      abortAlgorithm();
      return promise;
    }
    abortListener = abortAlgorithm;
    signal.addEventListener('abort', abortListener, { once: true });
  }

  setPromiseHandled(run());

  watchErrored(source, reader[kState].close.promise, (error: unknown) => {
    if (!preventAbort) {
      return shutdownWithAnAction(
        () => writableStreamAbort(dest, error),
        true,
        error,
      );
    }
    shutdown(true, error);
  });

  watchErrored(dest, writer[kState].close.promise, (error: unknown) => {
    if (!preventCancel) {
      return shutdownWithAnAction(
        () => readableStreamCancel(source, error),
        true,
        error,
      );
    }
    shutdown(true, error);
  });

  watchClosed(source, reader[kState].close.promise, () => {
    if (!preventClose) {
      return shutdownWithAnAction(
        () => writableStreamDefaultWriterCloseWithErrorPropagation(writer));
    }
    shutdown();
  });

  if (writableStreamCloseQueuedOrInFlight(dest) ||
      dest[kState].state === 'closed') {
    const error = new TypeError('Destination WritableStream is closed');
    if (!preventCancel) {
      shutdownWithAnAction(
        () => readableStreamCancel(source, error), true, error);
    } else {
      shutdown(true, error);
    }
  }

  return promise;
}

// ---- readableStreamDefaultTee ----

function readableStreamDefaultTee(stream: any, cloneForBranch2: boolean): [ReadableStream, ReadableStream] {
  const reader = new ReadableStreamDefaultReader(stream);
  let reading = false;
  let canceled1 = false;
  let canceled2 = false;
  let reason1: unknown;
  let reason2: unknown;
  let branch1: any;
  let branch2: any;
  const cancelPromise = Promise.withResolvers<unknown>();

  async function pullAlgorithm() {
    if (reading) return;
    reading = true;
    const readRequest = {
      [kChunk](value: unknown) {
        _queueMicrotask(() => {
          reading = false;
          const value1 = value;
          let value2 = value;
          if (!canceled2 && cloneForBranch2) {
            try {
              value2 = structuredClone(value2);
            } catch {
              // If structuredClone is not available, use the same reference
              // This is a best-effort approach for GJS environments
            }
          }
          if (!canceled1) {
            readableStreamDefaultControllerEnqueue(
              branch1[kState].controller,
              value1);
          }
          if (!canceled2) {
            readableStreamDefaultControllerEnqueue(
              branch2[kState].controller,
              value2);
          }
        });
      },
      [kClose]() {
        // Use a microtask to avoid race conditions.
        // The Node.js reference uses process.nextTick() here; we use
        // queueMicrotask which is the closest equivalent in GJS.
        _queueMicrotask(() => {
          reading = false;
          if (!canceled1)
            readableStreamDefaultControllerClose(branch1[kState].controller);
          if (!canceled2)
            readableStreamDefaultControllerClose(branch2[kState].controller);
          if (!canceled1 || !canceled2)
            cancelPromise.resolve(undefined);
        });
      },
      [kError]() {
        reading = false;
      },
    };
    readableStreamDefaultReaderRead(reader, readRequest);
  }

  function cancel1Algorithm(reason: unknown) {
    canceled1 = true;
    reason1 = reason;
    if (canceled2) {
      const compositeReason = [reason1, reason2];
      cancelPromise.resolve(readableStreamCancel(stream, compositeReason));
    }
    return cancelPromise.promise;
  }

  function cancel2Algorithm(reason: unknown) {
    canceled2 = true;
    reason2 = reason;
    if (canceled1) {
      const compositeReason = [reason1, reason2];
      cancelPromise.resolve(readableStreamCancel(stream, compositeReason));
    }
    return cancelPromise.promise;
  }

  branch1 = createReadableStream(nonOpStart, pullAlgorithm, cancel1Algorithm);
  branch2 = createReadableStream(nonOpStart, pullAlgorithm, cancel2Algorithm);

  reader[kState].close.promise.then(
    undefined,
    (error: unknown) => {
      readableStreamDefaultControllerError(branch1[kState].controller, error);
      readableStreamDefaultControllerError(branch2[kState].controller, error);
      if (!canceled1 || !canceled2)
        cancelPromise.resolve(undefined);
    },
  );

  return [branch1, branch2];
}

// ============================================================
// ---- BYOB / Byte Stream support ----
// ============================================================
//
// Spec: https://streams.spec.whatwg.org/#rbs-controller-class
// Reference impl: refs/deno/ext/web/06_streams.js:5887+
//
// Three new classes:
//   - ReadableByteStreamController — owns byte queue + pending pull-into
//     descriptors. `enqueue()` accepts ArrayBufferView; transfers the buffer.
//   - ReadableStreamBYOBReader      — reader.read(view, {min?}) returns a
//     view typed to match the input (Uint8Array, DataView, etc.)
//   - ReadableStreamBYOBRequest     — exposed via controller.byobRequest;
//     respond(bytesWritten) or respondWithNewView(view) by the underlying source.

// ---- BYOBReadIntoRequest ----

class BYOBReadIntoRequest {
  [kState]: { promise: Promise<{ value: ArrayBufferView | undefined; done: boolean }>; resolve: ((v: { value: ArrayBufferView | undefined; done: boolean }) => void) | undefined; reject: ((e: unknown) => void) | undefined };

  constructor() {
    this[kState] = Promise.withResolvers<{ value: ArrayBufferView | undefined; done: boolean }>();
  }

  [kChunk](view: ArrayBufferView) {
    this[kState].resolve?.({ value: view, done: false });
  }

  [kClose](view: ArrayBufferView | undefined) {
    this[kState].resolve?.({ value: view, done: true });
  }

  [kError](error: unknown) {
    this[kState].reject?.(error);
  }

  get promise() { return this[kState].promise; }
}

// ---- ReadableStreamBYOBReader ----

class ReadableStreamBYOBReader {
  [kType] = 'ReadableStreamBYOBReader';
  [kState]: any;

  constructor(stream: ReadableStream) {
    if (!isReadableStream(stream))
      throw new TypeError('Expected a ReadableStream');
    this[kState] = {
      readIntoRequests: [] as BYOBReadIntoRequest[],
      stream: undefined as ReadableStream | undefined,
      close: {
        promise: undefined as Promise<void> | undefined,
        resolve: undefined as (() => void) | undefined,
        reject: undefined as ((reason?: unknown) => void) | undefined,
      },
    };
    setupReadableStreamBYOBReader(this, stream);
  }

  read(view: ArrayBufferView, options: { min?: number } = {}): Promise<{ value: ArrayBufferView | undefined; done: boolean }> {
    if (!isReadableStreamBYOBReader(this))
      return Promise.reject(new TypeError('Invalid this'));
    if (view == null || typeof view !== 'object' || !ArrayBuffer.isView(view))
      return Promise.reject(new TypeError('view must be an ArrayBufferView'));

    const buffer = view.buffer;
    const byteLength = view.byteLength;

    if (byteLength === 0) {
      return Promise.reject(new TypeError('view must have non-zero byteLength'));
    }
    if ((buffer as ArrayBuffer).byteLength === 0) {
      if (isDetachedBuffer(buffer)) {
        return Promise.reject(new TypeError("view's buffer has been detached"));
      }
      return Promise.reject(new TypeError("view's buffer must have non-zero byteLength"));
    }

    const min = options?.min ?? 1;
    if (typeof min !== 'number' || min < 1 || !Number.isInteger(min) || Number.isNaN(min)) {
      return Promise.reject(new TypeError('options.min must be a positive integer'));
    }
    // Bound check: min in TypedArray elements, or in bytes for DataView.
    const tag = (view as unknown as { [Symbol.toStringTag]?: string })[Symbol.toStringTag];
    if (tag !== undefined && tag !== 'DataView') {
      if (min > (view as unknown as { length: number }).length) {
        return Promise.reject(new RangeError('options.min must be smaller or equal to view size'));
      }
    } else {
      if (min > byteLength) {
        return Promise.reject(new RangeError('options.min must be smaller or equal to view size'));
      }
    }

    if (this[kState].stream === undefined) {
      return Promise.reject(new TypeError('Reader has no associated stream'));
    }

    const readIntoRequest = new BYOBReadIntoRequest();
    readableStreamBYOBReaderRead(this, view, min, readIntoRequest);
    return readIntoRequest.promise;
  }

  releaseLock(): void {
    if (!isReadableStreamBYOBReader(this))
      throw new TypeError('Invalid this');
    if (this[kState].stream === undefined)
      return;
    readableStreamBYOBReaderRelease(this);
  }

  get closed(): Promise<void> {
    if (!isReadableStreamBYOBReader(this))
      return Promise.reject(new TypeError('Invalid this'));
    return this[kState].close.promise;
  }

  cancel(reason: unknown = undefined): Promise<void> {
    if (!isReadableStreamBYOBReader(this))
      return Promise.reject(new TypeError('Invalid this'));
    if (this[kState].stream === undefined) {
      return Promise.reject(new TypeError('Reader has no associated stream'));
    }
    return readableStreamReaderGenericCancel(this, reason);
  }

  get [Symbol.toStringTag]() {
    return 'ReadableStreamBYOBReader';
  }
}

// ---- ReadableStreamBYOBRequest ----

class ReadableStreamBYOBRequest {
  [kType] = 'ReadableStreamBYOBRequest';
  [kState]: any = {};

  constructor(skipThrowSymbol?: symbol) {
    if (skipThrowSymbol !== kSkipThrow) {
      throw new TypeError('Illegal constructor');
    }
  }

  get view(): ArrayBufferView | null {
    if (!isReadableStreamBYOBRequest(this)) throw new TypeError('Invalid this');
    return this[kState].view;
  }

  respond(bytesWritten: number): void {
    if (!isReadableStreamBYOBRequest(this)) throw new TypeError('Invalid this');
    if (this[kState].controller === undefined) {
      throw new TypeError('BYOB request has been invalidated');
    }
    bytesWritten = +bytesWritten;
    if (!Number.isInteger(bytesWritten) || bytesWritten < 0 || !Number.isFinite(bytesWritten)) {
      throw new RangeError('bytesWritten must be a non-negative integer');
    }
    const view = this[kState].view as ArrayBufferView;
    if (isDetachedBuffer(view.buffer)) {
      throw new TypeError("The BYOB request's buffer has been detached");
    }
    readableByteStreamControllerRespond(this[kState].controller, bytesWritten);
  }

  respondWithNewView(view: ArrayBufferView): void {
    if (!isReadableStreamBYOBRequest(this)) throw new TypeError('Invalid this');
    if (this[kState].controller === undefined) {
      throw new TypeError('BYOB request has been invalidated');
    }
    if (view == null || typeof view !== 'object' || !ArrayBuffer.isView(view)) {
      throw new TypeError('view must be an ArrayBufferView');
    }
    if (isDetachedBuffer(view.buffer)) {
      throw new TypeError("The given view's buffer has been detached");
    }
    readableByteStreamControllerRespondWithNewView(this[kState].controller, view);
  }

  get [Symbol.toStringTag]() {
    return 'ReadableStreamBYOBRequest';
  }
}

// ---- ReadableByteStreamController ----

class ReadableByteStreamController {
  [kType] = 'ReadableByteStreamController';
  [kState]: any = {};

  constructor(skipThrowSymbol?: symbol) {
    if (skipThrowSymbol !== kSkipThrow) {
      throw new TypeError('Illegal constructor');
    }
  }

  get byobRequest(): ReadableStreamBYOBRequest | null {
    if (!isReadableByteStreamController(this)) throw new TypeError('Invalid this');
    return readableByteStreamControllerGetBYOBRequest(this);
  }

  get desiredSize(): number | null {
    if (!isReadableByteStreamController(this)) throw new TypeError('Invalid this');
    return readableByteStreamControllerGetDesiredSize(this);
  }

  close(): void {
    if (!isReadableByteStreamController(this)) throw new TypeError('Invalid this');
    if (this[kState].closeRequested) {
      throw new TypeError('Close already requested');
    }
    if (this[kState].stream[kState].state !== 'readable') {
      throw new TypeError("Stream is not in a readable state");
    }
    readableByteStreamControllerClose(this);
  }

  enqueue(chunk: ArrayBufferView): void {
    if (!isReadableByteStreamController(this)) throw new TypeError('Invalid this');
    if (chunk == null || typeof chunk !== 'object' || !ArrayBuffer.isView(chunk)) {
      throw new TypeError('chunk must be an ArrayBufferView');
    }
    const byteLength = chunk.byteLength;
    if (byteLength === 0) {
      throw new TypeError('chunk length must be non-zero');
    }
    if ((chunk.buffer as ArrayBuffer).byteLength === 0) {
      throw new TypeError("chunk's buffer length must be non-zero");
    }
    if (this[kState].closeRequested) {
      throw new TypeError('Cannot enqueue after close has been requested');
    }
    if (this[kState].stream[kState].state !== 'readable') {
      throw new TypeError('Stream is not in a readable state');
    }
    readableByteStreamControllerEnqueue(this, chunk);
  }

  error(error: unknown = undefined): void {
    if (!isReadableByteStreamController(this)) throw new TypeError('Invalid this');
    readableByteStreamControllerError(this, error);
  }

  [kCancel](reason: unknown) {
    return readableByteStreamControllerCancelSteps(this, reason);
  }

  [kPull](readRequest: any) {
    readableByteStreamControllerPullSteps(this, readRequest);
  }

  [kRelease]() {
    // Per spec: a pending pull-into descriptor is downgraded to readerType:'none'
    // so subsequent enqueues add the partial data to the queue.
    if (this[kState].pendingPullIntos.length > 0) {
      const first = this[kState].pendingPullIntos[0];
      first.readerType = 'none';
      this[kState].pendingPullIntos = [first];
    }
  }

  get [Symbol.toStringTag]() {
    return 'ReadableByteStreamController';
  }
}

// ---- BYOB brand checks ----

const isReadableByteStreamController = isBrandCheck('ReadableByteStreamController');
const isReadableStreamBYOBReader = isBrandCheck('ReadableStreamBYOBReader');
const isReadableStreamBYOBRequest = isBrandCheck('ReadableStreamBYOBRequest');

// ---- BYOB stream/reader helpers ----

function readableStreamHasBYOBReader(stream: any): boolean {
  const { reader } = stream[kState];
  if (reader === undefined) return false;
  return reader[kState] !== undefined && reader[kType] === 'ReadableStreamBYOBReader';
}

function readableStreamGetNumReadIntoRequests(stream: any): number {
  return stream[kState].reader[kState].readIntoRequests.length;
}

function readableStreamAddReadIntoRequest(stream: any, readIntoRequest: BYOBReadIntoRequest): void {
  stream[kState].reader[kState].readIntoRequests.push(readIntoRequest);
}

function readableStreamFulfillReadIntoRequest(stream: any, chunk: ArrayBufferView, done: boolean): void {
  const { reader } = stream[kState];
  const readIntoRequest = reader[kState].readIntoRequests.shift();
  if (done)
    readIntoRequest[kClose](chunk);
  else
    readIntoRequest[kChunk](chunk);
}

function setupReadableStreamBYOBReader(reader: any, stream: any): void {
  if (isReadableStreamLocked(stream))
    throw new TypeError('ReadableStream is locked');
  if (!isReadableByteStreamController(stream[kState].controller)) {
    throw new TypeError('Cannot use a BYOB reader with a non-byte stream');
  }
  readableStreamReaderGenericInitialize(reader, stream);
  reader[kState].readIntoRequests = [];
}

function readableStreamBYOBReaderRead(reader: any, view: ArrayBufferView, min: number, readIntoRequest: BYOBReadIntoRequest): void {
  const { stream } = reader[kState];
  stream[kState].disturbed = true;
  if (stream[kState].state === 'errored') {
    readIntoRequest[kError](stream[kState].storedError);
  } else {
    readableByteStreamControllerPullInto(stream[kState].controller, view, min, readIntoRequest);
  }
}

function readableStreamBYOBReaderRelease(reader: any): void {
  readableStreamReaderGenericRelease(reader);
  const e = new TypeError('Reader was released');
  for (let n = 0; n < reader[kState].readIntoRequests.length; n++) {
    reader[kState].readIntoRequests[n][kError](e);
  }
  reader[kState].readIntoRequests = [];
}

// ---- Byte controller internals ----

function readableByteStreamControllerClearAlgorithms(controller: any): void {
  controller[kState].pullAlgorithm = undefined;
  controller[kState].cancelAlgorithm = undefined;
}

function readableByteStreamControllerClearPendingPullIntos(controller: any): void {
  readableByteStreamControllerInvalidateBYOBRequest(controller);
  controller[kState].pendingPullIntos = [];
}

function readableByteStreamControllerInvalidateBYOBRequest(controller: any): void {
  const req = controller[kState].byobRequest;
  if (req === null || req === undefined) return;
  req[kState].controller = undefined;
  req[kState].view = null;
  controller[kState].byobRequest = null;
}

function readableByteStreamControllerError(controller: any, e: unknown): void {
  const { stream } = controller[kState];
  if (stream[kState].state !== 'readable') return;
  readableByteStreamControllerClearPendingPullIntos(controller);
  resetQueue(controller);
  readableByteStreamControllerClearAlgorithms(controller);
  readableStreamError(stream, e);
}

function readableByteStreamControllerGetDesiredSize(controller: any): number | null {
  const state = controller[kState].stream[kState].state;
  if (state === 'errored') return null;
  if (state === 'closed') return 0;
  return controller[kState].highWaterMark - controller[kState].queueTotalSize;
}

function readableByteStreamControllerShouldCallPull(controller: any): boolean {
  const { stream } = controller[kState];
  if (stream[kState].state !== 'readable' || controller[kState].closeRequested || !controller[kState].started) {
    return false;
  }
  if (readableStreamHasDefaultReader(stream) && readableStreamGetNumReadRequests(stream) > 0) {
    return true;
  }
  if (readableStreamHasBYOBReader(stream) && readableStreamGetNumReadIntoRequests(stream) > 0) {
    return true;
  }
  const desiredSize = readableByteStreamControllerGetDesiredSize(controller);
  return desiredSize !== null && desiredSize > 0;
}

function readableByteStreamControllerCallPullIfNeeded(controller: any): void {
  if (!readableByteStreamControllerShouldCallPull(controller)) return;
  if (controller[kState].pulling) {
    controller[kState].pullAgain = true;
    return;
  }
  controller[kState].pulling = true;
  controller[kState].pullAlgorithm(controller).then(
    () => {
      controller[kState].pulling = false;
      if (controller[kState].pullAgain) {
        controller[kState].pullAgain = false;
        readableByteStreamControllerCallPullIfNeeded(controller);
      }
    },
    (e: unknown) => readableByteStreamControllerError(controller, e),
  );
}

function readableByteStreamControllerHandleQueueDrain(controller: any): void {
  if (controller[kState].queueTotalSize === 0 && controller[kState].closeRequested) {
    readableByteStreamControllerClearAlgorithms(controller);
    readableStreamClose(controller[kState].stream);
  } else {
    readableByteStreamControllerCallPullIfNeeded(controller);
  }
}

function readableByteStreamControllerEnqueueChunkToQueue(controller: any, buffer: ArrayBufferLike, byteOffset: number, byteLength: number): void {
  controller[kState].queue.push({ buffer, byteOffset, byteLength });
  controller[kState].queueTotalSize += byteLength;
}

function readableByteStreamControllerEnqueueClonedChunkToQueue(controller: any, buffer: ArrayBufferLike, byteOffset: number, byteLength: number): void {
  let cloneResult: ArrayBuffer;
  try {
    cloneResult = (buffer as ArrayBuffer).slice(byteOffset, byteOffset + byteLength);
  } catch (e) {
    readableByteStreamControllerError(controller, e);
    return;
  }
  readableByteStreamControllerEnqueueChunkToQueue(controller, cloneResult, 0, byteLength);
}

function readableByteStreamControllerEnqueueDetachedPullIntoToQueue(controller: any, pullIntoDescriptor: any): void {
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

function readableByteStreamControllerShiftPendingPullInto(controller: any): any {
  return controller[kState].pendingPullIntos.shift();
}

function readableByteStreamControllerFillHeadPullIntoDescriptor(controller: any, size: number, pullIntoDescriptor: any): void {
  pullIntoDescriptor.bytesFilled += size;
}

function readableByteStreamControllerConvertPullIntoDescriptor(pullIntoDescriptor: any): ArrayBufferView {
  const bytesFilled = pullIntoDescriptor.bytesFilled;
  const elementSize = pullIntoDescriptor.elementSize;
  const buffer = transferArrayBuffer(pullIntoDescriptor.buffer);
  pullIntoDescriptor.buffer = buffer;
  return new pullIntoDescriptor.viewConstructor(
    buffer,
    pullIntoDescriptor.byteOffset,
    bytesFilled / elementSize,
  );
}

function readableByteStreamControllerCommitPullIntoDescriptor(stream: any, pullIntoDescriptor: any): void {
  let done = false;
  if (stream[kState].state === 'closed') {
    done = true;
  }
  const filledView = readableByteStreamControllerConvertPullIntoDescriptor(pullIntoDescriptor);
  if (pullIntoDescriptor.readerType === 'default') {
    readableStreamFulfillReadRequest(stream, filledView, done);
  } else {
    readableStreamFulfillReadIntoRequest(stream, filledView, done);
  }
}

function readableByteStreamControllerFillPullIntoDescriptorFromQueue(controller: any, pullIntoDescriptor: any): boolean {
  const maxBytesToCopy = Math.min(
    controller[kState].queueTotalSize,
    pullIntoDescriptor.byteLength - pullIntoDescriptor.bytesFilled,
  );
  const maxBytesFilled = pullIntoDescriptor.bytesFilled + maxBytesToCopy;
  let totalBytesToCopyRemaining = maxBytesToCopy;
  let ready = false;
  const maxAlignedBytes = maxBytesFilled - (maxBytesFilled % pullIntoDescriptor.elementSize);
  if (maxAlignedBytes >= pullIntoDescriptor.minimumFill) {
    totalBytesToCopyRemaining = maxAlignedBytes - pullIntoDescriptor.bytesFilled;
    ready = true;
  }
  const queue = controller[kState].queue;
  while (totalBytesToCopyRemaining > 0) {
    const headOfQueue = queue[0];
    const bytesToCopy = Math.min(totalBytesToCopyRemaining, headOfQueue.byteLength);
    const destStart = pullIntoDescriptor.byteOffset + pullIntoDescriptor.bytesFilled;
    const destBuffer = new Uint8Array(pullIntoDescriptor.buffer, destStart, bytesToCopy);
    const srcBuffer = new Uint8Array(headOfQueue.buffer, headOfQueue.byteOffset, bytesToCopy);
    destBuffer.set(srcBuffer);

    if (headOfQueue.byteLength === bytesToCopy) {
      queue.shift();
    } else {
      headOfQueue.byteOffset += bytesToCopy;
      headOfQueue.byteLength -= bytesToCopy;
    }
    controller[kState].queueTotalSize -= bytesToCopy;
    readableByteStreamControllerFillHeadPullIntoDescriptor(controller, bytesToCopy, pullIntoDescriptor);
    totalBytesToCopyRemaining -= bytesToCopy;
  }
  return ready;
}

function readableByteStreamControllerFillReadRequestFromQueue(controller: any, readRequest: any): void {
  const entry = controller[kState].queue.shift();
  controller[kState].queueTotalSize -= entry.byteLength;
  readableByteStreamControllerHandleQueueDrain(controller);
  const view = new Uint8Array(entry.buffer, entry.byteOffset, entry.byteLength);
  readRequest[kChunk](view);
}

function readableByteStreamControllerProcessReadRequestsUsingQueue(controller: any): void {
  const reader = controller[kState].stream[kState].reader;
  while (reader[kState].readRequests.length !== 0) {
    if (controller[kState].queueTotalSize === 0) return;
    const readRequest = reader[kState].readRequests.shift();
    readableByteStreamControllerFillReadRequestFromQueue(controller, readRequest);
  }
}

function readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(controller: any): void {
  while (controller[kState].pendingPullIntos.length !== 0) {
    if (controller[kState].queueTotalSize === 0) return;
    const pullIntoDescriptor = controller[kState].pendingPullIntos[0];
    if (readableByteStreamControllerFillPullIntoDescriptorFromQueue(controller, pullIntoDescriptor)) {
      readableByteStreamControllerShiftPendingPullInto(controller);
      readableByteStreamControllerCommitPullIntoDescriptor(controller[kState].stream, pullIntoDescriptor);
    }
  }
}

function readableByteStreamControllerGetBYOBRequest(controller: any): ReadableStreamBYOBRequest | null {
  if (controller[kState].byobRequest === null && controller[kState].pendingPullIntos.length !== 0) {
    const firstDescriptor = controller[kState].pendingPullIntos[0];
    const view = new Uint8Array(
      firstDescriptor.buffer,
      firstDescriptor.byteOffset + firstDescriptor.bytesFilled,
      firstDescriptor.byteLength - firstDescriptor.bytesFilled,
    );
    const byobRequest = new ReadableStreamBYOBRequest(kSkipThrow);
    byobRequest[kState] = { controller, view };
    controller[kState].byobRequest = byobRequest;
  }
  return controller[kState].byobRequest;
}

function readableByteStreamControllerEnqueue(controller: any, chunk: ArrayBufferView): void {
  const { stream } = controller[kState];
  if (controller[kState].closeRequested || stream[kState].state !== 'readable') {
    return;
  }
  const buffer = chunk.buffer;
  const byteLength = chunk.byteLength;
  const byteOffset = chunk.byteOffset;

  if (isDetachedBuffer(buffer)) {
    throw new TypeError("chunk's buffer is detached");
  }
  const transferredBuffer = transferArrayBuffer(buffer);

  if (controller[kState].pendingPullIntos.length !== 0) {
    const firstPendingPullInto = controller[kState].pendingPullIntos[0];
    if (isDetachedBuffer(firstPendingPullInto.buffer)) {
      throw new TypeError("BYOB request's buffer has been detached");
    }
    readableByteStreamControllerInvalidateBYOBRequest(controller);
    firstPendingPullInto.buffer = transferArrayBuffer(firstPendingPullInto.buffer);
    if (firstPendingPullInto.readerType === 'none') {
      readableByteStreamControllerEnqueueDetachedPullIntoToQueue(controller, firstPendingPullInto);
    }
  }

  if (readableStreamHasDefaultReader(stream)) {
    readableByteStreamControllerProcessReadRequestsUsingQueue(controller);
    if (readableStreamGetNumReadRequests(stream) === 0) {
      readableByteStreamControllerEnqueueChunkToQueue(controller, transferredBuffer, byteOffset, byteLength);
    } else {
      if (controller[kState].pendingPullIntos.length !== 0) {
        readableByteStreamControllerShiftPendingPullInto(controller);
      }
      const transferredView = new Uint8Array(transferredBuffer, byteOffset, byteLength);
      readableStreamFulfillReadRequest(stream, transferredView, false);
    }
  } else if (readableStreamHasBYOBReader(stream)) {
    readableByteStreamControllerEnqueueChunkToQueue(controller, transferredBuffer, byteOffset, byteLength);
    readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(controller);
  } else {
    readableByteStreamControllerEnqueueChunkToQueue(controller, transferredBuffer, byteOffset, byteLength);
  }
  readableByteStreamControllerCallPullIfNeeded(controller);
}

function readableByteStreamControllerClose(controller: any): void {
  const { stream } = controller[kState];
  if (controller[kState].closeRequested || stream[kState].state !== 'readable') return;
  if (controller[kState].queueTotalSize > 0) {
    controller[kState].closeRequested = true;
    return;
  }
  if (controller[kState].pendingPullIntos.length !== 0) {
    const firstPendingPullInto = controller[kState].pendingPullIntos[0];
    if (firstPendingPullInto.bytesFilled % firstPendingPullInto.elementSize !== 0) {
      const e = new TypeError('Insufficient bytes to fill elements in the given buffer');
      readableByteStreamControllerError(controller, e);
      throw e;
    }
  }
  readableByteStreamControllerClearAlgorithms(controller);
  readableStreamClose(stream);
}

function readableByteStreamControllerPullInto(controller: any, view: ArrayBufferView, min: number, readIntoRequest: BYOBReadIntoRequest): void {
  const stream = controller[kState].stream;
  const tag = (view as unknown as { [Symbol.toStringTag]?: string })[Symbol.toStringTag];
  let ctor: any;
  let elementSize: number;
  if (tag === undefined || tag === 'DataView') {
    ctor = DataView;
    elementSize = 1;
  } else {
    const c = typedArrayConstructorByTag(tag);
    if (!c) {
      readIntoRequest[kError](new TypeError(`Unsupported typed array: ${tag}`));
      return;
    }
    ctor = c;
    elementSize = elementSizeByTag(tag);
  }
  const buffer = view.buffer;
  const byteLength = view.byteLength;
  const byteOffset = view.byteOffset;

  const minimumFill = min * elementSize;

  let transferredBuffer: ArrayBufferLike;
  try {
    transferredBuffer = transferArrayBuffer(buffer);
  } catch (e) {
    readIntoRequest[kError](e);
    return;
  }

  const pullIntoDescriptor = {
    buffer: transferredBuffer,
    bufferByteLength: (transferredBuffer as ArrayBuffer).byteLength,
    byteOffset,
    byteLength,
    bytesFilled: 0,
    minimumFill,
    elementSize,
    viewConstructor: ctor,
    readerType: 'byob' as 'byob' | 'default' | 'none',
  };

  if (controller[kState].pendingPullIntos.length !== 0) {
    controller[kState].pendingPullIntos.push(pullIntoDescriptor);
    readableStreamAddReadIntoRequest(stream, readIntoRequest);
    return;
  }
  if (stream[kState].state === 'closed') {
    const emptyView = new ctor(pullIntoDescriptor.buffer, pullIntoDescriptor.byteOffset, 0);
    readIntoRequest[kClose](emptyView);
    return;
  }
  if (controller[kState].queueTotalSize > 0) {
    if (readableByteStreamControllerFillPullIntoDescriptorFromQueue(controller, pullIntoDescriptor)) {
      const filledView = readableByteStreamControllerConvertPullIntoDescriptor(pullIntoDescriptor);
      readableByteStreamControllerHandleQueueDrain(controller);
      readIntoRequest[kChunk](filledView);
      return;
    }
    if (controller[kState].closeRequested) {
      const e = new TypeError('Insufficient bytes to fill elements in the given buffer');
      readableByteStreamControllerError(controller, e);
      readIntoRequest[kError](e);
      return;
    }
  }
  controller[kState].pendingPullIntos.push(pullIntoDescriptor);
  readableStreamAddReadIntoRequest(stream, readIntoRequest);
  readableByteStreamControllerCallPullIfNeeded(controller);
}

function readableByteStreamControllerRespond(controller: any, bytesWritten: number): void {
  const firstDescriptor = controller[kState].pendingPullIntos[0];
  const state = controller[kState].stream[kState].state;
  if (state === 'closed') {
    if (bytesWritten !== 0) {
      throw new TypeError('bytesWritten must be 0 when calling respond() on a closed stream');
    }
  } else {
    if (bytesWritten === 0) {
      throw new TypeError('bytesWritten must be greater than 0 when calling respond() on a readable stream');
    }
    if (firstDescriptor.bytesFilled + bytesWritten > firstDescriptor.byteLength) {
      throw new RangeError('bytesWritten out of range');
    }
  }
  firstDescriptor.buffer = transferArrayBuffer(firstDescriptor.buffer);
  readableByteStreamControllerRespondInternal(controller, bytesWritten);
}

function readableByteStreamControllerRespondWithNewView(controller: any, view: ArrayBufferView): void {
  const firstDescriptor = controller[kState].pendingPullIntos[0];
  const state = controller[kState].stream[kState].state;
  const byteLength = view.byteLength;
  const byteOffset = view.byteOffset;
  const buffer = view.buffer;

  if (state === 'closed') {
    if (byteLength !== 0) {
      throw new TypeError("view's length must be 0 when calling respondWithNewView() on a closed stream");
    }
  } else {
    if (byteLength === 0) {
      throw new TypeError("view's length must be greater than 0 when calling respondWithNewView() on a readable stream");
    }
  }
  if (firstDescriptor.byteOffset + firstDescriptor.bytesFilled !== byteOffset) {
    throw new RangeError('The region specified by view does not match byobRequest');
  }
  if (firstDescriptor.bufferByteLength !== (buffer as ArrayBuffer).byteLength) {
    throw new RangeError('The buffer of view has different capacity than byobRequest');
  }
  if (firstDescriptor.bytesFilled + byteLength > firstDescriptor.byteLength) {
    throw new RangeError('The region specified by view is larger than byobRequest');
  }
  firstDescriptor.buffer = transferArrayBuffer(buffer);
  readableByteStreamControllerRespondInternal(controller, byteLength);
}

function readableByteStreamControllerRespondInternal(controller: any, bytesWritten: number): void {
  const firstDescriptor = controller[kState].pendingPullIntos[0];
  readableByteStreamControllerInvalidateBYOBRequest(controller);
  const state = controller[kState].stream[kState].state;
  if (state === 'closed') {
    readableByteStreamControllerRespondInClosedState(controller, firstDescriptor);
  } else {
    readableByteStreamControllerRespondInReadableState(controller, bytesWritten, firstDescriptor);
  }
  readableByteStreamControllerCallPullIfNeeded(controller);
}

function readableByteStreamControllerRespondInClosedState(controller: any, firstDescriptor: any): void {
  if (firstDescriptor.readerType === 'none') {
    readableByteStreamControllerShiftPendingPullInto(controller);
  }
  const stream = controller[kState].stream;
  if (readableStreamHasBYOBReader(stream)) {
    while (readableStreamGetNumReadIntoRequests(stream) > 0) {
      const pullIntoDescriptor = readableByteStreamControllerShiftPendingPullInto(controller);
      readableByteStreamControllerCommitPullIntoDescriptor(stream, pullIntoDescriptor);
    }
  }
}

function readableByteStreamControllerRespondInReadableState(controller: any, bytesWritten: number, pullIntoDescriptor: any): void {
  readableByteStreamControllerFillHeadPullIntoDescriptor(controller, bytesWritten, pullIntoDescriptor);
  if (pullIntoDescriptor.readerType === 'none') {
    readableByteStreamControllerEnqueueDetachedPullIntoToQueue(controller, pullIntoDescriptor);
    readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(controller);
    return;
  }
  if (pullIntoDescriptor.bytesFilled < pullIntoDescriptor.minimumFill) {
    return;
  }
  readableByteStreamControllerShiftPendingPullInto(controller);
  const remainderSize = pullIntoDescriptor.bytesFilled % pullIntoDescriptor.elementSize;
  if (remainderSize > 0) {
    const end = pullIntoDescriptor.byteOffset + pullIntoDescriptor.bytesFilled;
    readableByteStreamControllerEnqueueClonedChunkToQueue(controller, pullIntoDescriptor.buffer, end - remainderSize, remainderSize);
  }
  pullIntoDescriptor.bytesFilled -= remainderSize;
  readableByteStreamControllerCommitPullIntoDescriptor(controller[kState].stream, pullIntoDescriptor);
  readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(controller);
}

function readableByteStreamControllerCancelSteps(controller: any, reason: unknown): Promise<void> {
  readableByteStreamControllerClearPendingPullIntos(controller);
  resetQueue(controller);
  const result = controller[kState].cancelAlgorithm(reason);
  readableByteStreamControllerClearAlgorithms(controller);
  return result;
}

function readableByteStreamControllerPullSteps(controller: any, readRequest: any): void {
  const stream = controller[kState].stream;
  if (controller[kState].queueTotalSize > 0) {
    readableByteStreamControllerFillReadRequestFromQueue(controller, readRequest);
    return;
  }
  const autoAllocateChunkSize = controller[kState].autoAllocateChunkSize;
  if (autoAllocateChunkSize !== undefined) {
    let buffer: ArrayBuffer;
    try {
      buffer = new ArrayBuffer(autoAllocateChunkSize);
    } catch (e) {
      readRequest[kError](e);
      return;
    }
    const pullIntoDescriptor = {
      buffer,
      bufferByteLength: autoAllocateChunkSize,
      byteOffset: 0,
      byteLength: autoAllocateChunkSize,
      bytesFilled: 0,
      minimumFill: 1,
      elementSize: 1,
      viewConstructor: Uint8Array,
      readerType: 'default' as 'default' | 'byob' | 'none',
    };
    controller[kState].pendingPullIntos.push(pullIntoDescriptor);
  }
  readableStreamAddReadRequest(stream, readRequest);
  readableByteStreamControllerCallPullIfNeeded(controller);
}

// ---- Byte controller setup ----

function setupReadableByteStreamController(
  stream: any,
  controller: any,
  startAlgorithm: Function,
  pullAlgorithm: Function,
  cancelAlgorithm: Function,
  highWaterMark: number,
  autoAllocateChunkSize: number | undefined,
): void {
  controller[kState] = {
    cancelAlgorithm,
    closeRequested: false,
    highWaterMark,
    pullAgain: false,
    pullAlgorithm,
    pulling: false,
    queue: [] as { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }[],
    queueTotalSize: 0,
    started: false,
    stream,
    byobRequest: null as ReadableStreamBYOBRequest | null,
    pendingPullIntos: [] as any[],
    autoAllocateChunkSize,
  };
  stream[kState].controller = controller;

  const startResult = startAlgorithm();
  new Promise((r) => r(startResult)).then(
    () => {
      controller[kState].started = true;
      readableByteStreamControllerCallPullIfNeeded(controller);
    },
    (error) => readableByteStreamControllerError(controller, error),
  );
}

function setupReadableByteStreamControllerFromSource(stream: any, source: any, highWaterMark: number): void {
  const controller = new ReadableByteStreamController(kSkipThrow);
  const start = source?.start;
  const pull = source?.pull;
  const cancel = source?.cancel;
  const autoAllocateChunkSize = source?.autoAllocateChunkSize;
  if (autoAllocateChunkSize !== undefined) {
    if (autoAllocateChunkSize === 0 || !Number.isInteger(autoAllocateChunkSize) || autoAllocateChunkSize < 0) {
      throw new TypeError('autoAllocateChunkSize must be a positive integer');
    }
  }
  const startAlgorithm = start
    ? start.bind(source, controller)
    : nonOpStart;
  const pullAlgorithm = pull
    ? createPromiseCallback('source.pull', pull, source)
    : nonOpPull;
  const cancelAlgorithm = cancel
    ? createPromiseCallback('source.cancel', cancel, source)
    : nonOpCancel;

  setupReadableByteStreamController(
    stream,
    controller,
    startAlgorithm,
    pullAlgorithm,
    cancelAlgorithm,
    highWaterMark,
    autoAllocateChunkSize,
  );
}

// ---- Byte stream tee ----
//
// Simplified tee implementation: pipe both branches through default readers
// over byte streams. The spec defines a full BYOB-aware tee that shares
// pending pull-into descriptors; we implement the simpler "default read"
// branch which the spec allows when `cloneForBranch2` is false. Sufficient
// for typical Fetch/ReadableStream consumers; full BYOB tee is a follow-up.
function readableByteStreamTee(stream: any): [ReadableStream, ReadableStream] {
  const reader = new ReadableStreamDefaultReader(stream);
  let reading = false;
  let canceled1 = false;
  let canceled2 = false;
  let reason1: unknown = undefined;
  let reason2: unknown = undefined;
  const cancelPromise = Promise.withResolvers<void>();

  let branch1!: ReadableStream;
  let branch2!: ReadableStream;
  let branch1Controller: any;
  let branch2Controller: any;

  function pullAlgorithm(): Promise<void> {
    if (reading) return Promise.resolve();
    reading = true;
    reader.read().then(
      (result) => {
        reading = false;
        if (result.done) {
          if (!canceled1) branch1Controller.close();
          if (!canceled2) branch2Controller.close();
          return;
        }
        const chunk = result.value as ArrayBufferView;
        // Both branches get an independent Uint8Array view of the same data,
        // sliced into a copy so that respondWithNewView on one doesn't affect
        // the other.
        const copy = new Uint8Array(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
        if (!canceled1) branch1Controller.enqueue(copy);
        if (!canceled2) branch2Controller.enqueue(new Uint8Array(copy));
      },
      () => {},
    );
    return Promise.resolve();
  }

  branch1 = new ReadableStream({
    type: 'bytes',
    pull: pullAlgorithm,
    cancel(reason: unknown) {
      canceled1 = true;
      reason1 = reason;
      if (canceled2) {
        const composite = [reason1, reason2];
        const p = readableStreamCancel(stream, composite);
        cancelPromise.resolve();
        return p;
      }
      return cancelPromise.promise;
    },
  } as any);
  branch2 = new ReadableStream({
    type: 'bytes',
    pull: pullAlgorithm,
    cancel(reason: unknown) {
      canceled2 = true;
      reason2 = reason;
      if (canceled1) {
        const composite = [reason1, reason2];
        const p = readableStreamCancel(stream, composite);
        cancelPromise.resolve();
        return p;
      }
      return cancelPromise.promise;
    },
  } as any);
  branch1Controller = branch1[kState].controller;
  branch2Controller = branch2[kState].controller;

  // Propagate stream errors to both branches.
  reader.closed.catch((e: unknown) => {
    branch1Controller.error(e);
    branch2Controller.error(e);
    if (!canceled1 || !canceled2) {
      cancelPromise.resolve();
    }
  });

  return [branch1, branch2];
}

// ---- Exports ----

export {
  ReadableStream,
  ReadableStreamDefaultReader,
  ReadableStreamDefaultController,
  ReadableStreamBYOBReader,
  ReadableStreamBYOBRequest,
  ReadableByteStreamController,

  isReadableStream,
  isReadableStreamLocked,
  isReadableStreamDefaultReader,
  isReadableStreamDefaultController,
  isReadableStreamBYOBReader,
  isReadableStreamBYOBRequest,
  isReadableByteStreamController,

  readableStreamCancel,
  readableStreamClose,
  readableStreamError,
  readableStreamDefaultControllerClose,
  readableStreamDefaultControllerEnqueue,
  readableStreamDefaultControllerError,
  readableStreamDefaultControllerGetDesiredSize,
  readableStreamDefaultControllerCanCloseOrEnqueue,
  readableStreamDefaultControllerHasBackpressure,
  setupReadableStreamDefaultController,
  setupReadableByteStreamController,
  createReadableStream,
};
