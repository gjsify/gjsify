// Recognition backend availability — the ONE place this package decides whether a
// native streaming recognizer exists on this host.
//
// The probe itself is `@gjsify/sherpa-native`'s (cached there); what lives here is
// the seam. {@link RecognizerEngine} is everything the session in `recognition.ts`
// needs from an engine, and everything that knows about `gi://GjsifySherpa` is on
// this side of it — which is what lets the session's event order be tested
// without a model, a prebuild or an inference run (`fake-engine.ts`).

import { getLoadError, hasNativeSherpa, loadNativeSherpa } from '@gjsify/sherpa-native';
import { hostOs } from '@gjsify/utils/core';

/** Whether this host has a native recognizer. Quiet; a QUERY, not a guarantee — a model still has to be cached. */
export function hasRecognitionBackend(): boolean {
    const os = hostOs();
    if (os === 'darwin' || os === 'win32') return false;
    return hasNativeSherpa();
}

/** The recognizer stack in words, and — when there is none — why. For a settings panel or a bug report. */
export function describeRecognitionBackend(): string {
    if (!hasRecognitionBackend()) {
        const error = getLoadError();
        return `none: @gjsify/sherpa-native is not available on this host${error ? ` (${error.message})` : ''}`;
    }
    const sherpa = loadNativeSherpa()!;
    return `sherpa-onnx ${sherpa.version()} on onnxruntime ${sherpa.onnxruntime_version()} (@gjsify/sherpa-native)`;
}

/** What the engine knows about the utterance it is decoding. */
export interface RecognizerFrame {
    /** The hypothesis so far for the current utterance — interim, and it grows. */
    text: string;
    /** The model's own trailing-silence rule says the utterance ended. */
    endpoint: boolean;
}

/** The token-level detail of the current utterance; any field may be absent. */
export interface RecognizerDetail {
    tokens: string[];
    /** Seconds from the start of the current utterance. */
    timestamps: number[];
    /** Per-token log probabilities. */
    logProbs: number[];
}

/** The seam the session talks to. */
export interface RecognizerEngine {
    /** Load the model. Throws when it cannot be opened. */
    open(): void;
    /** Feed mono float samples at the engine's rate and decode everything that became ready. */
    accept(samples: Float32Array): RecognizerFrame;
    /** Pad the tail with silence so the last tokens are emitted, and decode. */
    flushTail(): RecognizerFrame;
    /** Token detail of the current utterance. Call before {@link reset}. */
    detail(): RecognizerDetail;
    /** Start a new utterance. */
    reset(): void;
    /** Release the model. Idempotent. */
    close(): void;
}

export interface SherpaEngineConfig {
    encoder: string;
    decoder: string;
    joiner: string;
    tokens: string;
    sampleRate: number;
    numThreads?: number;
}

/** Trailing silence fed before reading a final hypothesis; sherpa-onnx's own examples pad 0.3 s. */
const TAIL_SECONDS = 0.5;

/** A {@link RecognizerEngine} over `GjsifySherpa.OnlineRecognizer`. */
export function createSherpaEngine(config: SherpaEngineConfig): RecognizerEngine {
    const sherpa = loadNativeSherpa();
    if (sherpa === null) throw new Error(describeRecognitionBackend());

    const recognizer = new sherpa.OnlineRecognizer({
        encoder: config.encoder,
        decoder: config.decoder,
        joiner: config.joiner,
        tokens: config.tokens,
        sample_rate: config.sampleRate,
        num_threads: config.numThreads ?? 1,
        enable_endpoint: true,
    });
    let stream: ReturnType<typeof recognizer.create_stream> | null = null;

    const feed = (samples: Float32Array): RecognizerFrame => {
        const s = stream!;
        // A Float32Array reaches the `float[]` parameter directly under gjs (measured by @gjsify/vad).
        s.accept(config.sampleRate, samples as unknown as number[]);
        while (s.is_ready()) s.decode();
        return { text: s.get_text(), endpoint: s.is_endpoint() };
    };

    return {
        open() {
            recognizer.open();
            // GJS does not apply Vala's `= null` default: the nullable argument must be passed.
            stream ??= recognizer.create_stream(null);
        },
        accept: feed,
        flushTail() {
            return feed(new Float32Array(Math.round(config.sampleRate * TAIL_SECONDS)));
        },
        detail() {
            try {
                const json = JSON.parse(stream!.get_json()) as {
                    tokens?: string[];
                    timestamps?: number[];
                    ys_probs?: number[];
                };
                return {
                    tokens: json.tokens ?? [],
                    timestamps: json.timestamps ?? [],
                    logProbs: json.ys_probs ?? [],
                };
            } catch {
                return { tokens: [], timestamps: [], logProbs: [] };
            }
        },
        reset() {
            stream!.reset();
        },
        close() {
            stream?.close();
            stream = null;
            recognizer.close();
        },
    };
}
