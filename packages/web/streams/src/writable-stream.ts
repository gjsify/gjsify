// WHATWG Streams — WritableStream
// Adapted from refs/node/lib/internal/webstreams/writablestream.js
// Copyright (c) Node.js contributors. MIT license.
// Modifications: Removed primordials, transfer, inspect, Node.js error codes

import {
  kState, kType,
  isBrandCheck,
  createPromiseCallback,
  dequeueValue,
  enqueueValueWithSize,
  extractHighWaterMark,
  extractSizeAlgorithm,
  peekQueueValue,
  resetQueue,
  setPromiseHandled,
  nonOpCancel,
  nonOpStart,
  nonOpWrite,
} from './util.js';

// Use native AbortController if available, otherwise a minimal shim
const _AbortController = typeof globalThis.AbortController === 'function'
  ? globalThis.AbortController
  : class AbortControllerShim {
    signal = { aborted: false, reason: undefined as any, addEventListener() {}, removeEventListener() {} };
    abort(reason?: any) {
      (this.signal as any).aborted = true;
      (this.signal as any).reason = reason;
    }
  } as any;

const kAbort = Symbol('kAbort');
const kCloseSentinel = Symbol('kCloseSentinel');
const kError = Symbol('kError');
const kSkipThrow = Symbol('kSkipThrow');

// ---- WritableStream ----

export class WritableStream {
  [kType] = 'WritableStream';
  [kState]: any;

  constructor(sink: any = {}, strategy: any = {}) {
    if (sink != null && typeof sink !== 'object') {
      throw new TypeError('sink must be an object');
    }
    if (strategy != null && typeof strategy !== 'object') {
      throw new TypeError('strategy must be an object');
    }
    const type = sink?.type;
    if (type !== undefined) {
      throw new RangeError(`Invalid type: ${type}`);
    }

    this[kState] = createWritableStreamState();

    const size = extractSizeAlgorithm(strategy?.size);
    const highWaterMark = extractHighWaterMark(strategy?.highWaterMark, 1);

    setupWritableStreamDefaultControllerFromSink(this, sink, highWaterMark, size);
  }

  get locked(): boolean {
    if (!isWritableStream(this)) throw new TypeError('Invalid this');
    return isWritableStreamLocked(this);
  }

  abort(reason?: any): Promise<void> {
    if (!isWritableStream(this)) return Promise.reject(new TypeError('Invalid this'));
    if (isWritableStreamLocked(this)) {
      return Promise.reject(new TypeError('WritableStream is locked'));
    }
    return writableStreamAbort(this, reason);
  }

  close(): Promise<void> {
    if (!isWritableStream(this)) return Promise.reject(new TypeError('Invalid this'));
    if (isWritableStreamLocked(this)) {
      return Promise.reject(new TypeError('WritableStream is locked'));
    }
    if (writableStreamCloseQueuedOrInFlight(this)) {
      return Promise.reject(new TypeError('Failure closing WritableStream'));
    }
    return writableStreamClose(this);
  }

  getWriter(): WritableStreamDefaultWriter {
    if (!isWritableStream(this)) throw new TypeError('Invalid this');
    return new WritableStreamDefaultWriter(this);
  }

  get [Symbol.toStringTag]() {
    return 'WritableStream';
  }
}

// ---- WritableStreamDefaultWriter ----

export class WritableStreamDefaultWriter {
  [kType] = 'WritableStreamDefaultWriter';
  [kState]: any;

  constructor(stream: WritableStream) {
    if (!isWritableStream(stream)) {
      throw new TypeError('Expected a WritableStream');
    }
    this[kState] = {
      stream: undefined,
      close: { promise: undefined, resolve: undefined, reject: undefined },
      ready: { promise: undefined, resolve: undefined, reject: undefined },
    };
    setupWritableStreamDefaultWriter(this, stream);
  }

  get closed(): Promise<void> {
    if (!isWritableStreamDefaultWriter(this)) return Promise.reject(new TypeError('Invalid this'));
    return this[kState].close.promise;
  }

  get desiredSize(): number | null {
    if (!isWritableStreamDefaultWriter(this)) throw new TypeError('Invalid this');
    if (this[kState].stream === undefined) {
      throw new TypeError('Writer is not bound to a WritableStream');
    }
    return writableStreamDefaultWriterGetDesiredSize(this);
  }

  get ready(): Promise<void> {
    if (!isWritableStreamDefaultWriter(this)) return Promise.reject(new TypeError('Invalid this'));
    return this[kState].ready.promise;
  }

  abort(reason?: any): Promise<void> {
    if (!isWritableStreamDefaultWriter(this)) return Promise.reject(new TypeError('Invalid this'));
    if (this[kState].stream === undefined) {
      return Promise.reject(new TypeError('Writer is not bound to a WritableStream'));
    }
    return writableStreamDefaultWriterAbort(this, reason);
  }

  close(): Promise<void> {
    if (!isWritableStreamDefaultWriter(this)) return Promise.reject(new TypeError('Invalid this'));
    const { stream } = this[kState];
    if (stream === undefined) {
      return Promise.reject(new TypeError('Writer is not bound to a WritableStream'));
    }
    if (writableStreamCloseQueuedOrInFlight(stream)) {
      return Promise.reject(new TypeError('Failure to close WritableStream'));
    }
    return writableStreamDefaultWriterClose(this);
  }

  releaseLock(): void {
    if (!isWritableStreamDefaultWriter(this)) throw new TypeError('Invalid this');
    const { stream } = this[kState];
    if (stream === undefined) return;
    writableStreamDefaultWriterRelease(this);
  }

  write(chunk?: any): Promise<void> {
    if (!isWritableStreamDefaultWriter(this)) return Promise.reject(new TypeError('Invalid this'));
    if (this[kState].stream === undefined) {
      return Promise.reject(new TypeError('Writer is not bound to a WritableStream'));
    }
    return writableStreamDefaultWriterWrite(this, chunk);
  }

  get [Symbol.toStringTag]() {
    return 'WritableStreamDefaultWriter';
  }
}

// ---- WritableStreamDefaultController ----

export class WritableStreamDefaultController {
  [kType] = 'WritableStreamDefaultController';
  [kState]: any;

  constructor(skipThrowSymbol?: symbol) {
    if (skipThrowSymbol !== kSkipThrow) {
      throw new TypeError('Illegal constructor');
    }
  }

  [kAbort](reason: any) {
    const result = this[kState].abortAlgorithm(reason);
    writableStreamDefaultControllerClearAlgorithms(this);
    return result;
  }

  [kError]() {
    resetQueue(this);
  }

  get signal(): AbortSignal {
    if (!isWritableStreamDefaultController(this)) throw new TypeError('Invalid this');
    return this[kState].abortController.signal;
  }

  error(error?: any): void {
    if (!isWritableStreamDefaultController(this)) throw new TypeError('Invalid this');
    if (this[kState].stream[kState].state !== 'writable') return;
    writableStreamDefaultControllerError(this, error);
  }

  get [Symbol.toStringTag]() {
    return 'WritableStreamDefaultController';
  }
}

// ---- Brand checks ----

export const isWritableStream = isBrandCheck('WritableStream');
export const isWritableStreamDefaultWriter = isBrandCheck('WritableStreamDefaultWriter');
export const isWritableStreamDefaultController = isBrandCheck('WritableStreamDefaultController');

// ---- Internal state factory ----

function createWritableStreamState() {
  return {
    close: Promise.withResolvers<void>(),
    closeRequest: { promise: undefined as any, resolve: undefined as any, reject: undefined as any },
    inFlightWriteRequest: { promise: undefined as any, resolve: undefined as any, reject: undefined as any },
    inFlightCloseRequest: { promise: undefined as any, resolve: undefined as any, reject: undefined as any },
    pendingAbortRequest: {
      abort: { promise: undefined as any, resolve: undefined as any, reject: undefined as any },
      reason: undefined as any,
      wasAlreadyErroring: false,
    },
    backpressure: false,
    controller: undefined as any,
    state: 'writable' as string,
    storedError: undefined as any,
    writeRequests: [] as any[],
    writer: undefined as any,
  };
}

// ---- Internal functions ----

export function isWritableStreamLocked(stream: any): boolean {
  return stream[kState].writer !== undefined;
}

function setupWritableStreamDefaultWriter(writer: any, stream: any): void {
  if (isWritableStreamLocked(stream)) {
    throw new TypeError('WritableStream is locked');
  }
  writer[kState].stream = stream;
  stream[kState].writer = writer;
  switch (stream[kState].state) {
    case 'writable':
      if (!writableStreamCloseQueuedOrInFlight(stream) && stream[kState].backpressure) {
        writer[kState].ready = Promise.withResolvers<void>();
      } else {
        writer[kState].ready = {
          promise: Promise.resolve(),
          resolve: undefined,
          reject: undefined,
        };
      }
      writer[kState].close = Promise.withResolvers<void>();
      break;
    case 'erroring':
      writer[kState].ready = {
        promise: Promise.reject(stream[kState].storedError),
        resolve: undefined,
        reject: undefined,
      };
      setPromiseHandled(writer[kState].ready.promise);
      writer[kState].close = Promise.withResolvers<void>();
      break;
    case 'closed':
      writer[kState].ready = {
        promise: Promise.resolve(),
        resolve: undefined,
        reject: undefined,
      };
      writer[kState].close = {
        promise: Promise.resolve(),
        resolve: undefined,
        reject: undefined,
      };
      break;
    default:
      writer[kState].ready = {
        promise: Promise.reject(stream[kState].storedError),
        resolve: undefined,
        reject: undefined,
      };
      writer[kState].close = {
        promise: Promise.reject(stream[kState].storedError),
        resolve: undefined,
        reject: undefined,
      };
      setPromiseHandled(writer[kState].ready.promise);
      setPromiseHandled(writer[kState].close.promise);
  }
}

export function writableStreamAbort(stream: any, reason?: any): Promise<void> {
  const { state, controller } = stream[kState];
  if (state === 'closed' || state === 'errored') return Promise.resolve();

  controller[kState].abortController.abort(reason);

  if (stream[kState].pendingAbortRequest.abort.promise !== undefined) {
    return stream[kState].pendingAbortRequest.abort.promise;
  }

  let wasAlreadyErroring = false;
  if (state === 'erroring') {
    wasAlreadyErroring = true;
    reason = undefined;
  }

  const abort = Promise.withResolvers<void>();
  stream[kState].pendingAbortRequest = { abort, reason, wasAlreadyErroring };

  if (!wasAlreadyErroring) writableStreamStartErroring(stream, reason);

  return abort.promise;
}

export function writableStreamClose(stream: any): Promise<void> {
  const { state, writer, backpressure, controller } = stream[kState];
  if (state === 'closed' || state === 'errored') {
    return Promise.reject(new TypeError('WritableStream is closed'));
  }

  stream[kState].closeRequest = Promise.withResolvers<void>();
  const { promise } = stream[kState].closeRequest;
  if (writer !== undefined && backpressure && state === 'writable') {
    writer[kState].ready.resolve?.();
  }
  writableStreamDefaultControllerClose(controller);
  return promise;
}

function writableStreamUpdateBackpressure(stream: any, backpressure: boolean): void {
  const { writer } = stream[kState];
  if (writer !== undefined && stream[kState].backpressure !== backpressure) {
    if (backpressure) {
      writer[kState].ready = Promise.withResolvers<void>();
    } else {
      writer[kState].ready.resolve?.();
    }
  }
  stream[kState].backpressure = backpressure;
}

function writableStreamStartErroring(stream: any, reason: any): void {
  const { controller, writer } = stream[kState];
  stream[kState].state = 'erroring';
  stream[kState].storedError = reason;
  if (writer !== undefined) {
    writableStreamDefaultWriterEnsureReadyPromiseRejected(writer, reason);
  }
  if (!writableStreamHasOperationMarkedInFlight(stream) && controller[kState].started) {
    writableStreamFinishErroring(stream);
  }
}

function writableStreamRejectCloseAndClosedPromiseIfNeeded(stream: any): void {
  if (stream[kState].closeRequest.promise !== undefined) {
    stream[kState].closeRequest.reject?.(stream[kState].storedError);
    stream[kState].closeRequest = { promise: undefined, resolve: undefined, reject: undefined };
  }
  setPromiseHandled(stream[kState].close.promise);
  stream[kState].close.reject?.(stream[kState].storedError);

  const { writer } = stream[kState];
  if (writer !== undefined) {
    setPromiseHandled(writer[kState].close.promise);
    writer[kState].close.reject?.(stream[kState].storedError);
  }
}

function writableStreamMarkFirstWriteRequestInFlight(stream: any): void {
  const writeRequest = stream[kState].writeRequests.shift();
  stream[kState].inFlightWriteRequest = writeRequest;
}

function writableStreamMarkCloseRequestInFlight(stream: any): void {
  stream[kState].inFlightCloseRequest = stream[kState].closeRequest;
  stream[kState].closeRequest = { promise: undefined, resolve: undefined, reject: undefined };
}

function writableStreamHasOperationMarkedInFlight(stream: any): boolean {
  return stream[kState].inFlightWriteRequest.promise !== undefined ||
    stream[kState].inFlightCloseRequest.promise !== undefined;
}

function writableStreamFinishInFlightWriteWithError(stream: any, error: any): void {
  stream[kState].inFlightWriteRequest.reject?.(error);
  stream[kState].inFlightWriteRequest = { promise: undefined, resolve: undefined, reject: undefined };
  writableStreamDealWithRejection(stream, error);
}

function writableStreamFinishInFlightWrite(stream: any): void {
  stream[kState].inFlightWriteRequest.resolve?.();
  stream[kState].inFlightWriteRequest = { promise: undefined, resolve: undefined, reject: undefined };
}

function writableStreamFinishInFlightCloseWithError(stream: any, error: any): void {
  stream[kState].inFlightCloseRequest.reject?.(error);
  stream[kState].inFlightCloseRequest = { promise: undefined, resolve: undefined, reject: undefined };
  if (stream[kState].pendingAbortRequest.abort.promise !== undefined) {
    stream[kState].pendingAbortRequest.abort.reject?.(error);
    stream[kState].pendingAbortRequest = {
      abort: { promise: undefined, resolve: undefined, reject: undefined },
      reason: undefined,
      wasAlreadyErroring: false,
    };
  }
  writableStreamDealWithRejection(stream, error);
}

function writableStreamFinishInFlightClose(stream: any): void {
  stream[kState].inFlightCloseRequest.resolve?.();
  stream[kState].inFlightCloseRequest = { promise: undefined, resolve: undefined, reject: undefined };
  if (stream[kState].state === 'erroring') {
    stream[kState].storedError = undefined;
    if (stream[kState].pendingAbortRequest.abort.promise !== undefined) {
      stream[kState].pendingAbortRequest.abort.resolve?.();
      stream[kState].pendingAbortRequest = {
        abort: { promise: undefined, resolve: undefined, reject: undefined },
        reason: undefined,
        wasAlreadyErroring: false,
      };
    }
  }
  stream[kState].state = 'closed';
  if (stream[kState].writer !== undefined) {
    stream[kState].writer[kState].close.resolve?.();
  }
  stream[kState].close.resolve?.();
}

function writableStreamFinishErroring(stream: any): void {
  stream[kState].state = 'errored';
  stream[kState].controller[kError]();
  const storedError = stream[kState].storedError;
  for (const req of stream[kState].writeRequests) {
    req.reject?.(storedError);
  }
  stream[kState].writeRequests = [];

  if (stream[kState].pendingAbortRequest.abort.promise === undefined) {
    writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
    return;
  }

  const abortRequest = stream[kState].pendingAbortRequest;
  stream[kState].pendingAbortRequest = {
    abort: { promise: undefined, resolve: undefined, reject: undefined },
    reason: undefined,
    wasAlreadyErroring: false,
  };
  if (abortRequest.wasAlreadyErroring) {
    abortRequest.abort.reject?.(storedError);
    writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
    return;
  }
  stream[kState].controller[kAbort](abortRequest.reason).then(
    () => {
      abortRequest.abort.resolve?.();
      writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
    },
    (error: any) => {
      abortRequest.abort.reject?.(error);
      writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
    },
  );
}

function writableStreamDealWithRejection(stream: any, error: any): void {
  if (stream[kState].state === 'writable') {
    writableStreamStartErroring(stream, error);
    return;
  }
  writableStreamFinishErroring(stream);
}

export function writableStreamCloseQueuedOrInFlight(stream: any): boolean {
  return stream[kState].closeRequest.promise !== undefined ||
    stream[kState].inFlightCloseRequest.promise !== undefined;
}

function writableStreamAddWriteRequest(stream: any): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  stream[kState].writeRequests.push({ promise, resolve, reject });
  return promise;
}

export function writableStreamDefaultWriterWrite(writer: any, chunk: any): Promise<void> {
  const { stream } = writer[kState];
  const { controller } = stream[kState];
  const chunkSize = writableStreamDefaultControllerGetChunkSize(controller, chunk);
  if (stream !== writer[kState].stream) {
    return Promise.reject(new TypeError('Mismatched WritableStreams'));
  }
  const { state } = stream[kState];
  if (state === 'errored') return Promise.reject(stream[kState].storedError);
  if (writableStreamCloseQueuedOrInFlight(stream) || state === 'closed') {
    return Promise.reject(new TypeError('WritableStream is closed'));
  }
  if (state === 'erroring') return Promise.reject(stream[kState].storedError);

  const promise = writableStreamAddWriteRequest(stream);
  writableStreamDefaultControllerWrite(controller, chunk, chunkSize);
  return promise;
}

export function writableStreamDefaultWriterRelease(writer: any): void {
  const { stream } = writer[kState];
  const releasedError = new TypeError('Writer has been released');
  writableStreamDefaultWriterEnsureReadyPromiseRejected(writer, releasedError);
  writableStreamDefaultWriterEnsureClosedPromiseRejected(writer, releasedError);
  stream[kState].writer = undefined;
  writer[kState].stream = undefined;
}

function writableStreamDefaultWriterGetDesiredSize(writer: any): number | null {
  const { stream } = writer[kState];
  switch (stream[kState].state) {
    case 'errored':
    case 'erroring':
      return null;
    case 'closed':
      return 0;
  }
  return writableStreamDefaultControllerGetDesiredSize(stream[kState].controller);
}

function writableStreamDefaultWriterEnsureReadyPromiseRejected(writer: any, error: any): void {
  if (writer[kState].ready.reject) {
    writer[kState].ready.reject(error);
    writer[kState].ready.resolve = undefined;
    writer[kState].ready.reject = undefined;
  } else {
    writer[kState].ready = {
      promise: Promise.reject(error),
      resolve: undefined,
      reject: undefined,
    };
  }
  setPromiseHandled(writer[kState].ready.promise);
}

function writableStreamDefaultWriterEnsureClosedPromiseRejected(writer: any, error: any): void {
  if (writer[kState].close.reject) {
    writer[kState].close.reject(error);
    writer[kState].close.resolve = undefined;
    writer[kState].close.reject = undefined;
  } else {
    writer[kState].close = {
      promise: Promise.reject(error),
      resolve: undefined,
      reject: undefined,
    };
  }
  setPromiseHandled(writer[kState].close.promise);
}

export function writableStreamDefaultWriterCloseWithErrorPropagation(writer: any): Promise<void> {
  const { stream } = writer[kState];
  const { state } = stream[kState];
  if (writableStreamCloseQueuedOrInFlight(stream) || state === 'closed') {
    return Promise.resolve();
  }
  if (state === 'errored') return Promise.reject(stream[kState].storedError);
  return writableStreamDefaultWriterClose(writer);
}

function writableStreamDefaultWriterClose(writer: any): Promise<void> {
  return writableStreamClose(writer[kState].stream);
}

function writableStreamDefaultWriterAbort(writer: any, reason: any): Promise<void> {
  return writableStreamAbort(writer[kState].stream, reason);
}

// ---- Controller internals ----

function writableStreamDefaultControllerWrite(controller: any, chunk: any, chunkSize: number): void {
  try {
    enqueueValueWithSize(controller, chunk, chunkSize);
  } catch (error) {
    writableStreamDefaultControllerErrorIfNeeded(controller, error);
    return;
  }
  const { stream } = controller[kState];
  if (!writableStreamCloseQueuedOrInFlight(stream) && stream[kState].state === 'writable') {
    writableStreamUpdateBackpressure(stream, writableStreamDefaultControllerGetBackpressure(controller));
  }
  writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
}

function writableStreamDefaultControllerProcessWrite(controller: any, chunk: any): void {
  const { stream, writeAlgorithm } = controller[kState];
  writableStreamMarkFirstWriteRequestInFlight(stream);

  writeAlgorithm(chunk, controller).then(
    () => {
      writableStreamFinishInFlightWrite(stream);
      const { state } = stream[kState];
      dequeueValue(controller);
      if (!writableStreamCloseQueuedOrInFlight(stream) && state === 'writable') {
        writableStreamUpdateBackpressure(stream, writableStreamDefaultControllerGetBackpressure(controller));
      }
      writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
    },
    (error: any) => {
      if (stream[kState].state === 'writable') {
        writableStreamDefaultControllerClearAlgorithms(controller);
      }
      writableStreamFinishInFlightWriteWithError(stream, error);
    },
  );
}

function writableStreamDefaultControllerProcessClose(controller: any): void {
  const { closeAlgorithm, queue, stream } = controller[kState];
  writableStreamMarkCloseRequestInFlight(stream);
  dequeueValue(controller);
  const sinkClosePromise = closeAlgorithm();
  writableStreamDefaultControllerClearAlgorithms(controller);
  sinkClosePromise.then(
    () => writableStreamFinishInFlightClose(stream),
    (error: any) => writableStreamFinishInFlightCloseWithError(stream, error),
  );
}

function writableStreamDefaultControllerGetDesiredSize(controller: any): number {
  return controller[kState].highWaterMark - controller[kState].queueTotalSize;
}

function writableStreamDefaultControllerGetChunkSize(controller: any, chunk: any): number {
  const { stream, sizeAlgorithm } = controller[kState];
  if (sizeAlgorithm === undefined) return 1;
  try {
    return sizeAlgorithm(chunk);
  } catch (error) {
    writableStreamDefaultControllerErrorIfNeeded(controller, error);
    return 1;
  }
}

export function writableStreamDefaultControllerErrorIfNeeded(controller: any, error: any): void {
  if (controller[kState].stream[kState].state === 'writable') {
    writableStreamDefaultControllerError(controller, error);
  }
}

function writableStreamDefaultControllerError(controller: any, error: any): void {
  writableStreamDefaultControllerClearAlgorithms(controller);
  writableStreamStartErroring(controller[kState].stream, error);
}

function writableStreamDefaultControllerClose(controller: any): void {
  enqueueValueWithSize(controller, kCloseSentinel, 0);
  writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
}

function writableStreamDefaultControllerClearAlgorithms(controller: any): void {
  controller[kState].writeAlgorithm = undefined;
  controller[kState].closeAlgorithm = undefined;
  controller[kState].abortAlgorithm = undefined;
  controller[kState].sizeAlgorithm = undefined;
}

function writableStreamDefaultControllerGetBackpressure(controller: any): boolean {
  return writableStreamDefaultControllerGetDesiredSize(controller) <= 0;
}

function writableStreamDefaultControllerAdvanceQueueIfNeeded(controller: any): void {
  const { queue, started, stream } = controller[kState];
  if (!started || stream[kState].inFlightWriteRequest.promise !== undefined) return;
  if (stream[kState].state === 'erroring') {
    writableStreamFinishErroring(stream);
    return;
  }
  if (!queue.length) return;
  const value = peekQueueValue(controller);
  if (value === kCloseSentinel) {
    writableStreamDefaultControllerProcessClose(controller);
  } else {
    writableStreamDefaultControllerProcessWrite(controller, value);
  }
}

// ---- Setup functions ----

function setupWritableStreamDefaultControllerFromSink(
  stream: any, sink: any, highWaterMark: number, sizeAlgorithm: (chunk: any) => number,
): void {
  const controller = new WritableStreamDefaultController(kSkipThrow);
  const start = sink?.start;
  const write = sink?.write;
  const close = sink?.close;
  const abort = sink?.abort;
  const startAlgorithm = start ? start.bind(sink, controller) : nonOpStart;
  const writeAlgorithm = write ? createPromiseCallback('sink.write', write, sink) : nonOpWrite;
  const closeAlgorithm = close ? createPromiseCallback('sink.close', close, sink) : nonOpCancel;
  const abortAlgorithm = abort ? createPromiseCallback('sink.abort', abort, sink) : nonOpCancel;
  setupWritableStreamDefaultController(
    stream, controller, startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm, highWaterMark, sizeAlgorithm,
  );
}

function setupWritableStreamDefaultController(
  stream: any, controller: any,
  startAlgorithm: Function, writeAlgorithm: Function,
  closeAlgorithm: Function, abortAlgorithm: Function,
  highWaterMark: number, sizeAlgorithm: (chunk: any) => number,
): void {
  controller[kState] = {
    abortAlgorithm,
    closeAlgorithm,
    highWaterMark,
    queue: [] as any[],
    queueTotalSize: 0,
    abortController: new _AbortController(),
    sizeAlgorithm,
    started: false,
    stream,
    writeAlgorithm,
  };
  stream[kState].controller = controller;

  writableStreamUpdateBackpressure(stream, writableStreamDefaultControllerGetBackpressure(controller));

  const startResult = startAlgorithm();
  new Promise((r) => r(startResult)).then(
    () => {
      controller[kState].started = true;
      writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
    },
    (error) => {
      controller[kState].started = true;
      writableStreamDealWithRejection(stream, error);
    },
  );
}

// ---- Internal factory (used by TransformStream) ----

export function createWritableStream(
  start: Function, write: Function, close: Function, abort: Function,
  highWaterMark = 1, size: (chunk: any) => number = () => 1,
): WritableStream {
  const stream = Object.create(WritableStream.prototype);
  stream[kType] = 'WritableStream';
  stream[kState] = createWritableStreamState();

  const controller = new WritableStreamDefaultController(kSkipThrow);
  setupWritableStreamDefaultController(
    stream, controller, start, write, close, abort, highWaterMark, size,
  );
  return stream;
}
