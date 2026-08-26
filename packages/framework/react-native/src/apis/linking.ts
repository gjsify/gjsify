// `Linking` — `Gtk.UriLauncher`, plus the two things it measurably will not do.
//
// TWO MEASUREMENTS SHAPE THIS FILE, and both were surprises.
//
// 1. **`Gtk.UriLauncher.launch` IS NOT PROMISIFIED.** `@girs/gtk-4.0` declares an
//    overload returning `Promise<boolean>`, and calling it that way throws at
//    runtime: "method Gtk.UriLauncher.launch: At least 3 arguments required, but
//    only 2 passed" (measured, gjs 1.88.1 / GTK 4.22.4). GJS only auto-promisifies
//    a method whose name ends in `_async` unless something calls `Gio._promisify`
//    for it, and nothing does for this one. So the promise is built here, around
//    the callback form. The declared type is a green type over a red runtime, which
//    is exactly why the wrapper exists rather than a direct `await`.
//
// 2. **`launch` NEVER CALLS BACK FOR A SCHEME WITH NO HANDLER.** Measured with
//    `x-gjsify-probe://test`, no parent window: the callback had not fired after
//    3 000 ms and the process exited 0. A promise that never settles is worse than
//    a rejection — an `await Linking.openURL(...)` would simply stop, with no error
//    anywhere. So `openURL` asks `can_launch` FIRST and rejects by name when the
//    answer is no. That check is not defensive padding; it is the only thing
//    between the caller and a hang.
//
// Values through `gi://`, types through `@girs/*` — machine-checked, see
// `app-registry.ts` for the rule and what breaks when it is broken.

import Gtk from 'gi://Gtk?version=4.0';

import { PrimitiveError } from '../primitives/errors.js';

const NO_URL_EVENTS =
    'delivers a URL to a running application, and on a desktop that path is `Gio.Application`’s `open` signal with `HANDLES_OPEN` in the application flags — the APPLICATION’s own wiring, above this layer, because the application object is what receives it. Connect to it where you construct the app';

export const Linking = {
    /**
     * Hand a URI to the desktop's own handler.
     *
     * Resolves when GTK reports success and rejects with the reason otherwise —
     * React Native's own contract. `parent` is null on purpose: a modal app chooser
     * anchored to a window is what a parent buys, and this layer does not know which
     * window the call came from. GTK falls back to an unanchored chooser.
     */
    async openURL(url: string): Promise<void> {
        const launcher = new Gtk.UriLauncher({ uri: url });
        if (!launcher.can_launch(null)) {
            throw new PrimitiveError(
                'Linking',
                'openURL',
                `has no application registered for "${url}". GTK’s own launch call does not report this — measured, the callback never fires for an unhandled scheme — so the check happens before it rather than after`,
            );
        }
        const launched = await new Promise<boolean>((resolve, reject) => {
            launcher.launch(null, null, (_source, result) => {
                try {
                    resolve(launcher.launch_finish(result));
                } catch (error) {
                    reject(error instanceof Error ? error : new Error(String(error)));
                }
            });
        });
        if (!launched) {
            throw new PrimitiveError('Linking', 'openURL', `GTK declined to launch "${url}" and gave no error`);
        }
    },

    /**
     * Is there an application for this URI?
     *
     * `Gtk.UriLauncher.can_launch` is SYNCHRONOUS and React Native's `canOpenURL`
     * is a promise, so this is a resolved one. Measured: `false` for
     * `x-gjsify-probe://`, `true` for `https:` and `mailto:`.
     */
    canOpenURL(url: string): Promise<boolean> {
        return Promise.resolve(new Gtk.UriLauncher({ uri: url }).can_launch(null));
    },

    /**
     * Always `null`, and that is an answer rather than a stub.
     *
     * React Native's `getInitialURL` returns the deep link an app was COLD-STARTED
     * with. On a desktop the equivalent arrives as `Gio.Application::open` after
     * startup, not as a value readable before it — so there is nothing for this to
     * read, in any application, ever. Returning `null` is what React Native itself
     * returns when an app was launched normally, so ported code takes the branch it
     * already has.
     */
    getInitialURL(): Promise<string | null> {
        return Promise.resolve(null);
    },

    addEventListener(): never {
        throw new PrimitiveError('Linking', 'addEventListener', NO_URL_EVENTS);
    },
    addListener(): never {
        throw new PrimitiveError('Linking', 'addListener', NO_URL_EVENTS);
    },
    removeEventListener(): never {
        throw new PrimitiveError('Linking', 'removeEventListener', NO_URL_EVENTS);
    },
    openSettings(): never {
        throw new PrimitiveError(
            'Linking',
            'openSettings',
            'opens the per-app settings page of a phone OS. A desktop application has no such page — GNOME Settings has no per-app section a program can deep-link into — so there is nothing to open',
        );
    },
    sendIntent(): never {
        throw new PrimitiveError(
            'Linking',
            'sendIntent',
            'sends an Android Intent. The desktop counterpart of that idea is a D-Bus activation or a `Gio.AppInfo` launch, and neither takes an Intent’s shape',
        );
    },
} as const;
