/**
 * The dialect the SOURCE is written in — not the runtime it is built for.
 *
 * Two vocabularies in this toolchain used to answer the same-sounding question
 * with the same word, and they mean opposite directions:
 *
 *   `gjsify.runtimes['react-native']`  — this PACKAGE runs on React Native (Hermes)
 *   `gjsify build --dialect react-native` — this SOURCE is a React Native app, being
 *                                           built for GTK
 *
 * A package can truthfully be both: shipped to a phone through Metro AND ported to
 * the desktop through this build. While the flag was also spelled `react-native`,
 * those two true statements read as a contradiction, and a reader could reasonably
 * expect a manifest declaring `react-native: 'none'` to fail a `--react-native`
 * build. It never should — they are unrelated facts.
 *
 * So the closed runtime vocabulary keeps the name (it is the older, machine-checked
 * one, parallel to `nativescript`), and the dialect is spelled as what it is. The
 * type is a union rather than a boolean because NativeScript is the named follow-on:
 * `--dialect nativescript` fits here without a second flag.
 */
export type SourceDialect = 'react-native';

/** Every dialect this build understands, for CLI choices and error messages. */
export const SOURCE_DIALECTS: readonly SourceDialect[] = ['react-native'];

/** Whether `value` names a dialect this build understands. */
export function isSourceDialect(value: unknown): value is SourceDialect {
    return typeof value === 'string' && (SOURCE_DIALECTS as readonly string[]).includes(value);
}
