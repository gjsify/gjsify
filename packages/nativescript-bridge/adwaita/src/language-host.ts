// How the NativeScript door learns the user's languages for `GLib.get_language_names()`: the platform's
// own list, `./language-source.ts` and its `.android` / `.ios` variants, read per call.

import { platformLanguageTags } from './language-source.js';

let replacement: (() => string[]) | null = null;

/** @internal A seam for the specs: `null` restores the platform's own. */
export function useLanguageHost(host: (() => string[]) | null): void {
    replacement = host;
}

export function hostLanguageTags(): string[] {
    return replacement ? replacement() : platformLanguageTags();
}
