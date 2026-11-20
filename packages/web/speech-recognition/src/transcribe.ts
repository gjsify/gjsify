// `transcribe()` — recognize a FINISHED recording (a push-to-talk buffer, a voice-note file).
//
// The streaming `SpeechRecognition` is for live capture; a finished recording wants the whole
// utterance at once and the better offline model (ADR 0127, offline follow-up). File decoding is
// `@gjsify/media-capture`'s `openPcmSource({ file })`, the same GStreamer chain the live path
// uses — there is no second one here.

import { openPcmSource } from '@gjsify/media-capture';

import { hasRecognitionBackend } from './backend.js';
import { DEFAULT_TRANSCRIBE_MODEL, findRecognitionModel, type RecognitionModelEntry } from './model-manifest.js';
import { resolveRecognitionModel } from './models.js';
import { createSherpaOfflineEngine, type OfflineEngine } from './offline-engine.js';
import { namedError, type SpeechRecognitionPhrase } from './results.js';

/** The rate every engine here takes; PCM input must already be at it. */
export const TRANSCRIBE_SAMPLE_RATE = 16000;

/** A `Gio.File`, as far as `transcribe()` needs one; typed structurally so callers need no Gio import. */
export interface TranscribeFile {
    get_path(): string | null;
}

/** 16 kHz mono Float32 PCM, a file path, or a `Gio.File`. */
export type TranscribeSource = Float32Array | string | TranscribeFile;

export interface TranscribeOptions {
    /** BCP 47 hint. Informational for a multilingual model, which detects the language itself. */
    lang?: string;
    /** Contextual biasing. Applied only where the engine supports it; `boost` is advisory. */
    phrases?: readonly SpeechRecognitionPhrase[];
    /** Aborts reading and decoding of a file. A decode already running in the engine cannot be interrupted. */
    signal?: AbortSignal;
    /** An offline model id from `RECOGNITION_MODELS`. Default: {@link DEFAULT_TRANSCRIBE_MODEL}. */
    model?: string;
    /** The engine for `model`. Default: sherpa-onnx on the cached files. Tests and second backends. */
    engine?: (model: RecognitionModelEntry) => OfflineEngine;
}

export interface Transcription {
    text: string;
    /** BCP 47 primary subtag the engine detected, or `null` when it does not say. */
    language: string | null;
    /** Backend and model, e.g. `sherpa-onnx/parakeet-tdt-0.6b-v3-int8`. */
    engine: string;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) throw namedError('transcribe() was aborted', 'AbortError');
}

/** Decode `path` to 16 kHz mono Float32 through media-capture's file chain. */
async function readFile(path: string, signal: AbortSignal | undefined): Promise<Float32Array> {
    const source = openPcmSource({ file: path, sampleRate: TRANSCRIBE_SAMPLE_RATE, format: 'F32LE' });
    const chunks: Float32Array[] = [];
    let total = 0;
    try {
        for (;;) {
            throwIfAborted(signal);
            const chunk = await source.read();
            if (chunk === null) break;
            // Copy: a chunk's byteOffset is not guaranteed to be 4-aligned.
            const floats = new Float32Array(chunk.byteLength >> 2);
            new Uint8Array(floats.buffer).set(chunk.subarray(0, floats.length * 4));
            chunks.push(floats);
            total += floats.length;
        }
    } finally {
        source.stop();
    }
    const samples = new Float32Array(total);
    let at = 0;
    for (const chunk of chunks) {
        samples.set(chunk, at);
        at += chunk.length;
    }
    return samples;
}

async function samplesOf(source: TranscribeSource, signal: AbortSignal | undefined): Promise<Float32Array> {
    if (source instanceof Float32Array) return source;
    if (typeof source === 'string') return readFile(source, signal);
    if (source !== null && typeof source === 'object' && typeof source.get_path === 'function') {
        const path = source.get_path();
        if (path === null) throw new TypeError('transcribe(): the Gio.File has no local path');
        return readFile(path, signal);
    }
    throw new TypeError('transcribe(): source must be a Float32Array, a file path or a Gio.File');
}

/**
 * Recognize a finished recording. Rejects with `AbortError` on abort, `NotSupportedError` when
 * there is no engine on this host, `NotFoundError` when the model is not cached
 * (`await install({ langs, kind: 'offline' })` first).
 */
export async function transcribe(source: TranscribeSource, options: TranscribeOptions = {}): Promise<Transcription> {
    const model = findRecognitionModel(options.model ?? DEFAULT_TRANSCRIBE_MODEL);
    if (model === undefined) throw namedError(`Unknown recognition model '${options.model}'`, 'NotFoundError');
    if (model.kind !== 'offline') {
        throw new TypeError(`transcribe(): model '${model.id}' is a streaming model; pick an offline one`);
    }
    throwIfAborted(options.signal);

    let engine: OfflineEngine;
    if (options.engine !== undefined) {
        engine = options.engine(model);
    } else {
        if (!hasRecognitionBackend()) {
            throw namedError('transcribe(): no native recognition engine on this host', 'NotSupportedError');
        }
        let files: Record<string, string>;
        try {
            files = resolveRecognitionModel(model);
        } catch (error) {
            throw namedError(error instanceof Error ? error.message : String(error), 'NotFoundError');
        }
        engine = createSherpaOfflineEngine({
            name: `sherpa-onnx/${model.id}`,
            encoder: files[model.encoder],
            decoder: files[model.decoder],
            joiner: files[model.joiner],
            tokens: files[model.tokens],
            modelType: model.modelType,
            sampleRate: model.sampleRate,
        });
    }

    const samples = await samplesOf(source, options.signal);
    throwIfAborted(options.signal);

    const hotwords =
        engine.hotwords && options.phrases !== undefined && options.phrases.length > 0
            ? options.phrases.map((p) => p.phrase)
            : undefined;

    engine.open();
    try {
        const result = engine.transcribe(samples, { hotwords });
        return { text: result.text, language: result.language, engine: engine.name };
    } finally {
        engine.close();
    }
}
