// Web Speech API — SpeechSynthesisVoice
// Reference: https://webaudio.github.io/web-speech-api/#speechsynthesisvoice

import type { SpielVoice } from './spiel-types.js';

/** The Spiel voice behind a SpeechSynthesisVoice; the web object itself stays plain data. */
const spielVoices = new WeakMap<SpeechSynthesisVoice, SpielVoice>();

export class SpeechSynthesisVoice {
    readonly voiceURI: string;
    readonly name: string;
    readonly lang: string;
    readonly localService: boolean;
    readonly default: boolean;

    /** Not constructible from user code in browsers; here only `getVoices()` builds them. */
    constructor(init: { voiceURI: string; name: string; lang: string; localService: boolean; default: boolean }) {
        this.voiceURI = init.voiceURI;
        this.name = init.name;
        this.lang = init.lang;
        this.localService = init.localService;
        this.default = init.default;
    }

    get [Symbol.toStringTag]() {
        return 'SpeechSynthesisVoice';
    }
}

/** voiceURI = provider identifier + voice identifier, so two providers can offer the same voice. */
export function voiceUriOf(voice: SpielVoice): string {
    return `${voice.provider.identifier}#${voice.identifier}`;
}

export function createVoice(voice: SpielVoice, isDefault: boolean): SpeechSynthesisVoice {
    const web = new SpeechSynthesisVoice({
        voiceURI: voiceUriOf(voice),
        name: voice.name,
        lang: voice.languages?.[0] ?? '',
        // Spiel providers are local D-Bus services; gjsify ships no cloud voices.
        localService: true,
        default: isDefault,
    });
    spielVoices.set(web, voice);
    return web;
}

export function spielVoiceOf(voice: SpeechSynthesisVoice | null | undefined): SpielVoice | undefined {
    return voice ? spielVoices.get(voice) : undefined;
}
