/**
 * Re-exports the browser's own Web Speech recognition globals; the sherpa-onnx GJS backend
 * stays GJS-only.
 *
 * `@gjsify/resolve-npm/runtime-aliases.mjs` routes `@gjsify/speech-recognition` here whenever
 * `gjsify.runtimes.<target> === "native"`, so every root export a consumer may import must
 * be answerable from here or the routed bundle dies with `MISSING_EXPORT`.
 */

export const SpeechRecognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
export const SpeechRecognitionEvent = globalThis.SpeechRecognitionEvent;
export const SpeechRecognitionErrorEvent = globalThis.SpeechRecognitionErrorEvent;
export const SpeechRecognitionResult = globalThis.SpeechRecognitionResult;
export const SpeechRecognitionResultList = globalThis.SpeechRecognitionResultList;
export const SpeechRecognitionAlternative = globalThis.SpeechRecognitionAlternative;
export const SpeechRecognitionPhrase = globalThis.SpeechRecognitionPhrase;

/** Whether this host has a recognizer at all. In a browser: the browser's own. */
export async function hasSpeechRecognitionBackend() {
    return typeof SpeechRecognition === 'function';
}

/** Which backend recognizes, in words. In a browser: the browser's own. */
export async function describeSpeechRecognitionBackend() {
    return (await hasSpeechRecognitionBackend()) ? 'browser (native SpeechRecognition)' : 'none';
}
