// `expo-web-browser` — the user's own browser, which is the desktop counterpart.
//
// ON A PHONE this opens an IN-APP browser: a view inside the application, which the
// application can dismiss and whose redirects it can intercept. Neither exists on a
// desktop, and neither should be simulated — the desktop idiom is to hand the URI to
// whatever the user chose, which is `Gtk.UriLauncher` and is what `Linking.openURL`
// already does.
//
// THE ONE THING THIS CANNOT DO, and it is stated in the table rather than hidden:
// React Native resolves `openBrowserAsync` when the user DISMISSES the browser. Here
// the page is in another application and this process is never told, so the promise
// resolves as soon as the launch succeeds. Code that awaits it to know the user is
// back will continue early — which is loud in the table and silent in the window,
// which is why it is in the table.
//
// `openAuthSessionAsync` therefore refuses rather than degrading to `openBrowserAsync`:
// the INTERCEPTION is the whole feature, and with the system browser the redirect
// comes back as `Gio.Application::open`, which is the application's own wiring.

import { Linking } from '../apis/index.js';

/** expo-web-browser's result constants. */
export const WebBrowserResultType = {
    cancel: 'cancel',
    dismiss: 'dismiss',
    opened: 'opened',
    locked: 'locked',
} as const;

export interface WebBrowserResult {
    readonly type: (typeof WebBrowserResultType)[keyof typeof WebBrowserResultType];
}

/**
 * Open `url` in the user's browser.
 *
 * Every presentation option is ignored — `toolbarColor`, `controlsColor`,
 * `showTitle`, `enableBarCollapsing`, `presentationStyle` — because they describe an
 * in-app browser this layer does not draw. Declared in the table rather than refused
 * per option: they are appearance hints on a surface that does not exist, which is
 * the same class as `StatusBar`'s declarative props.
 */
export async function openBrowserAsync(
    url: string,
    _options?: Readonly<Record<string, unknown>>,
): Promise<WebBrowserResult> {
    await Linking.openURL(url);
    return { type: WebBrowserResultType.opened };
}

export * from '../generated/unsupported-expo-web-browser.js';
