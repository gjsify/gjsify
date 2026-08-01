// WHATWG Streams — TransformStream
// Adapted from refs/node/lib/internal/webstreams/transformstream.js
// Copyright (c) Node.js contributors. MIT license.
// Modifications: Removed primordials, transfer, inspect, Node.js error codes

import {
    kState,
    kType,
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

import { createWritableStream, writableStreamDefaultControllerErrorIfNeeded } from './writable-stream.js';
import type { ReadableStream, ReadableStreamDefaultController } from './readable-stream.js';
import type { WritableStream } from './writable-stream.js';

const kSkipThrow = Symbol('kSkipThrow');

// ---- Internal state-bag shapes ----
//
// Both TransformStream classes keep their internals under the `kState` symbol.
// These structural interfaces let the internal helpers be typed against the
// concrete objects instead of `any`. The chunk type is `unknown` — the
// polyfill is value-agnostic; lib.dom's ambient `TransformStream<I, O>`
// declaration provides the generic public surface.

// Algorithm callables (from `createPromiseCallback`/`nonOp*`) — variadic and
// promise-returning, typed without the `any` keyword.
type PromiseAlgorithm = (...args: unknown[]) => Promise<unknown>;

// The polyfill follows the current spec, which adds a `cancel` member to the
// transformer object — not present in this lib.dom version's `Transformer`.
// Extend it locally so the `cancel` algorithm can be read off the transformer.
interface StreamTransformer extends Transformer {
    cancel?: (reason?: unknown) => unknown;
}

interface BackpressureChange {
    promise: Promise<void> | undefined;
    resolve: ((value: void | PromiseLike<void>) => void) | undefined;
    reject: ((reason?: unknown) => void) | undefined;
}

interface TransformStreamState {
    readable: ReadableStream;
    writable: WritableStream;
    controller: TransformStreamDefaultController | undefined;
    backpressure: boolean | undefined;
    backpressureChange: BackpressureChange;
}

interface TransformControllerState {
    stream: TransformStream;
    transformAlgorithm: PromiseAlgorithm | undefined;
    flushAlgorithm: PromiseAlgorithm | undefined;
    cancelAlgorithm: PromiseAlgorithm | undefined;
    finishPromise: Promise<void> | undefined;
}

// ---- TransformStream ----

export class TransformStream {
    [kType] = 'TransformStream';
    [kState]!: TransformStreamState;

    constructor(
        transformer: StreamTransformer | null = {},
        writableStrategy: QueuingStrategy = {},
        readableStrategy: QueuingStrategy = {},
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

    // oxlint-disable-next-line typescript/no-explicit-any -- matches lib.dom TransformStream.readable (ReadableStream<O>); `any` lets consumers (e.g. TextDecoderStream) assign the polyfill stream to a typed lib.dom ReadableStream
    get readable(): any {
        if (!isTransformStream(this)) throw new TypeError('Invalid this');
        return this[kState].readable;
    }

    // oxlint-disable-next-line typescript/no-explicit-any -- matches lib.dom TransformStream.writable (WritableStream<I>); `any` lets consumers (e.g. TextDecoderStream) assign the polyfill stream to a typed lib.dom WritableStream
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
    [kState]!: TransformControllerState;

    constructor(skipThrowSymbol?: symbol) {
        if (skipThrowSymbol !== kSkipThrow) {
            throw new TypeError('Illegal constructor');
        }
    }

    get desiredSize(): number | null {
        if (!isTransformStreamDefaultController(this)) throw new TypeError('Invalid this');
        const { stream } = this[kState];
        const { readable } = stream[kState];
        const readableController = readable[kState].controller as ReadableStreamDefaultController;
        return readableStreamDefaultControllerGetDesiredSize(readableController);
    }

    enqueue(chunk?: unknown): void {
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

export const isTransformStream = isBrandCheck<TransformStream>('TransformStream');
export const isTransformStreamDefaultController = isBrandCheck<TransformStreamDefaultController>(
    'TransformStreamDefaultController',
);

// ---- Internal functions ----

async function defaultTransformAlgorithm(chunk: unknown, controller: TransformStreamDefaultController) {
    transformStreamDefaultControllerEnqueue(controller, chunk);
}

function initializeTransformStream(
    stream: TransformStream,
    startPromise: PromiseWithResolvers<void>,
    writableHighWaterMark: number,
    writableSizeAlgorithm: (chunk: unknown) => number,
    readableHighWaterMark: number,
    readableSizeAlgorithm: (chunk: unknown) => number,
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

function transformStreamError(stream: TransformStream, error: unknown): void {
    const { readable } = stream[kState];
    readableStreamDefaultControllerError(readable[kState].controller as ReadableStreamDefaultController, error);
    transformStreamErrorWritableAndUnblockWrite(stream, error);
}

function transformStreamErrorWritableAndUnblockWrite(stream: TransformStream, error: unknown): void {
    const { controller, writable } = stream[kState];
    transformStreamDefaultControllerClearAlgorithms(controller);
    writableStreamDefaultControllerErrorIfNeeded(writable[kState].controller, error);
    transformStreamUnblockWrite(stream);
}

function transformStreamUnblockWrite(stream: TransformStream): void {
    if (stream[kState].backpressure) {
        transformStreamSetBackpressure(stream, false);
    }
}

function transformStreamSetBackpressure(stream: TransformStream, backpressure: boolean): void {
    if (stream[kState].backpressureChange.promise !== undefined) {
        stream[kState].backpressureChange.resolve?.();
    }
    stream[kState].backpressureChange = Promise.withResolvers<void>();
    stream[kState].backpressure = backpressure;
}

function setupTransformStreamDefaultController(
    stream: TransformStream,
    controller: TransformStreamDefaultController,
    transformAlgorithm: PromiseAlgorithm,
    flushAlgorithm: PromiseAlgorithm,
    cancelAlgorithm: PromiseAlgorithm,
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
    stream: TransformStream,
    transformer: StreamTransformer | null,
): void {
    const controller = new TransformStreamDefaultController(kSkipThrow);
    const transform = transformer?.transform;
    const flush = transformer?.flush;
    const cancel = transformer?.cancel;
    const transformAlgorithm = transform
        ? createPromiseCallback('transformer.transform', transform, transformer)
        : defaultTransformAlgorithm;
    const flushAlgorithm = flush ? createPromiseCallback('transformer.flush', flush, transformer) : nonOpFlush;
    const cancelAlgorithm = cancel ? createPromiseCallback('transformer.cancel', cancel, transformer) : nonOpCancel;

    setupTransformStreamDefaultController(stream, controller, transformAlgorithm, flushAlgorithm, cancelAlgorithm);
}

function transformStreamDefaultControllerClearAlgorithms(controller: TransformStreamDefaultController): void {
    controller[kState].transformAlgorithm = undefined;
    controller[kState].flushAlgorithm = undefined;
    controller[kState].cancelAlgorithm = undefined;
}

function transformStreamDefaultControllerEnqueue(controller: TransformStreamDefaultController, chunk: unknown): void {
    const { stream } = controller[kState];
    const { readable } = stream[kState];
    const readableController = readable[kState].controller as ReadableStreamDefaultController;
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

function transformStreamDefaultControllerError(controller: TransformStreamDefaultController, error: unknown): void {
    transformStreamError(controller[kState].stream, error);
}

async function transformStreamDefaultControllerPerformTransform(
    controller: TransformStreamDefaultController,
    chunk: unknown,
): Promise<void> {
    try {
        const transformAlgorithm = controller[kState].transformAlgorithm;
        if (transformAlgorithm === undefined) return;
        await transformAlgorithm(chunk, controller);
    } catch (error) {
        transformStreamError(controller[kState].stream, error);
        throw error;
    }
}

function transformStreamDefaultControllerTerminate(controller: TransformStreamDefaultController): void {
    const { stream } = controller[kState];
    const { readable } = stream[kState];
    readableStreamDefaultControllerClose(readable[kState].controller as ReadableStreamDefaultController);
    transformStreamErrorWritableAndUnblockWrite(stream, new TypeError('TransformStream has been terminated'));
}

function transformStreamDefaultSinkWriteAlgorithm(stream: TransformStream, chunk: unknown): Promise<void> {
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

async function transformStreamDefaultSinkAbortAlgorithm(stream: TransformStream, reason: unknown): Promise<void> {
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
                readableStreamDefaultControllerError(
                    readable[kState].controller as ReadableStreamDefaultController,
                    reason,
                );
                resolve();
            }
        },
        (error: unknown) => {
            readableStreamDefaultControllerError(readable[kState].controller as ReadableStreamDefaultController, error);
            reject(error);
        },
    );
    return controller[kState].finishPromise;
}

function transformStreamDefaultSinkCloseAlgorithm(stream: TransformStream): Promise<void> {
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
                readableStreamDefaultControllerClose(readable[kState].controller as ReadableStreamDefaultController);
                resolve();
            }
        },
        (error: unknown) => {
            readableStreamDefaultControllerError(readable[kState].controller as ReadableStreamDefaultController, error);
            reject(error);
        },
    );
    return controller[kState].finishPromise;
}

function transformStreamDefaultSourcePullAlgorithm(stream: TransformStream): Promise<void> {
    transformStreamSetBackpressure(stream, false);
    return stream[kState].backpressureChange.promise;
}

function transformStreamDefaultSourceCancelAlgorithm(stream: TransformStream, reason: unknown): Promise<void> {
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
