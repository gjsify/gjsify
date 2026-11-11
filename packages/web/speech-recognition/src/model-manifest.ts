// The recognition models this package knows how to fetch (ADR 0127 decision 8).
//
// A TS MODULE for the same reason `@gjsify/vad`'s is: the library is bundled, and
// a JSON import would become a path lookup relative to the bundle at runtime.
//
// `bytes` and `sha256` were measured from the files `install()` writes (the HF
// LFS pointers for the three .onnx files; `tokens.txt` is not LFS and was hashed
// after download). They are the whole verification — re-measure both together.

import type { ModelEntry } from '@gjsify/model-store';

/** The Web Speech `SpeechRecognitionQuality`, ordered. */
export type RecognitionQuality = 'command' | 'dictation' | 'conversation';

export const QUALITY_ORDER: readonly RecognitionQuality[] = ['command', 'dictation', 'conversation'];

/** One fetchable streaming transducer. */
export interface RecognitionModelEntry extends ModelEntry {
    readonly description: string;
    /** Primary language subtags this model recognizes (`de` covers `de-DE`, `de-AT`, …). */
    readonly langs: readonly string[];
    /** The best `quality` this model honestly serves; a request for more is `unavailable`. */
    readonly quality: RecognitionQuality;
    readonly sampleRate: number;
    /** Whether `phrases` can bias it. False = error `phrases-not-supported`, as the spec says. */
    readonly hotwords: boolean;
    /** File names inside the entry, by role. */
    readonly encoder: string;
    readonly decoder: string;
    readonly joiner: string;
    readonly tokens: string;
}

export const DEFAULT_RECOGNITION_MODEL = 'zipformer-de-kroko';

const REPO = 'https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-de-kroko-2025-08-06/resolve/main';

export const RECOGNITION_MODELS: readonly RecognitionModelEntry[] = [
    {
        id: 'zipformer-de-kroko',
        files: [
            {
                file: 'encoder.onnx',
                url: `${REPO}/encoder.onnx`,
                bytes: 70091557,
                sha256: '6e83993d6967ec7a3498b055b7e85ace85b5d64d1b1e8773cb29a43a11f5edb5',
            },
            {
                file: 'decoder.onnx',
                url: `${REPO}/decoder.onnx`,
                bytes: 617489,
                sha256: '94a29592b403c53fa2231b478637da1ab4abcef7f5e46e432098416a4a3ed562',
            },
            {
                file: 'joiner.onnx',
                url: `${REPO}/joiner.onnx`,
                bytes: 336817,
                sha256: '28356bff070aea51ab1d725a3278e81d19f9300f860d3248a7014292264df15a',
            },
            {
                file: 'tokens.txt',
                url: `${REPO}/tokens.txt`,
                bytes: 5606,
                sha256: '86e8370994ff2c01149ba8c4f8709aa93cdc18914b27a717e291e96faf39a6eb',
            },
        ],
        // Kroko advertises its community models as CC-BY-SA; the sherpa-onnx mirror
        // carries no license file. Stated as found, and never redistributed from here.
        license: 'Kroko community model (advertised CC-BY-SA; the mirror declares none)',
        redistributable: false,
        description: 'Kroko streaming zipformer, German (68 MB) — interim results on CPU, ~32 ms after end of speech.',
        langs: ['de'],
        quality: 'dictation',
        sampleRate: 16000,
        hotwords: false,
        encoder: 'encoder.onnx',
        decoder: 'decoder.onnx',
        joiner: 'joiner.onnx',
        tokens: 'tokens.txt',
    },
];

export function findRecognitionModel(id: string = DEFAULT_RECOGNITION_MODEL): RecognitionModelEntry | undefined {
    return RECOGNITION_MODELS.find((entry) => entry.id === id);
}

/** The first model that recognizes `lang` (a BCP 47 tag) at `quality` or better. */
export function modelFor(lang: string, quality: RecognitionQuality = 'command'): RecognitionModelEntry | undefined {
    const primary = lang.split('-')[0].toLowerCase();
    const wanted = QUALITY_ORDER.indexOf(quality);
    return RECOGNITION_MODELS.find((m) => m.langs.includes(primary) && QUALITY_ORDER.indexOf(m.quality) >= wanted);
}
