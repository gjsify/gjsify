// A scripted {@link OfflineEngine} for the specs — the offline twin of `fake-engine.ts`.
// Exported so a consumer testing an app on top of `transcribe()` has the same stand-in.

import type { OfflineDecodeOptions, OfflineEngine, OfflineResult } from './offline-engine.js';

export interface FakeOfflineEngine extends OfflineEngine {
    /** What the next `transcribe()` answers. */
    answer(result: Partial<OfflineResult>): void;
    /** Make the next `transcribe()` throw. */
    failWith(error: Error): void;
    /** Every recording it was given, in order. */
    readonly recordings: readonly Float32Array[];
    /** The options of every call, in order. */
    readonly calls: readonly (OfflineDecodeOptions | undefined)[];
    readonly opened: boolean;
    readonly closed: boolean;
}

export function createFakeOfflineEngine(options: { hotwords?: boolean; name?: string } = {}): FakeOfflineEngine {
    let result: OfflineResult = { text: '', language: null };
    let failure: Error | null = null;
    const recordings: Float32Array[] = [];
    const calls: (OfflineDecodeOptions | undefined)[] = [];
    const state = { opened: false, closed: false };

    return {
        name: options.name ?? 'fake',
        hotwords: options.hotwords ?? false,
        answer(next) {
            result = { text: next.text ?? '', language: next.language ?? null };
        },
        failWith(error) {
            failure = error;
        },
        recordings,
        calls,
        get opened() {
            return state.opened;
        },
        get closed() {
            return state.closed;
        },
        open() {
            state.opened = true;
        },
        transcribe(samples, decodeOptions) {
            recordings.push(samples);
            calls.push(decodeOptions);
            if (failure !== null) throw failure;
            return { ...result };
        },
        close() {
            state.closed = true;
        },
    };
}
