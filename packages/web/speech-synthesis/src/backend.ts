// Speech backend availability — the ONE place this package decides whether libspiel and a
// speech provider exist on this host, and where a failed load is CLASSIFIED.
//
// Same shape as `@gjsify/gamepad/backend`: a cached probe, `absent` (expected: no typelib,
// no provider, wrong OS) split from `failed` (a fault that must be loud), a QUIET
// capability query, and a diagnostic printed from the USE site (`speak()`), once.
// The W3C surface cannot tell "no voices installed" from "no speech stack at all"; the
// `has…`/`describe…` pair is the non-standard way to ask.

import { probeSpiel, SPIEL_NAMESPACE, type SpielProbe, type SpielSource } from '@gjsify/spiel-native';
import { hostOs, type TargetOs } from '@gjsify/utils/core';

import type { SpielNamespace, SpielSpeaker } from './spiel-types.js';

export type SpeechBackendStatus = 'spiel' | 'absent' | 'failed';

export interface SpeechBackend {
    status: SpeechBackendStatus;
    /** Where libspiel came from: the host (`system`), `@gjsify/spiel-native` (`prebuild`), or `absent`. */
    source: SpielSource;
    speaker: SpielSpeaker | null;
    namespace: SpielNamespace | null;
    /** The original load error for `absent`/`failed`; `null` otherwise. */
    error: unknown;
    /** The one-time line the USE site prints; `null` = nothing to say. */
    diagnostic: string | null;
}

export interface LoadSpeechBackendOptions {
    /** Override `probeSpiel()` from `@gjsify/spiel-native`. Tests only. */
    probe?: () => Pick<SpielProbe, 'source' | 'module' | 'reason' | 'error'>;
    /** Override the host OS the probe branches on. Tests only. */
    hostOs?: () => TargetOs | undefined;
    /**
     * Runs on the fresh `Spiel.Speaker` before the first utterance — the place to route
     * audio elsewhere (`speaker.set_property('sink', element)`); the specs use it to keep
     * the real-Spiel test silent.
     */
    configureSpeaker?: (speaker: SpielSpeaker) => void;
}

const INSTALLER_HINT =
    'Install a speech provider with the Spiel Installer (flatpak install flathub org.project_spiel.SpielInstaller) ' +
    'and add a voice there.';

// `@gjsify/spiel-native` owns finding Spiel: system libspiel first, its own prebuild as the
// fallback, and the reason when neither exists. This file only classifies the answer.
const SPIEL_NATIVE = '@gjsify/spiel-native';

const NO_TYPELIB_TEXT =
    '[@gjsify/speech-synthesis] No speech backend on this host — the Spiel-1.0 typelib (libspiel) is absent, ' +
    'so getVoices() is empty and speak() fires an error event (synthesis-unavailable). ' +
    `Install libspiel from your distribution, or the ${SPIEL_NATIVE}-<os>-<arch> package for this machine ` +
    '(linux-x64 and linux-arm64 only). ' +
    INSTALLER_HINT +
    ' Gate on hasSpeechSynthesisBackend().';

const NO_PROVIDER_TEXT =
    '[@gjsify/speech-synthesis] libspiel is available but no speech provider is installed, so getVoices() ' +
    'is empty and speak() fires an error event (synthesis-unavailable). ' +
    INSTALLER_HINT +
    ' Gate on hasSpeechSynthesisBackend().';

const UNSUPPORTED_OS_TEXT =
    '[@gjsify/speech-synthesis] No speech backend on this OS — libspiel exists for Linux only, so ' +
    'getVoices() is empty and speak() fires an error event (synthesis-unavailable).';

const LOAD_FAULT_TEXT =
    '[@gjsify/speech-synthesis] The Spiel speech backend failed to load — a fault on this host, NOT a ' +
    'missing libspiel. getVoices() is empty until it is fixed.';

let cached: Promise<SpeechBackend> | null = null;
let reported = false;

/** `NativeLibraryLoadError`: the typelib was found and its library refused to open. */
const LIBRARY_FAULT = 'NativeLibraryLoadError';

/** No GObject-Introspection in the process at all (`--app browser`): nothing to install, nothing to say. */
function isNoGiError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('GObject-Introspection');
}

/** Classify a failed Spiel probe or `Speaker` creation. Exported (underscored) for the specs. */
export function _diagnoseSpielLoadError(
    error: unknown,
    reason: string | null = null,
): { status: 'absent' | 'failed'; diagnostic: string | null } {
    if (isNoGiError(error)) return { status: 'absent', diagnostic: null };
    if (reason !== null && !(error instanceof Error && error.name === LIBRARY_FAULT)) {
        return { status: 'absent', diagnostic: `${NO_TYPELIB_TEXT} (${reason})` };
    }
    return { status: 'failed', diagnostic: LOAD_FAULT_TEXT };
}

async function probe(options: LoadSpeechBackendOptions): Promise<SpeechBackend> {
    const os = (options.hostOs ?? hostOs)();
    if (os === 'darwin' || os === 'win32') {
        return {
            status: 'absent',
            source: 'absent',
            speaker: null,
            namespace: null,
            error: null,
            diagnostic: UNSUPPORTED_OS_TEXT,
        };
    }

    const found = (options.probe ?? probeSpiel)();
    if (found.module === null) {
        const { status, diagnostic } = _diagnoseSpielLoadError(found.error, found.reason ?? 'not available');
        return { status, source: 'absent', speaker: null, namespace: null, error: found.error, diagnostic };
    }

    let speaker: SpielSpeaker;
    const spiel = found.module as unknown as SpielNamespace;
    try {
        if (typeof spiel.Speaker?.new_sync !== 'function') {
            throw new Error(`${SPIEL_NAMESPACE} resolved without a Speaker class — unexpected Spiel ABI`);
        }
        // Speaker creation activates the providers over D-Bus (~20 ms warm, ~600 ms cold)
        // and is the second thing that can fail on a host whose typelib loads fine.
        speaker = spiel.Speaker.new_sync(null);
        options.configureSpeaker?.(speaker);
    } catch (error) {
        const { status, diagnostic } = _diagnoseSpielLoadError(error);
        return { status, source: found.source, speaker: null, namespace: null, error, diagnostic };
    }
    const noProvider = speaker.providers.get_n_items() === 0;
    return {
        status: 'spiel',
        source: found.source,
        speaker,
        namespace: spiel,
        error: null,
        diagnostic: noProvider ? NO_PROVIDER_TEXT : null,
    };
}

/**
 * Resolve (once) what speech stack this host has. Emits NOTHING. Passing options after the
 * probe ran THROWS instead of being ignored — call {@link _resetSpeechBackendCache} first.
 */
export function loadSpeechSynthesisBackend(options: LoadSpeechBackendOptions = {}): Promise<SpeechBackend> {
    if (cached !== null) {
        if (options.probe || options.hostOs || options.configureSpeaker) {
            throw new Error(
                'loadSpeechSynthesisBackend(options) called after the probe already ran — the probe is cached per ' +
                    'process, so the override would be ignored. Call _resetSpeechBackendCache() first (tests only).',
            );
        }
        return cached;
    }
    cached = probe(options);
    return cached;
}

/** Emit the backend's one-time diagnostic — called by `speak()`, never by the queries. */
export function reportSpeechBackendOnce(backend: SpeechBackend): void {
    if (reported || backend.diagnostic === null) return;
    reported = true;
    if (backend.status === 'failed') console.error(backend.diagnostic, backend.error);
    else console.warn(backend.diagnostic);
}

/** Whether `backend` can speak right now: libspiel loaded and at least one provider is there. */
export function backendCanSpeak(backend: SpeechBackend): boolean {
    return backend.status === 'spiel' && (backend.speaker?.providers.get_n_items() ?? 0) > 0;
}

/**
 * Whether this host can speak at all. `false` means `getVoices()` stays empty and every
 * `speak()` ends in an `error` event, no matter what — which the W3C surface cannot express,
 * since an empty voice list also means "still loading". Quiet; QUERY, not a guarantee.
 */
export async function hasSpeechSynthesisBackend(): Promise<boolean> {
    return backendCanSpeak(await loadSpeechSynthesisBackend());
}

/**
 * The speech stack in words, and — when there is none — why and what to install. For a
 * settings panel or a bug report; branch on {@link hasSpeechSynthesisBackend} instead.
 */
export async function describeSpeechSynthesisBackend(): Promise<string> {
    const backend = await loadSpeechSynthesisBackend();
    if (backend.status !== 'spiel') {
        return `none (${backend.status}): ${backend.diagnostic ?? 'not available on this target'}`;
    }
    const providers = backend.speaker!.providers.get_n_items();
    if (providers === 0) return `none (no-providers): ${NO_PROVIDER_TEXT}`;
    return `libspiel (${backend.source === 'prebuild' ? `gi://Spiel from ${SPIEL_NATIVE}` : 'gi://Spiel, system'}), ${providers} provider(s), ${backend.speaker!.voices.get_n_items()} voice(s)`;
}

/** Reset the cached probe and its one-time diagnostic — tests only. */
export function _resetSpeechBackendCache(): void {
    cached = null;
    reported = false;
}
