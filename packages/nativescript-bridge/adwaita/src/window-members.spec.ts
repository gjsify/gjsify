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
}

function fakeHost(canFinish: boolean): FakeHost {
    const host: FakeHost = {
        canFinish,
        finished: 0,
        focused: null,
        foreground: true,
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

        await it('Adw.Window and Adw.ApplicationWindow are Gtk.Windows with the same members', () => {
            for (const window of [new Adw.Window(), new Adw.ApplicationWindow()]) {
                expect(window instanceof Gtk.Window).toBe(true);
                expect(window.maximized).toBe(true);
                expect(window.isActive).toBe(false);
                expect(window.get_focus()).toBe(null);
                expect(throwsWith(() => window.connect('notify::focus-widget', () => {}), 'focus-widget')).toBe(true);
            }
        });

        await it('present() is a no-op', () => {
            const window = new Gtk.Window();
            window.present();
            expect(window.isActive).toBe(false);
        });
    });
};
