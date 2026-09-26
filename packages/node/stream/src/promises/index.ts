// stream/promises — Promise-based stream utilities

// The implementations directly, not the barrel: the barrel re-exports THIS module as
// `stream.promises`, and importing it back would make the two a cycle.
import { pipeline as _pipeline } from '../utils/pipeline.js';
import { finished as _finished } from '../utils/finished.js';
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
