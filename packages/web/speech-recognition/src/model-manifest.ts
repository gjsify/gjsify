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

/** `streaming` feeds `SpeechRecognition`; `offline` decodes a finished recording in `transcribe()`. */
export type RecognitionModelKind = 'streaming' | 'offline';

/** One fetchable transducer, streaming or offline. */
export interface RecognitionModelEntry extends ModelEntry {
    /** Which API loads it. A streaming session never picks an offline model, and the reverse. */
    readonly kind: RecognitionModelKind;
    /** sherpa-onnx `model_type` the offline recognizer needs (e.g. `nemo_transducer`). */
    readonly modelType?: string;
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
/** The default `transcribe()` model: multilingual, detects the language itself. */
export const DEFAULT_TRANSCRIBE_MODEL = 'parakeet-tdt-0.6b-v3-int8';

const PARAKEET = 'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/main';
const REPO = 'https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-de-kroko-2025-08-06/resolve/main';

export const RECOGNITION_MODELS: readonly RecognitionModelEntry[] = [
    {
        id: 'zipformer-de-kroko',
        kind: 'streaming',
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
    {
        id: DEFAULT_TRANSCRIBE_MODEL,
        kind: 'offline',
        modelType: 'nemo_transducer',
        files: [
            {
                file: 'encoder.int8.onnx',
                url: `${PARAKEET}/encoder.int8.onnx`,
                bytes: 652282294,
                sha256: '1afbe69c1ffdabee94755f42e4daf1d93549131a3da11356bda84fcef0f2c479',
            },
            {
                file: 'decoder.int8.onnx',
                url: `${PARAKEET}/decoder.int8.onnx`,
                bytes: 11845274,
                sha256: '0222a86147299d4dee90edf95b6d13827edb42ad8b7c9cf0b2582f030937c0b5',
            },
            {
                file: 'joiner.int8.onnx',
                url: `${PARAKEET}/joiner.int8.onnx`,
                bytes: 6355277,
                sha256: 'cbd02f3696e9944970111fb439d9c3fd365a80374565f13f2b9c7007d253fc98',
            },
            {
                file: 'tokens.txt',
                url: `${PARAKEET}/tokens.txt`,
                bytes: 93939,
                sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d',
            },
        ],
        license: 'CC-BY-4.0',
        redistributable: true,
        description:
            'NVIDIA Parakeet TDT 0.6B v3, int8 (623 MiB) — offline, 25 European languages with automatic language detection.',
        langs: [
            'bg',
            'hr',
            'cs',
            'da',
            'nl',
            'en',
            'et',
            'fi',
            'fr',
            'de',
            'el',
            'hu',
            'it',
            'lv',
            'lt',
            'mt',
            'pl',
            'pt',
            'ro',
            'sk',
            'sl',
            'es',
            'sv',
            'ru',
            'uk',
        ],
        quality: 'conversation',
        sampleRate: 16000,
        // The C shim does not pass sherpa-onnx's hotwords file, BPE vocabulary or modeling unit,
        // which a NeMo transducer needs to encode a hotword; until it does, phrases are not applied.
        hotwords: false,
        encoder: 'encoder.int8.onnx',
        decoder: 'decoder.int8.onnx',
        joiner: 'joiner.int8.onnx',
        tokens: 'tokens.txt',
    },
];

export function findRecognitionModel(id: string = DEFAULT_RECOGNITION_MODEL): RecognitionModelEntry | undefined {
    return RECOGNITION_MODELS.find((entry) => entry.id === id);
}

/** The first model of `kind` that recognizes `lang` (a BCP 47 tag) at `quality` or better. */
export function modelFor(
    lang: string,
    quality: RecognitionQuality = 'command',
    kind: RecognitionModelKind = 'streaming',
): RecognitionModelEntry | undefined {
    const primary = lang.split('-')[0].toLowerCase();
    const wanted = QUALITY_ORDER.indexOf(quality);
    return RECOGNITION_MODELS.find(
        (m) => m.kind === kind && m.langs.includes(primary) && QUALITY_ORDER.indexOf(m.quality) >= wanted,
    );
}
