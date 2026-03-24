// WHATWG Streams — ByteLengthQueuingStrategy and CountQueuingStrategy
// Adapted from refs/node/lib/internal/webstreams/queuingstrategies.js
// Copyright (c) Node.js contributors. MIT license.

const byteSizeFunction = Object.defineProperty(
  (chunk: any) => chunk.byteLength,
  'name',
  { value: 'size' },
);

const countSizeFunction = Object.defineProperty(
  () => 1,
  'name',
  { value: 'size' },
);

export class ByteLengthQueuingStrategy {
  #highWaterMark: number;

  constructor(init: { highWaterMark: number }) {
    if (init == null || typeof init !== 'object') {
      throw new TypeError('init must be an object');
    }
    if (init.highWaterMark === undefined) {
      throw new TypeError('init.highWaterMark is required');
    }
    this.#highWaterMark = +init.highWaterMark;
  }

  get highWaterMark(): number {
    return this.#highWaterMark;
  }

  get size(): (chunk: any) => number {
    return byteSizeFunction;
  }

  get [Symbol.toStringTag]() {
    return 'ByteLengthQueuingStrategy';
  }
}

export class CountQueuingStrategy {
  #highWaterMark: number;

  constructor(init: { highWaterMark: number }) {
    if (init == null || typeof init !== 'object') {
      throw new TypeError('init must be an object');
    }
    if (init.highWaterMark === undefined) {
      throw new TypeError('init.highWaterMark is required');
    }
    this.#highWaterMark = +init.highWaterMark;
  }

  get highWaterMark(): number {
    return this.#highWaterMark;
  }

  get size(): (chunk: any) => number {
    return countSizeFunction;
  }

  get [Symbol.toStringTag]() {
    return 'CountQueuingStrategy';
  }
}
