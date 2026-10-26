// The slice of Spiel-1.0 this package touches, typed by hand until @girs/spiel-1.0 exists
// (see `spiel-1.0.d.ts`). Structural on purpose: the fake speaker the specs drive satisfies
// the same interfaces as the real GObject wrappers.

export interface SpielProvider {
    identifier: string;
    name: string;
}

export interface SpielVoice {
    identifier: string;
    name: string;
    /** BCP 47 tags, best match first. */
    languages: string[];
    provider: SpielProvider;
}

export interface SpielListModel<T> {
    get_n_items(): number;
    get_item(position: number): T | null;
    connect(signal: 'items-changed', cb: (model: unknown, position: number, removed: number, added: number) => void): number;
    disconnect(id: number): void;
}

export interface SpielUtterance {
    text: string;
    language: string;
    voice: SpielVoice | null;
    pitch: number;
    rate: number;
    volume: number;
}

export interface SpielError {
    code: number;
    message: string;
}

export interface SpielSpeaker {
    voices: SpielListModel<SpielVoice>;
    providers: SpielListModel<SpielProvider>;
    speaking: boolean;
    paused: boolean;
    speak(utterance: SpielUtterance): void;
    cancel(): void;
    pause(): void;
    resume(): void;
    /** `sink` is not introspectable: only `set_property('sink', element)` reaches it. */
    set_property(name: string, value: unknown): void;
    connect(signal: string, cb: (...args: any[]) => void): number;
    disconnect(id: number): void;
}

export interface SpielNamespace {
    Speaker: { new_sync(cancellable: null): SpielSpeaker };
    Utterance: new (props: Partial<SpielUtterance>) => SpielUtterance;
}

/** `Spiel.Error` codes (the GIR enum), by number — the GIR carries no names at runtime we can rely on. */
export const SPIEL_ERROR = {
    NO_PROVIDERS: 0,
    MISCONFIGURED_VOICE: 1,
    PROVIDER_UNEXPECTEDLY_DIED: 2,
    INTERNAL_PROVIDER_FAILURE: 3,
} as const;
