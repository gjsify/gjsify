// `expo-constants` — the Expo config object, which a desktop application does not have.
//
// `Constants.expoConfig`, `appOwnership`, `executionEnvironment`, `manifest`,
// `sessionId`: every one of them describes a build produced by Expo's own toolchain. A
// GTK application's identity is its `Gio.Application` id and its metadata is its
// desktop entry; there is no manifest here to read.
//
// A SHAPE FULL OF PLAUSIBLE NULLS WOULD BE WORSE THAN A REFUSAL, which is the whole
// reason this surface is a refusal rather than a stub: `Constants.expoConfig?.name`
// reads as "not configured" and sends a porter to look for their configuration, where
// the truth is that the concept does not apply. The refusal says the second thing.

import { unsupported } from '../unsupported.js';

/**
 * The default export, refusing by name.
 *
 * Written here rather than generated, because `export * from` never carries a
 * `default` and `export const default` is not a thing. The module is passed so the
 * sentence is this surface's own — without it the one-argument lookup would answer
 * from whichever table has a `default` first.
 */
export default unsupported('default', 'expo-constants');

export * from '../generated/unsupported-expo-constants.js';
