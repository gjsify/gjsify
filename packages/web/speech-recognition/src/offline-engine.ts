// The seam `transcribe()` talks to, the offline twin of `RecognizerEngine` (backend.ts).
//
// A streaming engine is fed chunks and answers interim text; an offline engine gets the
// WHOLE recording and answers once. Everything that knows about `gi://GjsifySherpa` sits on
// this side of the seam, so a second backend (whisper.cpp, a future `@gjsify/whisper-native`)
// is one more factory returning an `OfflineEngine`, not a fork of `transcribe()`.

import { loadNativeSherpa } from '@gjsify/sherpa-native';

import { describeRecognitionBackend } from './backend.js';

/** What the engine heard in one recording. */
export interface OfflineResult {
    text: string;
    /** BCP 47 primary subtag the engine detected, or `null` when it does not say. */
    language: string | null;
}

export interface OfflineDecodeOptions {
    /** Contextual-biasing phrases. Ignored by an engine whose {@link OfflineEngine.hotwords} is false. */
    hotwords?: readonly string[];
}

export interface OfflineEngine {
    /** Names the backend and model in `Transcription.engine`, e.g. `sherpa-onnx/parakeet-tdt-0.6b-v3-int8`. */
    readonly name: string;
    /** Whether {@link OfflineDecodeOptions.hotwords} changes the result. */
    readonly hotwords: boolean;
    /** Load the model. Throws when it cannot be opened. */
    open(): void;
    /** Decode a whole recording: mono Float32 at 16 kHz. */
    transcribe(samples: Float32Array, options?: OfflineDecodeOptions): OfflineResult;
    /** Release the model. Idempotent. */
    close(): void;
}

export interface SherpaOfflineEngineConfig {
    name: string;
    encoder: string;
    decoder: string;
    joiner: string;
    tokens: string;
    /** sherpa-onnx `model_type`, e.g. `nemo_transducer`. */
    modelType?: string;
    sampleRate: number;
    numThreads?: number;
}

/** An {@link OfflineEngine} over `GjsifySherpa.OfflineRecognizer`. */
export function createSherpaOfflineEngine(config: SherpaOfflineEngineConfig): OfflineEngine {
    const sherpa = loadNativeSherpa();
    if (sherpa === null) throw new Error(describeRecognitionBackend());

    const recognizer = new sherpa.OfflineRecognizer({
        encoder: config.encoder,
        decoder: config.decoder,
        joiner: config.joiner,
        tokens: config.tokens,
        model_type: config.modelType ?? null,
        sample_rate: config.sampleRate,
        num_threads: config.numThreads ?? 2,
    });

    return {
        name: config.name,
        // The C shim does not hand sherpa-onnx a BPE vocabulary or modeling unit, which encoding a
        // hotword for a NeMo transducer needs. Until it does, phrases cannot be applied honestly.
        hotwords: false,
        open() {
            recognizer.open();
        },
        transcribe(samples) {
            // An offline stream decodes once: one stream per recording.
            const stream = recognizer.create_stream(null);
            try {
                stream.accept(config.sampleRate, samples as unknown as number[]);
                stream.decode();
                const text = stream.get_text().trim();
                let language: string | null = null;
                try {
                    const lang = (JSON.parse(stream.get_json()) as { lang?: string }).lang;
                    if (typeof lang === 'string' && lang !== '') language = lang;
                } catch {
                    // The JSON is detail only; the text above is the answer.
                }
                return { text, language };
            } finally {
                stream.close();
            }
        },
        close() {
            recognizer.close();
        },
    };
}
