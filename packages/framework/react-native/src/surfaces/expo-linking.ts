// `expo-linking` — `react-native`'s own `Linking`, plus the two things it adds.
//
// `openURL`, `canOpenURL` and `getInitialURL` are RE-EXPORTED (ADR 0036 § 4), so the
// two measurements that shape `Linking` hold here unchanged: `Gtk.UriLauncher.launch`
// is not promisified, and it never calls back at all for a scheme with no handler —
// which is why `openURL` asks `can_launch` first rather than handing the caller a
// promise that stops.
//
// What expo-linking adds and this answers: `useURL`, the hook form of the initial
// URL, and `parse`, which is pure URL arithmetic and needs no platform at all.
//
// `createURL` REFUSES, and it is the one refusal here worth a sentence: it builds a
// URL from the application's own scheme, which expo reads out of `app.json`. There is
// no Expo config in this chain; a desktop application's identity is its
// `Gio.Application` id and its scheme is a declaration in its desktop entry.

import { Linking } from '../apis/index.js';

/** expo-linking's shape for a parsed URL. */
export interface ParsedURL {
    readonly scheme: string | null;
    readonly hostname: string | null;
    readonly path: string | null;
    readonly queryParams: Readonly<Record<string, string>> | null;
}

export const openURL = (url: string): Promise<void> => Linking.openURL(url);
export const canOpenURL = (url: string): Promise<boolean> => Linking.canOpenURL(url);
export const getInitialURL = (): Promise<string | null> => Linking.getInitialURL();

/**
 * Always `null`, and it never updates.
 *
 * `getInitialURL`'s hook form. A URL delivered while the application is running
 * arrives as `Gio.Application::open` with `HANDLES_OPEN` in the flags — the
 * application object's own wiring, above this layer — which is the same refusal
 * `Linking.addEventListener` gives. So there is nothing for this hook to subscribe to,
 * and it returns a constant rather than a value that looks live.
 */
export function useURL(): string | null {
    return null;
}

/**
 * A URL string → expo-linking's `{ scheme, hostname, path, queryParams }`.
 *
 * Over the WHATWG `URL`, which gjsify provides, so this is arithmetic rather than a
 * platform question — and it is the one function in this surface that a test can hold
 * against a specification.
 *
 * TWO NARROWINGS, both declared in the table. `queryParams` values are strings, where
 * expo-linking returns `string[]` for a repeated key — the same narrowing
 * `useLocalSearchParams` already declares, and for the same reason. And a
 * custom-scheme URL with no `//` (`myapp:profile`) parses with a null hostname and the
 * whole remainder as the path, which is what the URL standard says and is not always
 * what a phone deep link meant.
 */
export function parse(url: string): ParsedURL {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        // expo-linking answers with nulls for something it cannot parse rather than
        // throwing, and a refusal here would break the ordinary defensive call site
        // (`parse(useURL() ?? '')`).
        return { scheme: null, hostname: null, path: null, queryParams: null };
    }
    const queryParams: Record<string, string> = {};
    let any = false;
    for (const [key, value] of parsed.searchParams) {
        queryParams[key] = value;
        any = true;
    }
    return {
        scheme: parsed.protocol === '' ? null : parsed.protocol.replace(/:$/, ''),
        hostname: parsed.hostname === '' ? null : parsed.hostname,
        path: parsed.pathname === '' ? null : parsed.pathname.replace(/^\//, ''),
        queryParams: any ? queryParams : null,
    };
}

export * from '../generated/unsupported-expo-linking.js';
