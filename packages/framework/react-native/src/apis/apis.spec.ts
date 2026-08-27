// The four P1 APIs. `Platform` needs nothing; the other three need GTK.
//
// Split into two halves rather than gated wholesale, because `Platform.select`'s
// refusals and `Platform.OS`' mapping are pure decisions and a suite that stood
// down would report success having checked none of them — the green-that-checked-
// nothing shape this repository keeps finding.
//
// WHAT IS NOT ASSERTED, and it is deliberate. `Linking.openURL` is not called with a
// launchable URI: succeeding would open a browser on the machine running the suite,
// and there is no way to ask GTK to pretend. What IS asserted is the refusal path,
// which is the half that carries the measurement — `Gtk.UriLauncher.launch` never
// calls back for a scheme with no handler (3 000 ms, no callback, exit 0), so
// `openURL` asks `can_launch` first and rejects rather than hanging.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import { afterEach, beforeEach, describe, expect, it, on, type Runtime } from '@gjsify/unit';
import { installDiagnosticsGate } from '@gjsify/gtk-host/conformance';

import { currentColorScheme, onColorSchemeChange } from './color-scheme.js';
import { Linking } from './linking.js';
import { Platform, resetPlatformCache } from './platform.js';
import { Share } from './share.js';
import { PrimitiveError } from '../primitives/errors.js';

const GTK_HOSTS: Runtime[] = ['Gjs', 'Node.js', 'Bun', 'Deno'];

const threw = (fn: () => unknown): PrimitiveError => {
    try {
        fn();
    } catch (error) {
        if (error instanceof PrimitiveError) return error;
        throw error;
    }
    throw new Error('expected a PrimitiveError, nothing was thrown');
};

export default async () => {
    await describe('Platform', async () => {
        await it('reports one of the three operating systems ADR 0018 declares', async () => {
            resetPlatformCache();
            expect(['linux', 'macos', 'windows']).toContain(Platform.OS);
        });

        await it('picks this OS’s branch, then `default`', async () => {
            expect(Platform.select({ [Platform.OS]: 'mine', default: 'fallback' })).toBe('mine');
            expect(Platform.select({ default: 'fallback' })).toBe('fallback');
        });

        await it('does NOT consult `native`, and says so', async () => {
            // ADR 0032 § 9's reasoning, one API over: a `native` branch is written
            // for a React Native runtime, and handing it to a GTK build is a failure
            // that surfaces in a window rather than at build time.
            const error = threw(() => Platform.select({ ios: 'a', android: 'b', native: 'c' }));
            expect(error.message).toContain('`native` branch is not consulted');
            expect(error.message).toContain('add a `default`');
        });

        await it('refuses Version and constants by name rather than answering wrongly', async () => {
            expect(threw(() => Platform.Version).message).toContain('MOBILE OS version');
            expect(threw(() => Platform.constants).message).toContain('no bridge here');
        });

        await it('states the two facts a desktop can state', async () => {
            expect(Platform.isTV).toBe(false);
            expect(Platform.isTesting).toBe(false);
        });
    });

    await on(GTK_HOSTS, async () => {
        Gtk.init();
        Adw.init();
        const diagnostics = installDiagnosticsGate();
        const gated = (name: string, run: () => Promise<void>): Promise<void> =>
            describe(name, async () => {
                beforeEach(() => diagnostics.reset());
                afterEach(() => diagnostics.assertQuiet());
                await run();
            }) as Promise<void>;

        await gated('Linking', async () => {
            await it('answers canOpenURL from Gtk.UriLauncher, synchronously underneath', async () => {
                // ONLY THE FALSE DIRECTION IS ASSERTED, and that is the whole lesson
                // of this vector. `canOpenURL` asks GTK whether a handler is
                // INSTALLED, so asserting `https:` is openable asserts that the
                // machine running the test has a browser. It does on a desktop and it
                // does not in a headless container — measured: this test passed here
                // and failed the Fedora shard in CI, which is a claim about the host
                // masquerading as a claim about the code.
                //
                // What IS ours: that the answer is a boolean, that it comes back
                // without waiting on a callback, and that a scheme nobody can handle
                // is `false`. A made-up scheme is stable on every host.
                expect(typeof (await Linking.canOpenURL('https://example.invalid/'))).toBe('boolean');
                expect(await Linking.canOpenURL('x-gjsify-probe://nothing')).toBe(false);
            });

            await it('rejects an unhandled scheme instead of waiting for a callback that never comes', async () => {
                let message = '';
                try {
                    await Linking.openURL('x-gjsify-probe://nothing');
                } catch (error) {
                    message = (error as Error).message;
                }
                expect(message).toContain('no application registered');
            });

            await it('resolves getInitialURL to null, which is React Native’s normal-launch answer', async () => {
                expect(await Linking.getInitialURL()).toBeNull();
            });

            await it('refuses the URL-event surface, naming where it lives on a desktop', async () => {
                expect(threw(() => Linking.addEventListener()).message).toContain('Gio.Application');
                expect(threw(() => Linking.openSettings()).message).toContain('no such page');
                expect(threw(() => Linking.sendIntent()).message).toContain('Android Intent');
            });
        });

        await gated('Share', async () => {
            await it('puts message and url on the clipboard, newline-joined', async () => {
                // `Gdk.Clipboard.set_text` DOES NOT EXIST under introspection
                // (measured: "cb.set_text is not a function"); `set(value)` is the
                // introspectable route and it round-trips.
                const result = await Share.share({ message: 'look', url: 'https://example.invalid/' });
                expect(result.action).toBe('sharedAction');
                const text = await readClipboard();
                expect(text).toBe('look\nhttps://example.invalid/');
            });

            await it('refuses an empty share rather than DISCARDING what the user had copied', async () => {
                expect(threw(() => Share.share({})).message).toContain('DISCARD');
            });

            await it('exports dismissedAction even though it never occurs', async () => {
                // Nothing here asks the user anything, so a dismissal cannot happen —
                // but ported code compares against the constant, and an absent one is
                // a MISSING_EXPORT rather than a comparison that is simply never true.
                expect(Share.dismissedAction).toBe('dismissedAction');
            });
        });

        await gated('useColorScheme’s GTK half', async () => {
            await it('reads what the user is LOOKING AT, not what the app asked for', async () => {
                // `Adw.StyleManager:dark` and not `:color-scheme`: the latter is the
                // application's own request and its default is DEFAULT (measured as
                // the numeric 0), so a subscriber on it would never fire for the one
                // event this API exists to report.
                const manager = Adw.StyleManager.get_default();
                expect(currentColorScheme()).toBe(manager.dark ? 'dark' : 'light');
            });

            await it('notifies on a change and disconnects on dispose', async () => {
                const manager = Adw.StyleManager.get_default();
                const seen: string[] = [];
                const dispose = onColorSchemeChange((scheme) => seen.push(scheme));
                const original = manager.colorScheme;
                manager.colorScheme = manager.dark ? Adw.ColorScheme.FORCE_LIGHT : Adw.ColorScheme.FORCE_DARK;
                expect(seen.length).toBe(1);
                dispose();
                // After the disposer, the same flip must reach nobody. A handler that
                // is not disconnected stays connected for the life of the process —
                // GJS blocks JS callbacks during GC, so nothing later collects it.
                manager.colorScheme = manager.dark ? Adw.ColorScheme.FORCE_LIGHT : Adw.ColorScheme.FORCE_DARK;
                expect(seen.length).toBe(1);
                manager.colorScheme = original;
            });
        });
    });
};

/** Read the clipboard back, because a write nobody reads proves nothing. */
function readClipboard(): Promise<string> {
    const clipboard = Gtk.Widget.prototype.get_clipboard.call(new Gtk.Label()) as {
        read_text_async(cancellable: null, callback: (source: unknown, result: unknown) => void): void;
        read_text_finish(result: unknown): string | null;
    };
    return new Promise((resolve, reject) => {
        clipboard.read_text_async(null, (_source, result) => {
            try {
                resolve(clipboard.read_text_finish(result) ?? '');
            } catch (error) {
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    });
}
