// WHATWG Streams — TransformStream
// Adapted from refs/node/lib/internal/webstreams/transformstream.js
// Copyright (c) Node.js contributors. MIT license.
// Modifications: Removed primordials, transfer, inspect, Node.js error codes

import {
  kState, kType,
  isBrandCheck,
  createPromiseCallback,
  extractHighWaterMark,
  extractSizeAlgorithm,
  nonOpFlush,
  nonOpCancel,
} from './util.js';

import {
  createReadableStream,
  readableStreamDefaultControllerCanCloseOrEnqueue,
  readableStreamDefaultControllerClose,
  readableStreamDefaultControllerEnqueue,
  readableStreamDefaultControllerError,
  readableStreamDefaultControllerGetDesiredSize,
  readableStreamDefaultControllerHasBackpressure,
} from './readable-stream.js';

import {
  createWritableStream,
  writableStreamDefaultControllerErrorIfNeeded,
} from './writable-stream.js';

const kSkipThrow = Symbol('kSkipThrow');

// ---- TransformStream ----

export class TransformStream {
  [kType] = 'TransformStream';
  [kState]: any;

  constructor(
    transformer: any = {},
    writableStrategy: any = {},
    readableStrategy: any = {},
  ) {
    if (transformer != null && typeof transformer !== 'object') {
      throw new TypeError('transformer must be an object');
    }
    if (writableStrategy != null && typeof writableStrategy !== 'object') {
      throw new TypeError('writableStrategy must be an object');
    }
    if (readableStrategy != null && typeof readableStrategy !== 'object') {
      throw new TypeError('readableStrategy must be an object');
    }

    const readableType = transformer?.readableType;
    const writableType = transformer?.writableType;
    const start = transformer?.start;

    if (readableType !== undefined) {
      throw new RangeError(`Invalid readableType: ${readableType}`);
    }
    if (writableType !== undefined) {
      throw new RangeError(`Invalid writableType: ${writableType}`);
    }

    const readableHighWaterMark = extractHighWaterMark(readableStrategy?.highWaterMark, 0);
    const readableSize = extractSizeAlgorithm(readableStrategy?.size);
    const writableHighWaterMark = extractHighWaterMark(writableStrategy?.highWaterMark, 1);
    const writableSize = extractSizeAlgorithm(writableStrategy?.size);

    const startPromise = Promise.withResolvers<void>();

    initializeTransformStream(
      this,
      startPromise,
      writableHighWaterMark,
      writableSize,
      readableHighWaterMark,
      readableSize,
    );

    setupTransformStreamDefaultControllerFromTransformer(this, transformer);

    if (start !== undefined) {
      startPromise.resolve(start.call(transformer, this[kState].controller) as unknown as void);
    } else {
      startPromise.resolve();
    }
  }

  get readable(): any {
    if (!isTransformStream(this)) throw new TypeError('Invalid this');
    return this[kState].readable;
  }

  get writable(): any {
    if (!isTransformStream(this)) throw new TypeError('Invalid this');
    return this[kState].writable;
  }

  get [Symbol.toStringTag]() {
    return 'TransformStream';
  }
}

// ---- TransformStreamDefaultController ----

export class TransformStreamDefaultController {
  [kType] = 'TransformStreamDefaultController';
  [kState]: any;

  constructor(skipThrowSymbol?: symbol) {
    if (skipThrowSymbol !== kSkipThrow) {
      throw new TypeError('Illegal constructor');
    }
  }

  get desiredSize(): number | null {
    if (!isTransformStreamDefaultController(this)) throw new TypeError('Invalid this');
    const { stream } = this[kState];
    const { readable } = stream[kState];
    const readableController = readable[kState].controller;
    return readableStreamDefaultControllerGetDesiredSize(readableController);
  }

  enqueue(chunk?: any): void {
    if (!isTransformStreamDefaultController(this)) throw new TypeError('Invalid this');
    transformStreamDefaultControllerEnqueue(this, chunk);
  }

  error(reason?: unknown): void {
    if (!isTransformStreamDefaultController(this)) throw new TypeError('Invalid this');
    transformStreamDefaultControllerError(this, reason);
  }

  terminate(): void {
    if (!isTransformStreamDefaultController(this)) throw new TypeError('Invalid this');
    transformStreamDefaultControllerTerminate(this);
  }

  get [Symbol.toStringTag]() {
    return 'TransformStreamDefaultController';
  }
}

// ---- Brand checks ----

export const isTransformStream = isBrandCheck('TransformStream');
export const isTransformStreamDefaultController = isBrandCheck('TransformStreamDefaultController');

// ---- Internal functions ----

async function defaultTransformAlgorithm(chunk: unknown, controller: any) {
  transformStreamDefaultControllerEnqueue(controller, chunk);
}

function initializeTransformStream(
  stream: any,
  startPromise: any,
  writableHighWaterMark: number,
  writableSizeAlgorithm: (chunk: any) => number,
  readableHighWaterMark: number,
  readableSizeAlgorithm: (chunk: any) => number,
): void {
  const startAlgorithm = () => startPromise.promise;

  const writable = createWritableStream(
    startAlgorithm,
    (chunk: unknown) => transformStreamDefaultSinkWriteAlgorithm(stream, chunk),
    () => transformStreamDefaultSinkCloseAlgorithm(stream),
    (reason: unknown) => transformStreamDefaultSinkAbortAlgorithm(stream, reason),
    writableHighWaterMark,
    writableSizeAlgorithm,
  );

  const readable = createReadableStream(
    startAlgorithm,
    () => transformStreamDefaultSourcePullAlgorithm(stream),
    (reason: unknown) => transformStreamDefaultSourceCancelAlgorithm(stream, reason),
    readableHighWaterMark,
    readableSizeAlgorithm,
  );

  stream[kState] = {
    readable,
    writable,
    controller: undefined,
    backpressure: undefined as boolean | undefined,
    backpressureChange: {
      promise: undefined as Promise<void> | undefined,
      resolve: undefined as ((value: void | PromiseLike<void>) => void) | undefined,
      reject: undefined as ((reason?: unknown) => void) | undefined,
    },
  };

  transformStreamSetBackpressure(stream, true);
}

function transformStreamError(stream: any, error: unknown): void {
  const { readable } = stream[kState];
  readableStreamDefaultControllerError(readable[kState].controller, error);
  transformStreamErrorWritableAndUnblockWrite(stream, error);
}

function transformStreamErrorWritableAndUnblockWrite(stream: any, error: unknown): void {
  const { controller, writable } = stream[kState];
  transformStreamDefaultControllerClearAlgorithms(controller);
  writableStreamDefaultControllerErrorIfNeeded(writable[kState].controller, error);
  transformStreamUnblockWrite(stream);
}

function transformStreamUnblockWrite(stream: any): void {
  if (stream[kState].backpressure) {
    transformStreamSetBackpressure(stream, false);
  }
}

function transformStreamSetBackpressure(stream: any, backpressure: boolean): void {
  if (stream[kState].backpressureChange.promise !== undefined) {
    stream[kState].backpressureChange.resolve?.();
  }
  stream[kState].backpressureChange = Promise.withResolvers<void>();
  stream[kState].backpressure = backpressure;
}

function setupTransformStreamDefaultController(
  stream: any,
  controller: any,
  transformAlgorithm: Function,
  flushAlgorithm: Function,
  cancelAlgorithm: Function,
): void {
  controller[kState] = {
    stream,
    transformAlgorithm,
    flushAlgorithm,
    cancelAlgorithm,
    finishPromise: undefined as Promise<void> | undefined,
  };
  stream[kState].controller = controller;
}

function setupTransformStreamDefaultControllerFromTransformer(
  stream: any,
  transformer: any,
): void {
  const controller = new TransformStreamDefaultController(kSkipThrow);
  const transform = transformer?.transform;
  const flush = transformer?.flush;
  const cancel = transformer?.cancel;
  const transformAlgorithm = transform
    ? createPromiseCallback('transformer.transform', transform, transformer)
    : defaultTransformAlgorithm;
  const flushAlgorithm = flush
    ? createPromiseCallback('transformer.flush', flush, transformer)
    : nonOpFlush;
  const cancelAlgorithm = cancel
    ? createPromiseCallback('transformer.cancel', cancel, transformer)
    : nonOpCancel;

  setupTransformStreamDefaultController(
    stream, controller, transformAlgorithm, flushAlgorithm, cancelAlgorithm,
  );
}

function transformStreamDefaultControllerClearAlgorithms(controller: any): void {
  controller[kState].transformAlgorithm = undefined;
  controller[kState].flushAlgorithm = undefined;
  controller[kState].cancelAlgorithm = undefined;
}

function transformStreamDefaultControllerEnqueue(controller: any, chunk: any): void {
  const { stream } = controller[kState];
  const { readable } = stream[kState];
  const readableController = readable[kState].controller;
  if (!readableStreamDefaultControllerCanCloseOrEnqueue(readableController)) {
    throw new TypeError('Unable to enqueue');
  }
  try {
    readableStreamDefaultControllerEnqueue(readableController, chunk);
  } catch (error: unknown) {
    transformStreamErrorWritableAndUnblockWrite(stream, error);
    throw readable[kState].storedError;
  }
  const backpressure = readableStreamDefaultControllerHasBackpressure(readableController);
  if (backpressure !== stream[kState].backpressure) {
    transformStreamSetBackpressure(stream, true);
  }
}

function transformStreamDefaultControllerError(controller: any, error: unknown): void {
  transformStreamError(controller[kState].stream, error);
}

async function transformStreamDefaultControllerPerformTransform(controller: any, chunk: any): Promise<void> {
  try {
    const transformAlgorithm = controller[kState].transformAlgorithm;
    if (transformAlgorithm === undefined) return;
    return await transformAlgorithm(chunk, controller);
  } catch (error) {
    transformStreamError(controller[kState].stream, error);
    throw error;
  }
}

function transformStreamDefaultControllerTerminate(controller: any): void {
  const { stream } = controller[kState];
  const { readable } = stream[kState];
  readableStreamDefaultControllerClose(readable[kState].controller);
  transformStreamErrorWritableAndUnblockWrite(stream, new TypeError('TransformStream has been terminated'));
}

function transformStreamDefaultSinkWriteAlgorithm(stream: any, chunk: unknown): Promise<void> {
  const { controller } = stream[kState];
  if (stream[kState].backpressure) {
    const backpressureChange = stream[kState].backpressureChange.promise;
    return backpressureChange.then(() => {
      const { writable } = stream[kState];
      if (writable[kState].state === 'erroring') {
        throw writable[kState].storedError;
      }
      return transformStreamDefaultControllerPerformTransform(controller, chunk);
    });
  }
  return transformStreamDefaultControllerPerformTransform(controller, chunk);
}

async function transformStreamDefaultSinkAbortAlgorithm(stream: any, reason: unknown): Promise<void> {
  const { controller, readable } = stream[kState];
  if (controller[kState].finishPromise !== undefined) {
    return controller[kState].finishPromise;
  }
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  controller[kState].finishPromise = promise;
  const cancelPromise = controller[kState].cancelAlgorithm(reason);
  transformStreamDefaultControllerClearAlgorithms(controller);
  cancelPromise.then(
    () => {
      if (readable[kState].state === 'errored') {
        reject(readable[kState].storedError);
      } else {
        readableStreamDefaultControllerError(readable[kState].controller, reason);
        resolve();
      }
    },
    (error: unknown) => {
      readableStreamDefaultControllerError(readable[kState].controller, error);
      reject(error);
    },
  );
  return controller[kState].finishPromise;
}

function transformStreamDefaultSinkCloseAlgorithm(stream: any): Promise<void> {
  const { readable, controller } = stream[kState];
  if (controller[kState].finishPromise !== undefined) {
    return controller[kState].finishPromise;
  }
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  controller[kState].finishPromise = promise;
  const flushPromise = controller[kState].flushAlgorithm(controller);
  transformStreamDefaultControllerClearAlgorithms(controller);
  flushPromise.then(
    () => {
      if (readable[kState].state === 'errored') {
        reject(readable[kState].storedError);
      } else {
        readableStreamDefaultControllerClose(readable[kState].controller);
        resolve();
      }
    },
    (error: unknown) => {
      readableStreamDefaultControllerError(readable[kState].controller, error);
      reject(error);
    },
  );
  return controller[kState].finishPromise;
}

function transformStreamDefaultSourcePullAlgorithm(stream: any): Promise<void> {
  transformStreamSetBackpressure(stream, false);
  return stream[kState].backpressureChange.promise;
}

function transformStreamDefaultSourceCancelAlgorithm(stream: any, reason: unknown): Promise<void> {
  const { controller, writable } = stream[kState];
  if (controller[kState].finishPromise !== undefined) {
    return controller[kState].finishPromise;
  }
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  controller[kState].finishPromise = promise;
  const cancelPromise = controller[kState].cancelAlgorithm(reason);
  transformStreamDefaultControllerClearAlgorithms(controller);
  cancelPromise.then(
    () => {
      if (writable[kState].state === 'errored') {
        reject(writable[kState].storedError);
      } else {
        writableStreamDefaultControllerErrorIfNeeded(writable[kState].controller, reason);
        transformStreamUnblockWrite(stream);
        resolve();
      }
    },
    (error: unknown) => {
      writableStreamDefaultControllerErrorIfNeeded(writable[kState].controller, error);
      transformStreamUnblockWrite(stream);
      reject(error);
    },
  );
  return controller[kState].finishPromise;
}
