// `Gtk.Window`'s state members on NativeScript, against the platform double and a fake
// `WindowHost`. What it measures is the port's logic — when `notify::` fires, what a
// `close-request` return value does, what is refused. What the platform answers (a real
// `isFocused()`, a real `finish()`) is on a device and is not claimed here.

import { describe, expect, it } from '@gjsify/unit';

import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';
import { useWindowHost, type WindowHost } from './window-host.js';
import type { View } from '@nativescript/core';

import { Application } from './testing/ns-core.mjs';

interface FakeHost extends WindowHost {
    finished: number;
    focused: View | null;
    foreground: boolean;
    backListeners: Array<() => boolean>;
    /** A back press: true when a listener took it (the system's own back is cancelled). */
    pressBack(): boolean;
}

function fakeHost(canFinish: boolean): FakeHost {
    const host: FakeHost = {
        canFinish,
        finished: 0,
        focused: null,
        foreground: true,
        backListeners: [],
        pressBack: () => host.backListeners.slice().some((listener) => listener()),
        watchBack(onBack) {
            host.backListeners.push(onBack);
            return () => {
                host.backListeners = host.backListeners.filter((listener) => listener !== onBack);
            };
        },
        isForeground: () => host.foreground,
        watchForeground(onChange) {
            const resume = (): void => onChange(true);
            const suspend = (): void => onChange(false);
            Application.on('resume', resume);
            Application.on('suspend', suspend);
            return () => {
                Application.off('resume', resume);
                Application.off('suspend', suspend);
            };
        },
        finish: () => {
            host.finished++;
        },
        isFocused: (view) => view === host.focused,
        requestFocus: (view) => {
            host.focused = view;
        },
        clearFocus: () => {
            host.focused = null;
        },
    };
    return host;
}

/** A window the platform has loaded, so it is "realized". */
function loadedWindow(): Gtk.Window {
    const window = new Gtk.Window();
    Object.defineProperty(window, 'isLoaded', { value: true });
    return window;
}

/** Mark a view as loaded, as the platform does once it is on screen. */
function loaded<T extends object>(view: T): T {
    Object.defineProperty(view, 'isLoaded', { value: true });
    return view;
}

/** A window whose back handling is armed, asking `close-request` into `asked`. */
function backWindow(host: FakeHost, content: object): { window: Adw.Window; asked: () => number } {
    const window = loaded(new Adw.Window());
    window.content = content as never;
    window.onLoaded();
    let asked = 0;
    window.connect('close-request', () => {
        asked++;
        return false;
    });
    expect(host.backListeners.length).toBe(1);
    return { window, asked: () => asked };
}

const throwsWith = (run: () => void, text: string): boolean => {
    try {
        run();
    } catch (error) {
        return String(error).includes(text);
    }
    return false;
};

export const GtkWindowMembersNsTest = async () => {
    await describe('Gtk.Window state members (NativeScript)', async () => {
        await it('is-active follows resume/suspend from load to unload', () => {
            const host = fakeHost(true);
            useWindowHost(host);
            try {
                const window = new Gtk.Window();
                const seen: boolean[] = [];
                window.connect('notify::is-active', (self) => seen.push(self.isActive));
                expect(window.isActive).toBe(false);
                window.onLoaded();
                expect(window.is_active()).toBe(true);
                Application.emitLifecycle('suspend');
                Application.emitLifecycle('suspend');
                Application.emitLifecycle('resume');
                window.onUnloaded();
                Application.emitLifecycle('suspend');
                expect(JSON.stringify(seen)).toBe('[true,false,true,false]');
            } finally {
                useWindowHost(null);
            }
        });

        await it('close-request: first handler returning true stops the rest and keeps the window', () => {
            const host = fakeHost(true);
            useWindowHost(host);
            try {
                const window = loadedWindow();
                const order: string[] = [];
                window.connect('close-request', () => {
                    order.push('a');
                    return false;
                });
                window.connect('close-request', () => {
                    order.push('b');
                    return true;
                });
                window.connect('close-request', () => {
                    order.push('c');
                });
                window.close();
                expect(order.join()).toBe('a,b');
                expect(host.finished).toBe(0);
            } finally {
                useWindowHost(null);
            }
        });

        await it('close() ends the window when no handler objects, and is a no-op before load', () => {
            const host = fakeHost(true);
            useWindowHost(host);
            try {
                new Gtk.Window().close();
                expect(host.finished).toBe(0);
                const window = loadedWindow();
                window.connect('close-request', () => false);
                window.close();
                expect(host.finished).toBe(1);
            } finally {
                useWindowHost(null);
            }
        });

        await it('back on the toplevel window asks close-request; unhandled ends the window', () => {
            const host = fakeHost(true);
            useWindowHost(host);
            try {
                const window = loadedWindow();
                window.onLoaded();
                let asked = 0;
                window.connect('close-request', () => {
                    asked++;
                    return false;
                });
                expect(host.pressBack()).toBe(true);
                expect(asked).toBe(1);
                expect(host.finished).toBe(1);
            } finally {
                useWindowHost(null);
            }
        });

        await it('back with a close-request handler returning true keeps the window', () => {
            const host = fakeHost(true);
            useWindowHost(host);
            try {
                const window = loadedWindow();
                window.onLoaded();
                window.connect('close-request', () => true);
                expect(host.pressBack()).toBe(true);
                expect(host.finished).toBe(0);
            } finally {
                useWindowHost(null);
            }
        });

        await it('back closes the topmost dialog before asking close-request', () => {
            const host = fakeHost(true);
            useWindowHost(host);
            try {
                const window = new Adw.Window();
                Object.defineProperty(window, 'isLoaded', { value: true });
                window.onLoaded();
                let asked = 0;
                window.connect('close-request', () => {
                    asked++;
                    return false;
                });
                const dialog = new Adw.Dialog();
                dialog.present(window as never);
                host.pressBack();
                expect(dialog.open).toBe(false);
                expect(asked).toBe(0);
                expect(host.finished).toBe(0);
                const stuck = new Adw.Dialog({ canClose: false });
                stuck.present(window as never);
                host.pressBack();
                expect(stuck.open).toBe(true);
                expect(asked).toBe(0);
                stuck.force_close();
                host.pressBack();
                expect(asked).toBe(1);
                expect(host.finished).toBe(1);
            } finally {
                useWindowHost(null);
            }
        });

        await it('a window inside another window does not watch back', () => {
            const host = fakeHost(true);
            useWindowHost(host);
            try {
                const outer = new Adw.Window();
                const inner = new Gtk.Window();
                const box = new Gtk.Box();
                box.append(inner as never);
                outer.content = box as never;
                inner.onLoaded();
                expect(host.backListeners.length).toBe(0);
            } finally {
                useWindowHost(null);
            }
        });

        await it('unload and re-load never double-subscribe back, and unload unsubscribes', () => {
            const host = fakeHost(true);
            useWindowHost(host);
            try {
                const window = loadedWindow();
                window.onLoaded();
                window.onLoaded();
                expect(host.backListeners.length).toBe(1);
                window.onUnloaded();
                expect(host.backListeners.length).toBe(0);
                expect(host.pressBack()).toBe(false);
                expect(host.finished).toBe(0);
            } finally {
                useWindowHost(null);
            }
        });

        await it('back pops a pushed page and does not ask close-request', () => {
            const host = fakeHost(true);
            useWindowHost(host);
            try {
                const nav = loaded(new Adw.NavigationView());
                const root = new Gtk.Box();
                const detail = new Gtk.Box();
                nav.add(root as never);
                nav.push(detail as never);
                const { asked } = backWindow(host, nav);
                expect(nav.depth).toBe(2);
                expect(host.pressBack()).toBe(true);
                expect(nav.depth).toBe(1);
                expect(asked()).toBe(0);
                expect(host.finished).toBe(0);
                // (c) the root page has nothing to pop: the second back reaches close-request
                expect(host.pressBack()).toBe(true);
                expect(asked()).toBe(1);
                expect(host.finished).toBe(1);
            } finally {
                useWindowHost(null);
            }
        });

        await it('back on a page with can-pop false is consumed: no pop, no close-request', () => {
            const host = fakeHost(true);
            useWindowHost(host);
            try {
                const nav = loaded(new Adw.NavigationView());
                const root = new Gtk.Box();
                const detail = new Gtk.Box();
                nav.add(root as never);
                nav.push(detail as never);
                nav.setPageCanPop(detail as never, false);
                const { asked } = backWindow(host, nav);
                host.pressBack();
                expect(nav.depth).toBe(2);
                expect(asked()).toBe(0);
                expect(host.finished).toBe(0);
            } finally {
                useWindowHost(null);
            }
        });

        await it('back pops the innermost of nested navigation views first', () => {
            const host = fakeHost(true);
            useWindowHost(host);
            try {
                const outer = loaded(new Adw.NavigationView());
                const inner = loaded(new Adw.NavigationView());
                const outerRoot = new Gtk.Box();
                const holder = new Gtk.Box();
                holder.append(inner as never);
                inner.add(new Gtk.Box() as never);
                inner.push(new Gtk.Box() as never);
                outer.add(outerRoot as never);
                outer.push(holder as never);
                const { asked } = backWindow(host, outer);
                host.pressBack();
                expect(inner.depth).toBe(1);
                expect(outer.depth).toBe(2);
                host.pressBack();
                expect(outer.depth).toBe(1);
                expect(asked()).toBe(0);
                host.pressBack();
                expect(asked()).toBe(1);
            } finally {
                useWindowHost(null);
            }
        });

        await it('back ignores a navigation view inside a page that is not visible', () => {
            const host = fakeHost(true);
            useWindowHost(host);
            try {
                const outer = loaded(new Adw.NavigationView());
                const hiddenInner = loaded(new Adw.NavigationView());
                const first = new Gtk.Box();
                first.append(hiddenInner as never);
                hiddenInner.add(new Gtk.Box() as never);
                hiddenInner.push(new Gtk.Box() as never);
                outer.add(first as never);
                outer.push(new Gtk.Box() as never);
                const { asked } = backWindow(host, outer);
                host.pressBack();
                expect(hiddenInner.depth).toBe(2);
                expect(outer.depth).toBe(1);
                expect(asked()).toBe(0);
            } finally {
                useWindowHost(null);
            }
        });

        await it('close() is refused before close-request where the platform cannot end the window', () => {
            const host = fakeHost(false);
            useWindowHost(host);
            try {
                const window = loadedWindow();
                let emitted = 0;
                window.connect('close-request', () => {
                    emitted++;
                    return true;
                });
                expect(throwsWith(() => window.close(), 'close')).toBe(true);
                expect(emitted).toBe(0);
            } finally {
                useWindowHost(null);
            }
        });

        await it('a re-entrant close() from a handler is ignored', () => {
            const host = fakeHost(true);
            useWindowHost(host);
            try {
                const window = loadedWindow();
                let calls = 0;
                window.connect('close-request', () => {
                    calls++;
                    window.close();
                    return true;
                });
                window.close();
                expect(calls).toBe(1);
            } finally {
                useWindowHost(null);
            }
        });

        await it('maximized is constant true; only un-maximizing is refused', () => {
            const window = new Gtk.Window();
            let notified = 0;
            window.connect('notify::maximized', () => {
                notified++;
            });
            expect(window.maximized).toBe(true);
            expect(window.is_maximized()).toBe(true);
            window.maximize();
            window.maximized = true;
            expect(notified).toBe(0);
            expect(throwsWith(() => window.unmaximize(), 'unmaximize')).toBe(true);
            expect(throwsWith(() => (window.maximized = false), 'unmaximize')).toBe(true);
            expect(window.maximized).toBe(true);
        });

        await it('get_focus/set_focus walk the tree and take descendants only', () => {
            const host = fakeHost(true);
            useWindowHost(host);
            try {
                const window = new Adw.Window();
                const button = new Gtk.Button();
                const other = new Gtk.Button();
                const box = new Gtk.Box();
                box.append(button as never);
                window.content = box as never;
                expect(window.get_focus()).toBe(null);
                window.set_focus(button as never);
                expect(window.get_focus() === (button as unknown)).toBe(true);
                expect(window.focusWidget === (button as unknown)).toBe(true);
                expect(throwsWith(() => window.set_focus(other as never), 'descendant')).toBe(true);
                window.set_focus(null);
                expect(window.get_focus()).toBe(null);
            } finally {
                useWindowHost(null);
            }
        });

        await it('notify::focus-widget is refused rather than silently never firing', () => {
            const window = new Gtk.Window();
            expect(throwsWith(() => window.connect('notify::focus-widget', () => {}), 'focus-widget')).toBe(true);
        });

        await it('present() is a no-op', () => {
            const window = new Gtk.Window();
            window.present();
            expect(window.isActive).toBe(false);
        });
    });
};
