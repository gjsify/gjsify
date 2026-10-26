// Speech backend availability — the ONE place this package decides whether libspiel and a
// speech provider exist on this host, and where a failed load is CLASSIFIED.
//
// Same shape as `@gjsify/gamepad/backend`: a cached probe, `absent` (expected: no typelib,
// no provider, wrong OS) split from `failed` (a fault that must be loud), a QUIET
// capability query, and a diagnostic printed from the USE site (`speak()`), once.
// The W3C surface cannot tell "no voices installed" from "no speech stack at all"; the
// `has…`/`describe…` pair is the non-standard way to ask.

import { hostOs, type TargetOs } from '@gjsify/utils/core';

import type { SpielNamespace, SpielSpeaker } from './spiel-types.js';

export type SpeechBackendStatus = 'spiel' | 'absent' | 'failed';

export interface SpeechBackend {
    status: SpeechBackendStatus;
    speaker: SpielSpeaker | null;
    namespace: SpielNamespace | null;
    /** The original load error for `absent`/`failed`; `null` otherwise. */
    error: unknown;
    /** The one-time line the USE site prints; `null` = nothing to say. */
    diagnostic: string | null;
}

export interface LoadSpeechBackendOptions {
    /** Override the `gi://Spiel` import. Tests only. */
    importer?: () => Promise<{ default: unknown }>;
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

// ---------------------------------------------------------------------------------------
// @gjsify/spiel-native integration point.
//
// System libspiel always wins: the import below is a plain `gi://Spiel`, resolved by GI
// against the system typelib path first. `@gjsify/spiel-native` (optionalDependency, same
// pattern as `@gjsify/gamepad-native`) contributes NO code here — when installed, the
// launcher (`gjsify run`) puts its prebuilds/<os>-<arch> directory on GI_TYPELIB_PATH and
// the library path, so the same import finds the bundled copy when the system has none.
// The only thing this package says about it is the advice in the text below.
const SPIEL_NATIVE = '@gjsify/spiel-native';
// ---------------------------------------------------------------------------------------

const NO_TYPELIB_TEXT =
    '[@gjsify/speech-synthesis] No speech backend on this host — the Spiel-1.0 typelib (libspiel) is absent, ' +
    'so getVoices() is empty and speak() fires an error event (synthesis-unavailable). ' +
    `Install libspiel from your distribution, or add ${SPIEL_NATIVE} and start the program through ` +
    '`gjsify run`. ' +
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
    '[@gjsify/speech-synthesis] The gi://Spiel speech backend failed to load — a fault on this host, NOT a ' +
    'missing libspiel. getVoices() is empty until it is fixed.';

let cached: Promise<SpeechBackend> | null = null;
let reported = false;

/** GI's wording for "no typelib for this namespace anywhere" (measured, see the gamepad probe). */
const TYPELIB_ABSENT_NEEDLE = "Typelib file for namespace 'Spiel'";

/** `--app browser` maps every `gi://*` to `{}`; nothing to install, nothing to say. */
function isEmptiedGiModule(module: unknown): boolean {
    return (
        typeof module === 'object' &&
        module !== null &&
        Object.getPrototypeOf(module) === Object.prototype &&
        Object.getOwnPropertyNames(module).length === 0
    );
}

/** Classify a `gi://Spiel` load failure. Exported (underscored) for the specs. */
export function _diagnoseSpielLoadError(error: unknown): { status: 'absent' | 'failed'; diagnostic: string } {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes(TYPELIB_ABSENT_NEEDLE)
        ? { status: 'absent', diagnostic: NO_TYPELIB_TEXT }
        : { status: 'failed', diagnostic: LOAD_FAULT_TEXT };
}

async function probe(options: LoadSpeechBackendOptions): Promise<SpeechBackend> {
    const os = (options.hostOs ?? hostOs)();
    if (os === 'darwin' || os === 'win32') {
        return { status: 'absent', speaker: null, namespace: null, error: null, diagnostic: UNSUPPORTED_OS_TEXT };
    }

    let speaker: SpielSpeaker;
    let spiel: SpielNamespace;
    try {
        // A LITERAL specifier: every plugin that claims `gi://*` matches it at build time.
        const imported = options.importer ? options.importer() : import('gi://Spiel?version=1.0');
        const module = (await imported).default as SpielNamespace;
        spiel = module;
        if (typeof module?.Speaker?.new_sync !== 'function') {
            if (isEmptiedGiModule(module)) return { status: 'absent', speaker: null, namespace: null, error: null, diagnostic: null };
            throw new Error('gi://Spiel resolved without a Speaker class — unexpected Spiel ABI');
        }
        // Speaker creation activates the providers over D-Bus (~20 ms warm, ~600 ms cold)
        // and is the second thing that can fail on a host whose typelib loads fine.
        speaker = module.Speaker.new_sync(null);
        options.configureSpeaker?.(speaker);
    } catch (error) {
        const { status, diagnostic } = _diagnoseSpielLoadError(error);
        return { status, speaker: null, namespace: null, error, diagnostic };
    }
    const noProvider = speaker.providers.get_n_items() === 0;
    return { status: 'spiel', speaker, namespace: spiel!, error: null, diagnostic: noProvider ? NO_PROVIDER_TEXT : null };
}

/**
 * Resolve (once) what speech stack this host has. Emits NOTHING. Passing options after the
 * probe ran THROWS instead of being ignored — call {@link _resetSpeechBackendCache} first.
 */
export function loadSpeechSynthesisBackend(options: LoadSpeechBackendOptions = {}): Promise<SpeechBackend> {
    if (cached !== null) {
        if (options.importer || options.hostOs || options.configureSpeaker) {
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
    return `libspiel (gi://Spiel), ${providers} provider(s), ${backend.speaker!.voices.get_n_items()} voice(s)`;
}

/** Reset the cached probe and its one-time diagnostic — tests only. */
export function _resetSpeechBackendCache(): void {
    cached = null;
    reported = false;
}
