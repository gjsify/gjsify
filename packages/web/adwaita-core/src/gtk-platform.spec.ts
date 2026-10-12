// The platform slice of Gtk/Gdk against a recording host: provider order, `key-pressed` return
// value, keysyms, and what the host is handed.

import { describe, expect, it } from '@gjsify/unit';

import { GTK_PLATFORM_VECTORS, driveGtkPlatformVectors, type GtkPlatformLike } from './conformance/gtk-platform.js';

import {
    CssProvider,
    GDK_KEYS,
    STYLE_PROVIDER_PRIORITY_APPLICATION,
    STYLE_PROVIDER_PRIORITY_FALLBACK,
    STYLE_PROVIDER_PRIORITY_SETTINGS,
    STYLE_PROVIDER_PRIORITY_THEME,
    STYLE_PROVIDER_PRIORITY_USER,
    createGtkPlatform,
    keyvalOfKey,
    widgetControllerMembers,
    type HostKeyEvent,
    type PlatformHost,
} from './gtk-platform.js';

function recordingHost() {
    const styles: { css: string; priority: number }[][] = [];
    const opened: string[] = [];
    const listeners = new Map<object, (event: HostKeyEvent) => boolean>();
    let detached = 0;
    const host: PlatformHost = {
        setStyles: (list) => void styles.push(list.map(({ css, priority }) => ({ css, priority }))),
        openUri: (uri) => void opened.push(uri),
        fontName: () => 'Cantarell 11',
        listenKeys: (widget, handler) => {
            listeners.set(widget, handler);
            return () => void detached++;
        },
    };
    return { host, styles, opened, listeners, detached: () => detached };
}

const press = (key: string): HostKeyEvent => ({ key, keycode: 0, state: 0, pressed: true });

export default async () => {
    await driveGtkPlatformVectors(
        {
            name: 'adwaita-core',
            isOracle: false,
            Gtk: {
                ...createGtkPlatform(recordingHost().host),
                STYLE_PROVIDER_PRIORITY_FALLBACK,
                STYLE_PROVIDER_PRIORITY_THEME,
                STYLE_PROVIDER_PRIORITY_SETTINGS,
                STYLE_PROVIDER_PRIORITY_APPLICATION,
                STYLE_PROVIDER_PRIORITY_USER,
            } as unknown as GtkPlatformLike,
        },
        { describe, it, expect },
    );
    await describe('gtk-platform: vectors', async () => {
        await it('has a vector for every row', () => {
            expect(GTK_PLATFORM_VECTORS.length > 0).toBe(true);
        });
    });
    await describe('gtk-platform', async () => {
        await it('orders providers by priority, then by the order they were added', async () => {
            const { host, styles } = recordingHost();
            const gtk = createGtkPlatform(host);
            const late = new gtk.CssProvider();
            const early = new gtk.CssProvider();
            late.load_from_string('b {}');
            early.load_from_string('a {}');
            gtk.StyleContext.add_provider_for_display(null, late, STYLE_PROVIDER_PRIORITY_APPLICATION);
            gtk.StyleContext.add_provider_for_display(null, early, STYLE_PROVIDER_PRIORITY_THEME);
            expect(JSON.stringify(styles[styles.length - 1])).toBe(
                JSON.stringify([
                    { css: 'a {}', priority: STYLE_PROVIDER_PRIORITY_THEME },
                    { css: 'b {}', priority: STYLE_PROVIDER_PRIORITY_APPLICATION },
                ]),
            );
        });

        await it('republishes on reload and drops a removed provider', async () => {
            const { host, styles } = recordingHost();
            const gtk = createGtkPlatform(host);
            const provider = new CssProvider();
            gtk.StyleContext.add_provider_for_display(null, provider, STYLE_PROVIDER_PRIORITY_APPLICATION);
            provider.load_from_string('x {}');
            expect(styles[styles.length - 1]?.[0]?.css).toBe('x {}');
            gtk.StyleContext.remove_provider_for_display(null, provider);
            expect(styles[styles.length - 1]?.length).toBe(0);
            const count = styles.length;
            provider.load_from_string('y {}');
            expect(styles.length).toBe(count);
        });

        await it('reads the font from the host until it is written', async () => {
            const gtk = createGtkPlatform(recordingHost().host);
            const settings = gtk.Settings.get_default();
            expect(settings.gtk_font_name).toBe('Cantarell 11');
            settings.gtk_font_name = 'Mono 9';
            expect(settings.gtk_font_name).toBe('Mono 9');
        });

        await it('hands show_uri to the host and remembers resource paths', async () => {
            const { host, opened } = recordingHost();
            const gtk = createGtkPlatform(host);
            gtk.show_uri(null, 'https://example.org', 0);
            expect(opened[0]).toBe('https://example.org');
            const theme = gtk.IconTheme.get_for_display(null);
            theme.add_resource_path('/a');
            theme.add_resource_path('/a');
            expect(theme.get_resource_path().length).toBe(1);
        });

        await it('translates DOM keys to keysyms', async () => {
            expect(keyvalOfKey('w')).toBe(GDK_KEYS.KEY_w);
            expect(keyvalOfKey('W')).toBe(GDK_KEYS.KEY_w);
            expect(keyvalOfKey(' ')).toBe(GDK_KEYS.KEY_space);
            expect(keyvalOfKey('Enter')).toBe(GDK_KEYS.KEY_Return);
            expect(keyvalOfKey('ArrowUp')).toBe(GDK_KEYS.KEY_Up);
            expect(keyvalOfKey('Dead')).toBe(0);
        });

        await it('reports a key as handled only when a handler returns true', async () => {
            const { host, listeners, detached } = recordingHost();
            const gtk = createGtkPlatform(host);
            const members = widgetControllerMembers(host);
            const widget = {};
            const controller = new gtk.EventControllerKey();
            const seen: number[] = [];
            controller.connect('key-pressed', (_c, keyval) => {
                seen.push(keyval);
                return keyval === GDK_KEYS.KEY_w;
            });
            members.add_controller.call(widget, controller);
            const handler = listeners.get(widget)!;
            expect(handler(press('w'))).toBe(true);
            expect(handler(press('x'))).toBe(false);
            expect(handler({ ...press('w'), pressed: false })).toBe(false);
            expect(seen.length).toBe(2);
            members.remove_controller.call(widget, controller);
            expect(detached()).toBe(1);
        });

        await it('refuses a signal the controller does not have', async () => {
            const controller = new (createGtkPlatform(recordingHost().host).EventControllerKey)();
            let thrown = false;
            try {
                controller.connect('nope', () => true);
            } catch {
                thrown = true;
            }
            expect(thrown).toBe(true);
        });
    });
};
