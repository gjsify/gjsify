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
        throw new RangeError('Byte streams not yet supported (use default controller)');
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

  getReader(options: any = {}): ReadableStreamDefaultReader {
    if (!isReadableStream(this)) throw new TypeError('Invalid this');
    if (options != null && typeof options !== 'object') {
      throw new TypeError('options must be an object');
    }
    const mode = options?.mode;
    if (mode === undefined)
      return new ReadableStreamDefaultReader(this);
    if (`${mode}` === 'byob')
      throw new RangeError('BYOB readers not yet supported');
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

// ---- Exports ----

export {
  ReadableStream,
  ReadableStreamDefaultReader,
  ReadableStreamDefaultController,

  isReadableStream,
  isReadableStreamLocked,
  isReadableStreamDefaultReader,
  isReadableStreamDefaultController,

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
  createReadableStream,
};
