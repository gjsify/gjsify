// Web Speech API — the result classes and SpeechRecognitionPhrase.
// Reference: https://webaudio.github.io/web-speech-api/#speechreco-result

export class SpeechRecognitionAlternative {
    readonly transcript: string;
    readonly confidence: number;

    constructor(transcript: string, confidence = 0) {
        this.transcript = transcript;
        this.confidence = confidence;
    }

    get [Symbol.toStringTag]() {
        return 'SpeechRecognitionAlternative';
    }
}

export interface SpeechRecognitionResultInit {
    alternatives: SpeechRecognitionAlternative[];
    isFinal: boolean;
    /** Seconds on the session's audio timeline, which starts at 0.0 at the first frame consumed. */
    speechStartTime?: number;
    speechEndTime?: number;
}

export class SpeechRecognitionResult {
    readonly isFinal: boolean;
    readonly speechStartTime: number;
    readonly speechEndTime: number;
    readonly length: number;
    readonly [index: number]: SpeechRecognitionAlternative;

    constructor(init: SpeechRecognitionResultInit) {
        this.isFinal = init.isFinal;
        this.speechStartTime = init.speechStartTime ?? 0;
        this.speechEndTime = init.speechEndTime ?? 0;
        this.length = init.alternatives.length;
        init.alternatives.forEach((alternative, i) => {
            Object.defineProperty(this, i, { value: alternative, enumerable: true });
        });
    }

    item(index: number): SpeechRecognitionAlternative {
        return (this as unknown as Record<number, SpeechRecognitionAlternative>)[index];
    }

    get [Symbol.toStringTag]() {
        return 'SpeechRecognitionResult';
    }
}

export class SpeechRecognitionResultList {
    readonly length: number;
    readonly [index: number]: SpeechRecognitionResult;

    constructor(results: readonly SpeechRecognitionResult[] = []) {
        this.length = results.length;
        results.forEach((result, i) => {
            Object.defineProperty(this, i, { value: result, enumerable: true });
        });
    }

    item(index: number): SpeechRecognitionResult {
        return (this as unknown as Record<number, SpeechRecognitionResult>)[index];
    }

    [Symbol.iterator](): Iterator<SpeechRecognitionResult> {
        let i = 0;
        return {
            next: () =>
                i < this.length
                    ? { value: this.item(i++), done: false }
                    : { value: undefined as unknown as SpeechRecognitionResult, done: true },
        };
    }

    get [Symbol.toStringTag]() {
        return 'SpeechRecognitionResultList';
    }
}

/** A contextual-biasing term. `boost` is advisory and must lie in [0, 10]. */
export class SpeechRecognitionPhrase {
    readonly phrase: string;
    readonly boost: number;

    constructor(phrase: string, boost = 1.0) {
        if (!(boost >= 0 && boost <= 10)) {
            throw syntaxError(`SpeechRecognitionPhrase boost must be within [0, 10], got ${boost}`);
        }
        this.phrase = String(phrase);
        this.boost = boost;
    }

    get [Symbol.toStringTag]() {
        return 'SpeechRecognitionPhrase';
    }
}

/** A `SyntaxError` DOMException where the runtime has one, a named `Error` otherwise. */
export function syntaxError(message: string): Error {
    return namedError(message, 'SyntaxError');
}

export function namedError(message: string, name: string): Error {
    const Ctor = (globalThis as { DOMException?: new (message: string, name: string) => Error }).DOMException;
    if (Ctor) return new Ctor(message, name);
    const error = new Error(message);
    error.name = name;
    return error;
}
