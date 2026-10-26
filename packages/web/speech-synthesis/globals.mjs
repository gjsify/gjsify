/**
 * Re-exports the native Web Speech synthesis globals for browser builds; the libspiel GJS
 * backend stays GJS-only.
 *
 * `@gjsify/resolve-npm/runtime-aliases.mjs` routes `@gjsify/speech-synthesis` here whenever
 * `gjsify.runtimes.<target> === "native"`, so every root export a consumer may import must
 * be answerable from here or the routed bundle dies with `MISSING_EXPORT`.
 */

export const speechSynthesis = globalThis.speechSynthesis;
export const SpeechSynthesis = globalThis.SpeechSynthesis;
export const SpeechSynthesisUtterance = globalThis.SpeechSynthesisUtterance;
export const SpeechSynthesisVoice = globalThis.SpeechSynthesisVoice;
export const SpeechSynthesisEvent = globalThis.SpeechSynthesisEvent;
export const SpeechSynthesisErrorEvent = globalThis.SpeechSynthesisErrorEvent;

/**
 * Whether this host can speak at all. REAL rather than omitted (the README's recommended
 * usage must build on every target): a browser ships its own voices.
 */
export async function hasSpeechSynthesisBackend() {
    return typeof globalThis.speechSynthesis?.speak === 'function';
}

/** Which backend speaks, in words. In a browser: the browser's own. */
export async function describeSpeechSynthesisBackend() {
    return (await hasSpeechSynthesisBackend()) ? 'browser (native speechSynthesis)' : 'none';
}
