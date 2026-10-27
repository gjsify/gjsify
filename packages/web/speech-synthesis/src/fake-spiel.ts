// A scripted stand-in for `Spiel.Speaker` — deterministic, no D-Bus, no audio. Structurally
// satisfies the interfaces in `spiel-types.ts`.

import type { SpielNamespace, SpielProvider, SpielSpeaker, SpielUtterance, SpielVoice } from './spiel-types.js';

type Cb = (...args: any[]) => void;

class Emitter {
    #next = 1;
    #handlers = new Map<number, { signal: string; cb: Cb }>();
    connect(signal: string, cb: Cb): number {
        const id = this.#next++;
        this.#handlers.set(id, { signal, cb });
        return id;
    }
    disconnect(id: number): void {
        this.#handlers.delete(id);
    }
    emit(signal: string, ...args: unknown[]): void {
        for (const h of this.#handlers.values()) if (h.signal === signal) h.cb(this, ...args);
    }
}

export class FakeVoices<T> extends Emitter {
    items: T[];
    constructor(items: T[]) {
        super();
        this.items = items;
    }
    get_n_items() {
        return this.items.length;
    }
    get_item(i: number) {
        return this.items[i] ?? null;
    }
    set(items: T[]) {
        const removed = this.items.length;
        this.items = items;
        this.emit('items-changed', 0, removed, items.length);
    }
}

export class FakeSpeaker extends Emitter {
    voices: FakeVoices<SpielVoice>;
    providers: FakeVoices<SpielProvider>;
    speaking = false;
    paused = false;
    spoken: SpielUtterance[] = [];
    calls: string[] = [];
    props: Record<string, unknown> = {};

    constructor(voices: SpielVoice[], providers: SpielProvider[]) {
        super();
        this.voices = new FakeVoices(voices);
        this.providers = new FakeVoices(providers);
    }
    speak(u: SpielUtterance) {
        this.spoken.push(u);
        this.calls.push('speak');
    }
    cancel() {
        this.calls.push('cancel');
        this.emit('utterance-canceled', this.spoken[this.spoken.length - 1]);
    }
    pause() {
        this.calls.push('pause');
    }
    resume() {
        this.calls.push('resume');
    }
    set_property(name: string, value: unknown) {
        this.props[name] = value;
    }
    get last() {
        return this.spoken[this.spoken.length - 1];
    }
}

export const PROVIDER: SpielProvider = { identifier: 'ai.piper.Speech.Provider', name: 'Piper' };
export const voice = (identifier: string, name: string, languages: string[], provider = PROVIDER): SpielVoice => ({
    identifier,
    name,
    languages,
    provider,
});

export function fakeNamespace(speaker: FakeSpeaker): SpielNamespace {
    return {
        Speaker: { new_sync: () => speaker as unknown as SpielSpeaker },
        Utterance: class {
            text = '';
            language = '';
            voice = null;
            pitch = 1;
            rate = 1;
            volume = 1;
            constructor(props: Partial<SpielUtterance>) {
                Object.assign(this, props);
            }
        } as unknown as SpielNamespace['Utterance'],
    };
}
