// stream/promises — Promise-based stream utilities

import { pipeline as _pipeline, finished as _finished } from '../index.js';
import type { Stream, Readable, Writable, FinishedOptions } from '../index.js';
import type { DestroyableStream, PipelineCallback } from '../utils/pipeline.js';

// oxlint-disable-next-line typescript/no-explicit-any -- matches @types/node stream.promises.pipeline variadic overload for drop-in compat
export function pipeline(...streams: any[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const cb: PipelineCallback = (err: Error | null) => {
            if (err) reject(err);
            else resolve();
        };
        // Spread all streams + callback into the underlying pipeline
        const allArgs = [...streams, cb] as [...DestroyableStream[], PipelineCallback];
        _pipeline(...allArgs);
    });
}

export function finished(stream: Stream | Readable | Writable, opts?: FinishedOptions): Promise<void> {
    return new Promise((resolve, reject) => {
        if (opts && typeof opts !== 'function') {
            _finished(stream, opts, (err?: Error | null) => {
                if (err) reject(err);
                else resolve();
            });
        } else {
            _finished(stream, (err?: Error | null) => {
                if (err) reject(err);
                else resolve();
            });
        }
    });
}

export default { pipeline, finished };
