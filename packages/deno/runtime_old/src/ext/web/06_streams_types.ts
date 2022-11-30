// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/web/06_streams_types.d.ts

import type { Deferred } from './06_streams.js';

// ** Internal Interfaces **

export interface PendingAbortRequest {
  deferred: Deferred<void>;
  // deno-lint-ignore no-explicit-any
  reason: any;
  wasAlreadyErroring: boolean;
}

// deno-lint-ignore no-explicit-any
export interface ReadRequest<R = any> {
  chunkSteps: (chunk: R) => void;
  closeSteps: () => void;
  // deno-lint-ignore no-explicit-any
  errorSteps: (error: any) => void;
}

export interface ReadIntoRequest {
  chunkSteps: (chunk: ArrayBufferView) => void;
  closeSteps: (chunk?: ArrayBufferView) => void;
  // deno-lint-ignore no-explicit-any
  errorSteps: (error: any) => void;
}

export interface PullIntoDescriptor {
  buffer: ArrayBuffer;
  bufferByteLength: number;
  byteOffset: number;
  byteLength: number;
  bytesFilled: number;
  elementSize: number;
  // deno-lint-ignore no-explicit-any
  viewConstructor: any;
  readerType: "default" | "byob" | "none";
}

export interface ReadableByteStreamQueueEntry {
  buffer: ArrayBufferLike;
  byteOffset: number;
  byteLength: number;
}

export interface ReadableStreamGetReaderOptions {
  mode?: "byob";
}

export interface ReadableStreamIteratorOptions {
  preventCancel?: boolean;
}

export interface ValueWithSize<T> {
  value: T;
  size: number;
}

export interface VoidFunction {
  (): void;
}

export interface ReadableStreamGenericReader<T> {
  readonly closed: Promise<void>;
  // deno-lint-ignore no-explicit-any
  cancel(reason?: any): Promise<void>;
}

// ** Ambient Definitions and Interfaces not provided by fetch **

declare function queueMicrotask(callback: VoidFunction): void;

declare namespace Deno {
  function inspect(value: unknown, options?: Record<string, unknown>): string;
}
