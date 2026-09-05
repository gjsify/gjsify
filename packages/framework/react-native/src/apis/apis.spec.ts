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
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import { afterEach, beforeEach, describe, expect, it, on, type Runtime } from '@gjsify/unit';
import { installDiagnosticsGate } from '@gjsify/gtk-host/conformance';

import { Alert } from './alert.js';
import { Appearance } from './appearance.js';
import { currentColorScheme, onColorSchemeChange } from './color-scheme.js';
import { Dimensions } from './dimensions.js';
import { resetWindowMetricsCache } from './display.js';
import { Keyboard } from './keyboard.js';
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

        await gated('Appearance, over the same reader', async () => {
            await it('reads the same scheme useColorScheme does', async () => {
                // ONE reader, and this is what says so: a second one would disagree in
                // the one moment that matters, while the desktop is switching.
                expect(Appearance.getColorScheme()).toBe(currentColorScheme());
            });

            await it('round-trips setColorScheme through Adw.ColorScheme’s FORCE members', async () => {
                // The transitions, never the starting value: whether this desktop is
                // dark right now is a fact about the machine.
                const manager = Adw.StyleManager.get_default();
                const original = manager.colorScheme;
                try {
                    Appearance.setColorScheme('light');
                    expect(manager.colorScheme).toBe(Adw.ColorScheme.FORCE_LIGHT);
                    expect(Appearance.getColorScheme()).toBe('light');
                    Appearance.setColorScheme('dark');
                    expect(manager.colorScheme).toBe(Adw.ColorScheme.FORCE_DARK);
                    expect(Appearance.getColorScheme()).toBe('dark');
                    // `null` hands the choice back to the desktop, which is DEFAULT and
                    // NOT one of the PREFER members: PREFER_DARK means "dark unless the
                    // desktop insists otherwise", a fourth state React Native cannot
                    // express and one that would make setColorScheme('dark') a request
                    // the desktop could refuse.
                    Appearance.setColorScheme(null);
                    expect(manager.colorScheme).toBe(Adw.ColorScheme.DEFAULT);
                } finally {
                    manager.colorScheme = original;
                }
            });

            await it('notifies a listener and lets go of it on remove', async () => {
                const manager = Adw.StyleManager.get_default();
                const original = manager.colorScheme;
                const seen: (string | null)[] = [];
                const subscription = Appearance.addChangeListener(({ colorScheme }) => seen.push(colorScheme));
                try {
                    Appearance.setColorScheme(manager.dark ? 'light' : 'dark');
                    expect(seen.length).toBe(1);
                    subscription.remove();
                    Appearance.setColorScheme(manager.dark ? 'light' : 'dark');
                    expect(seen.length).toBe(1);
                } finally {
                    manager.colorScheme = original;
                }
            });

            await it('refuses a scheme React Native does not define', async () => {
                expect(threw(() => Appearance.setColorScheme('sepia' as never)).message).toContain('null to follow');
            });
        });

        await gated('Dimensions, from the window rather than the screen', async () => {
            await it('throws by name when there is no window yet, which includes module scope', async () => {
                // THE PRECONDITION IS ASSERTED, not assumed: `get_toplevels()` is
                // process-wide, so a window another suite forgot to destroy would make
                // this vector pass or fail for a reason that has nothing to do with
                // Dimensions. Asserting it turns that into a loud failure here.
                expect(Gtk.Window.get_toplevels().get_n_items()).toBe(0);
                expect(threw(() => Dimensions.get('window')).message).toContain('there is none yet');
            });

            await it('reports the window’s own size, and its DEFAULT size before it is allocated', async () => {
                const window = new Gtk.Window({ defaultWidth: 641, defaultHeight: 481 });
                try {
                    resetWindowMetricsCache();
                    const metrics = Dimensions.get('window');
                    // The allocation is 0×0 before the window has been laid out
                    // (measured), so the default size is what is reported — the size
                    // the window is about to have, readable from construction.
                    expect(metrics.width).toBe(641);
                    expect(metrics.height).toBe(481);
                    expect(metrics.scale > 0).toBe(true);
                    expect(metrics.fontScale > 0).toBe(true);
                } finally {
                    window.destroy();
                    resetWindowMetricsCache();
                }
            });

            await it('answers get("screen") from a monitor, and only the relationship is asserted', async () => {
                const screen = Dimensions.get('screen');
                const monitor = Gdk.Display.get_default()!.get_monitors().get_item(0) as Gdk.Monitor | null;
                if (monitor === null) {
                    // A display with no monitors is a headless session, and
                    // `screenMetrics` refuses it by name — so reaching this branch means
                    // the read above should not have succeeded.
                    throw new Error('a display with no monitors answered get("screen")');
                }
                const geometry = monitor.get_geometry();
                expect(screen.width).toBe(geometry.width);
                expect(screen.height).toBe(geometry.height);
            });

            await it('refuses a dimension key and a listener event React Native does not define', async () => {
                expect(threw(() => Dimensions.get('device' as never)).message).toContain('It has two');
                expect(threw(() => Dimensions.addEventListener('resize' as never, () => {})).message).toContain(
                    'There is one: "change"',
                );
                expect(threw(() => Dimensions.set()).message).toContain('no bridge here');
            });

            await it('hands back a subscription that removes cleanly with no window', async () => {
                // With no window there is nothing to subscribe to, and the honest answer
                // is a subscription that removes without error — NOT a throw: a
                // component that mounts before the window exists is an ordinary tree,
                // and `useWindowDimensions` re-reads on its own once one appears.
                expect(Gtk.Window.get_toplevels().get_n_items()).toBe(0);
                const subscription = Dimensions.addEventListener('change', () => {});
                subscription.remove();
            });
        });

        await gated('Keyboard, which refuses its events and answers its questions', async () => {
            await it('refuses addListener rather than handing back a subscription that never fires', async () => {
                // The distinction this whole API exists to make: a `keyboardDidShow`
                // handler that silently never runs is indistinguishable from a bug in
                // the application, for ever.
                const error = threw(() => Keyboard.addListener('keyboardDidShow'));
                expect(error.message).toContain('keyboardWillShow');
                expect(error.message).toContain('never fires');
            });

            await it('answers the questions that HAVE an answer', async () => {
                expect(Keyboard.isVisible()).toBe(false);
                expect(Keyboard.metrics()).toBeUndefined();
                // Declared no-ops: nothing was shown, so nothing has to be hidden.
                Keyboard.dismiss();
                Keyboard.removeAllListeners();
            });

            await it('sends scheduleLayoutAnimation to the subsystem that owns it', async () => {
                expect(threw(() => Keyboard.scheduleLayoutAnimation()).message).toContain('LayoutAnimation');
            });
        });

        await gated('Alert, which needed no placement seam to be buildable', async () => {
            await it('presents from a plain function with NO element and no parent', async () => {
                // THE MEASUREMENT THAT SETTLES THE DIFFERENCE. `box.append(dialog)`
                // calls `g_error()` — SIGABRT, not an exception — when the box is
                // rooted in a window, and a host inserts an element by calling its
                // parent's adder. `Alert` never makes that call: it is a function,
                // `present(parent)` takes an OPTIONAL anchor, and the dialog is
                // presented AGAINST a parent rather than parented BY one. Measured on
                // libadwaita 1.9.3: `present(null)` returned with no diagnostic. The
                // gate around this describe is what asserts the "no diagnostic" half.
                // `<Modal>` reaches the same call through the host's portal placement
                // (ADR 0045), which is what made it buildable as an ELEMENT.
                //
                // THE PRECONDITION THAT MEASUREMENT WAS MISSING: presenting realises
                // a real GDK surface, which is the first thing in this suite to make
                // GSK bring up a renderer. On a Fedora 44 CI container with no
                // `/dev/dri` that emitted eight Vulkan warnings and turned this red,
                // while a desktop with a working GPU stayed silent — the gate was
                // reporting a fact about the RUNNER. It now classifies those apart
                // (`isEnvironmentDiagnostic`), so what is asserted here is what was
                // always meant: libadwaita says nothing about this dialog.
                const answers: string[] = [];
                Alert.alert('Delete this?', 'It cannot be undone.', [
                    { text: 'Cancel', style: 'cancel', onPress: () => answers.push('cancel') },
                    { text: 'Delete', style: 'destructive', onPress: () => answers.push('delete') },
                ]);
                const dialog = presentedDialog();
                expect(dialog !== null).toBe(true);
                expect(dialog!.heading).toBe('Delete this?');
                expect(dialog!.body).toBe('It cannot be undone.');
                // `cancel` becomes the CLOSE RESPONSE, which is stronger than an
                // appearance: it is what Escape and the compositor's close both produce.
                expect(dialog!.closeResponse).toBe('response-0');
                expect(dialog!.defaultResponse).toBe('response-1');
                expect(dialog!.get_response_appearance('response-1')).toBe(Adw.ResponseAppearance.DESTRUCTIVE);
                expect(dialog!.get_response_appearance('response-0')).toBe(Adw.ResponseAppearance.DEFAULT);
                dialog!.emit('response', 'response-1');
                expect(answers).toStrictEqual(['delete']);
                dialog!.force_close();
            });

            await it('defaults to one OK button, because a dialog with no way out is not shippable', async () => {
                Alert.alert('Saved');
                const dialog = presentedDialog();
                expect(dialog!.heading).toBe('Saved');
                expect(dialog!.defaultResponse).toBe('response-0');
                dialog!.force_close();
            });

            await it('refuses prompt by name, and says what to build instead', async () => {
                expect(threw(() => Alert.prompt()).message).toContain('extra-child');
            });
        });
    });
};

/**
 * The `Adw.AlertDialog` the last `Alert.alert` put on screen.
 *
 * Found through `Gtk.Window.get_toplevels()` rather than returned by `Alert.alert`,
 * because React Native's `Alert.alert` returns nothing and this layer mirrors its
 * surface — a handle invented for the tests would be a second API.
 */
function presentedDialog(): Adw.AlertDialog | null {
    const toplevels = Gtk.Window.get_toplevels();
    for (let index = toplevels.get_n_items() - 1; index >= 0; index--) {
        const window = toplevels.get_item(index) as Gtk.Window | null;
        if (window === null) continue;
        const found = findDialog(window);
        if (found !== null) return found;
    }
    return null;
}

function findDialog(widget: Gtk.Widget): Adw.AlertDialog | null {
    if (widget instanceof Adw.AlertDialog) return widget;
    for (let child = widget.get_first_child(); child !== null; child = child.get_next_sibling()) {
        const found = findDialog(child);
        if (found !== null) return found;
    }
    return null;
}

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
