// The `gi://Spiel` surface, as types.
//
// HAND-WRITTEN rather than generated, on `@gjsify/gamepad`'s precedent
// (`sdl-namespace.ts`): no `@girs/*` package binds Spiel-1.0 — there is no
// `@girs/spiel-1.0` on npm — and the namespace is five classes. Read off the GIR
// this package's own build produces, so a bump that changes the API changes this
// file in the same commit.
//
// Deliberately INCOMPLETE where upstream is deprecated or unusable from JS:
//
//   · `Provider.get_well_known_name()` is deprecated since libspiel 1.0.4 and GJS
//     prints a warning on every call. `identifier` is the same string and is not.
//   · `Speaker:sink` is `introspectable="0"` in the GIR, so `speaker.sink = el`
//     is a SILENT no-op in GJS. The only spelling that works is
//     `set_property('sink', el)`, which lives on GObject.Object and therefore is
//     not re-declared here — see README.md § No audible output.

/** A `Gio.ListModel` of `T`, as the two members a consumer of this package uses. */
export interface SpielListModel<T> {
    get_n_items(): number;
    get_item(position: number): T | null;
}

/** `Spiel.Voice` — one voice offered by one provider. */
export interface SpielVoice {
    get_name(): string;
    /** Stable within a provider; the half of a voice id that is not the provider. */
    get_identifier(): string;
    /** BCP-47 tags this voice speaks. */
    get_languages(): string[];
    get_provider(): SpielProvider | null;
    /** `SpeechProvider.VoiceFeature` flags, as the plain bitfield GJS sees. */
    get_features(): number;
    hash(): number;
    equal(other: SpielVoice): boolean;
    compare(other: SpielVoice, ...rest: unknown[]): number;
}

/** `Spiel.Provider` — one speech-provider daemon on the session bus. */
export interface SpielProvider {
    /** The D-Bus well-known name, e.g. `org.espeak.Speech.Provider`. */
    get_identifier(): string;
    get_name(): string;
    get_voices(): SpielListModel<SpielVoice> | null;
}

/** `Spiel.Utterance` — a request to speak, with its per-utterance settings. */
export interface SpielUtterance {
    get_text(): string | null;
    set_text(text: string | null): void;
    get_language(): string | null;
    set_language(language: string | null): void;
    get_voice(): SpielVoice | null;
    set_voice(voice: SpielVoice | null): void;
    /** 0..10, 1 is the voice's own. */
    get_rate(): number;
    set_rate(rate: number): void;
    get_pitch(): number;
    set_pitch(pitch: number): void;
    get_volume(): number;
    set_volume(volume: number): void;
    get_is_ssml(): boolean;
    set_is_ssml(isSsml: boolean): void;
}

/** The signals `Spiel.Speaker` emits, with the arguments each carries after the speaker. */
export interface SpielSpeakerSignals {
    'utterance-started': [utterance: SpielUtterance];
    'utterance-finished': [utterance: SpielUtterance];
    'utterance-canceled': [utterance: SpielUtterance];
    'utterance-error': [utterance: SpielUtterance, error: unknown];
    'word-started': [utterance: SpielUtterance, start: number, end: number];
    'sentence-started': [utterance: SpielUtterance, start: number, end: number];
    'range-started': [utterance: SpielUtterance, start: number, end: number];
    'mark-reached': [utterance: SpielUtterance, name: string];
}

/** `Spiel.Speaker` — the client. One per process is enough; it owns the registry. */
export interface SpielSpeaker {
    speak(utterance: SpielUtterance): void;
    pause(): void;
    resume(): void;
    cancel(): void;
    get_voices(): SpielListModel<SpielVoice> | null;
    get_providers(): SpielListModel<SpielProvider> | null;

    /** GObject.Object — the only way to reach the `introspectable="0"` `sink`. */
    set_property(name: string, value: unknown): void;
    get_property(name: string): unknown;
    connect<K extends keyof SpielSpeakerSignals>(
        signal: K,
        callback: (speaker: SpielSpeaker, ...args: SpielSpeakerSignals[K]) => void,
    ): number;
    connect(signal: string, callback: (...args: never[]) => void): number;
    disconnect(id: number): void;
}

/** The `gi://Spiel?version=1.0` namespace — the subset this package answers for. */
export interface SpielNamespace {
    readonly Speaker: {
        /** Blocks until the registry has answered the bus. Throws on failure. */
        new_sync(cancellable?: unknown): SpielSpeaker;
        new (cancellable: unknown, callback: (source: unknown, result: unknown) => void): void;
        new_finish(result: unknown): SpielSpeaker;
    };
    readonly Utterance: { new (props?: Record<string, unknown>): SpielUtterance };
    readonly Provider: object;
    readonly Voice: object;
    readonly VoicesListModel: object;
}
