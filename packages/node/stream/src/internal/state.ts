// Module-singleton state for the stream module.
//
// Reference: refs/node/lib/internal/streams/state.js
// Reimplemented for GJS — currently only the default high-water-mark pair.
// Centralised here so per-class files (Readable, Writable, Duplex) do not
// duplicate or fight over the values.

let defaultHighWaterMark = 16384;
let defaultObjectHighWaterMark = 16;

export function getDefaultHighWaterMark(objectMode: boolean): number {
  return objectMode ? defaultObjectHighWaterMark : defaultHighWaterMark;
}

export function setDefaultHighWaterMark(objectMode: boolean, value: number): void {
  if (typeof value !== 'number' || value < 0 || Number.isNaN(value)) {
    throw new TypeError(`Invalid highWaterMark: ${value}`);
  }
  if (objectMode) {
    defaultObjectHighWaterMark = value;
  } else {
    defaultHighWaterMark = value;
  }
}

/** Validate a named high-water-mark option and throw ERR_INVALID_ARG_VALUE on NaN/non-number. */
export function validateHighWaterMark(name: string, value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || Number.isNaN(value)) {
    const err = new TypeError(`The value of "${name}" is invalid. Received ${value}`) as Error & { code?: string };
    err.code = 'ERR_INVALID_ARG_VALUE';
    throw err;
  }
}
