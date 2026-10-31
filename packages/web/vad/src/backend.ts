// VAD backend availability — the ONE place this package decides whether a
// native detector exists on this host, and where a failed load is CLASSIFIED.
//
// Same shape as `@gjsify/speech-synthesis/backend`: a cached probe, `absent`
// (expected: no prebuild, wrong OS, no GObject-Introspection) split from
// `failed` (a fault that must be loud), a QUIET capability query, and a
// diagnostic that the USE site prints once.
//
// Unlike libspiel in ADR 0121, NO SYSTEM LIBRARY takes precedence (ADR 0127
// decision 6): no distribution ships libsherpa-onnx, so the prebuild IS the
// backend and there is nothing to prefer over it.
//
// This file also owns {@link VadEngine} — the seam the detector in `vad.ts`
// talks to. Everything that knows about `gi://GjsifySherpa` is on this side of
// it, which is what lets the event state machine be tested without a model, a
// prebuild or an inference run (`fake-vad.ts`).

import { getLoadError, hasNativeSherpa, loadNativeSherpa, type NativeSherpaModule } from '@gjsify/sherpa-native';
import { hostOs, type TargetOs } from '@gjsify/utils/core';

export type VadBackendStatus = 'sherpa' | 'absent' | 'failed';

export interface VadBackend {
    status: VadBackendStatus;
    /** The GjsifySherpa module, or `null` for `absent`/`failed`. */
    module: NativeSherpaModule | null;
    /** The original load error for `absent`/`failed`; `null` otherwise. */
    error: unknown;
    /** The one-time line the USE site prints; `null` = nothing to say. */
    diagnostic: string | null;
}

export interface LoadVadBackendOptions {
    /** Override `loadNativeSherpa()`. Tests only. */
    load?: () => NativeSherpaModule | null;
    /** Override the load error `load` failed with. Tests only. */
    loadError?: () => Error | null;
    /** Override the host OS the probe branches on. Tests only. */
    hostOs?: () => TargetOs | undefined;
}

const SHERPA_NATIVE = '@gjsify/sherpa-native';

const NO_PREBUILD_TEXT =
    '[@gjsify/vad] No voice activity detection on this host — the GjsifySherpa-1.0 typelib is absent. ' +
    `Install ${SHERPA_NATIVE}-<os>-<arch> for this machine (linux-x64 only today). ` +
    'Gate on hasVadBackend().';

const UNSUPPORTED_OS_TEXT =
    '[@gjsify/vad] No voice activity detection on this OS — the sherpa-onnx bridge is built for Linux only.';

const LOAD_FAULT_TEXT =
    `[@gjsify/vad] The ${SHERPA_NATIVE} bridge failed to load — a fault on this host, NOT a missing ` +
    'prebuild. Voice activity detection is unavailable until it is fixed.';

/** `NativeLibraryLoadError`: the typelib was found and its library refused to open. */
const LIBRARY_FAULT = 'NativeLibraryLoadError';

let cached: VadBackend | null = null;
let reported = false;

/** No GObject-Introspection in the process at all (`--app browser`): nothing to install, nothing to say. */
function isNoGiError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('GObject-Introspection');
}

/** Classify a failed load. Exported (underscored) for the specs. */
export function _diagnoseVadLoadError(error: unknown): { status: 'absent' | 'failed'; diagnostic: string | null } {
    if (isNoGiError(error)) return { status: 'absent', diagnostic: null };
    if (error instanceof Error && error.name === LIBRARY_FAULT) {
        return { status: 'failed', diagnostic: LOAD_FAULT_TEXT };
    }
    return { status: 'absent', diagnostic: `${NO_PREBUILD_TEXT} (${error instanceof Error ? error.message : error})` };
}

/**
 * Resolve (once) what detector this host has. Emits NOTHING. Synchronous,
 * because loading a typelib is — `install()` is the asynchronous part, and it
 * is about the model rather than the engine.
 *
 * Passing options after the probe ran THROWS instead of being ignored; call
 * {@link _resetVadBackendCache} first.
 */
export function loadVadBackend(options: LoadVadBackendOptions = {}): VadBackend {
    if (cached !== null) {
        if (options.load || options.loadError || options.hostOs) {
            throw new Error(
                'loadVadBackend(options) called after the probe already ran — the probe is cached per process, ' +
                    'so the override would be ignored. Call _resetVadBackendCache() first (tests only).',
            );
        }
        return cached;
    }

    const os = (options.hostOs ?? hostOs)();
    if (os === 'darwin' || os === 'win32') {
        cached = { status: 'absent', module: null, error: null, diagnostic: UNSUPPORTED_OS_TEXT };
        return cached;
    }

    const module = (options.load ?? loadNativeSherpa)();
    if (module === null) {
        const error = (options.loadError ?? getLoadError)();
        const { status, diagnostic } = _diagnoseVadLoadError(error);
        cached = { status, module: null, error, diagnostic };
        return cached;
    }
    cached = { status: 'sherpa', module, error: null, diagnostic: null };
    return cached;
}

/**
 * Whether this host has a native detector. Quiet; a QUERY, not a guarantee —
 * a model still has to be cached, which is what `available()` answers.
 */
export function hasVadBackend(): boolean {
    // The common case needs no probe object at all, and the probe inside
    // `@gjsify/sherpa-native` is itself cached.
    return cached !== null ? cached.status === 'sherpa' : hasNativeSherpa() && loadVadBackend().status === 'sherpa';
}

/** Emit the backend's one-time diagnostic — called by `createVad()`, never by the queries. */
export function reportVadBackendOnce(backend: VadBackend): void {
    if (reported || backend.diagnostic === null) return;
    reported = true;
    if (backend.status === 'failed') console.error(backend.diagnostic, backend.error);
    else console.warn(backend.diagnostic);
}

/**
 * The detector stack in words, and — when there is none — why and what to
 * install. For a settings panel or a bug report; branch on
 * {@link hasVadBackend} instead.
 */
export function describeVadBackend(): string {
    const backend = loadVadBackend();
    if (backend.status !== 'sherpa') {
        return `none (${backend.status}): ${backend.diagnostic ?? 'not available on this target'}`;
    }
    const sherpa = backend.module!;
    return `sherpa-onnx ${sherpa.version()} on onnxruntime ${sherpa.onnxruntime_version()} (${SHERPA_NATIVE})`;
}

/** Reset the cached probe and its one-time diagnostic — tests only. */
export function _resetVadBackendCache(): void {
    cached = null;
    reported = false;
}

/** One completed stretch of speech, as the engine hands it over. */
export interface EngineSegment {
    /** The segment's audio, mono float in [-1, 1]. */
    samples: Float32Array;
    /** Offset of the first sample from the first sample ever accepted. */
    startSample: number;
}

/**
 * The detector seam: what `VoiceActivityDetector` needs and nothing else.
 *
 * `isSpeech()` is the LIVE edge and `nextSegment()` a COMPLETED segment, and
 * the two are not the same measurement — see the class doc in `vad.ts` for how
 * far apart they are in practice.
 */
export interface VadEngine {
    /** Load the model. Idempotent. Throws when the model cannot be opened. */
    open(): void;
    /** Feed mono float samples in [-1, 1]. ANY length; the engine buffers the remainder. */
    accept(samples: Float32Array): void;
    /** Whether the engine is inside speech right now. */
    isSpeech(): boolean;
    /** Whether a completed segment is queued. */
    hasSegment(): boolean;
    /** Take the oldest completed segment, or `null`. */
    nextSegment(): EngineSegment | null;
    /** Close an in-progress segment and queue it — end of input. */
    flush(): void;
    /** Drop every queued segment AND the model state. */
    reset(): void;
    /** Release the model. Idempotent. */
    close(): void;
}

/** What {@link createSherpaVadEngine} needs. Resolved values: a real path, seconds, samples. */
export interface SherpaVadEngineConfig {
    /** Absolute path to a Silero `.onnx` file. */
    model: string;
    threshold: number;
    minSilenceSeconds: number;
    minSpeechSeconds: number;
    maxSpeechSeconds: number;
    sampleRate: number;
    windowSize: number;
    numThreads: number;
    bufferSeconds: number;
    debug: boolean;
}

/**
 * A {@link VadEngine} over `GjsifySherpa.Vad`.
 *
 * Construction does not load anything — the GObject's own knobs are construct
 * properties and `open()` is a separate step, so this mirrors that rather than
 * adding a second lifecycle on top.
 */
export function createSherpaVadEngine(config: SherpaVadEngineConfig): VadEngine {
    const backend = loadVadBackend();
    if (backend.status !== 'sherpa') {
        reportVadBackendOnce(backend);
        throw new Error(backend.diagnostic ?? `No native VAD engine on this host (${backend.status})`);
    }
    const native = new backend.module!.Vad({
        model: config.model,
        threshold: config.threshold,
        min_silence_duration: config.minSilenceSeconds,
        min_speech_duration: config.minSpeechSeconds,
        max_speech_duration: config.maxSpeechSeconds,
        sample_rate: config.sampleRate,
        window_size: config.windowSize,
        num_threads: config.numThreads,
        buffer_size_in_seconds: config.bufferSeconds,
        enable_debug: config.debug,
    });

    return {
        open: () => native.open(),
        // A Float32Array reaches the `float[]` parameter directly under gjs
        // (measured), so the samples are not copied into a JS Array first.
        accept: (samples) => native.accept(samples as unknown as number[]),
        isSpeech: () => native.is_speech(),
        hasSegment: () => native.has_segment(),
        nextSegment: () => {
            // A boolean return, not a nullable array: an empty C array arrives
            // as `[]` rather than `null` under introspection, so the predicate
            // is the only part that can tell "none queued" from "a segment".
            const [ok, samples, startSample] = native.next_segment();
            if (!ok) return null;
            return { samples: samples instanceof Float32Array ? samples : Float32Array.from(samples), startSample };
        },
        flush: () => native.flush(),
        reset: () => native.reset(),
        close: () => native.close(),
    };
}
