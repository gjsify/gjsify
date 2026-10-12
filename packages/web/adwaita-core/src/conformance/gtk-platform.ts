// The platform slice of `Gtk` as observable behaviour: `Gtk.CssProvider`, `Gtk.Settings`,
// `Gtk.IconTheme`, `Gtk.EventControllerKey`, `Gtk.StyleContext` and `Gtk.show_uri`.
//
// A vector is a program written against the `Gtk` namespace and the data it must leave behind. What a
// vector reads is what GTK itself answers without a display server round trip, so the SAME vectors
// run on the core (against a recording host) and on each port's `Gtk` door (against its real host).
// Effects on the host (the `<style>` element, `window.open`) are the host's own and are held by
// `gtk-platform.spec.ts`.

import type { ConstructHarness } from './constructs.js';

/** The part of `Gtk` the vectors read. */
export interface GtkPlatformLike {
    readonly CssProvider: new () => { load_from_string(css: string): void; to_string(): string };
    readonly Settings: { get_default(): { gtk_font_name: string | null } };
    readonly IconTheme: {
        get_for_display(display: unknown): { add_resource_path(path: string): void; get_resource_path(): string[] };
    };
    readonly EventControllerKey: new () => {
        connect(signal: string, handler: (...args: unknown[]) => boolean | void): number;
        disconnect(id: number): void;
    };
    readonly StyleContext: {
        add_provider_for_display(display: unknown, provider: object, priority: number): void;
        remove_provider_for_display(display: unknown, provider: object): void;
    };
    readonly STYLE_PROVIDER_PRIORITY_FALLBACK: number;
    readonly STYLE_PROVIDER_PRIORITY_THEME: number;
    readonly STYLE_PROVIDER_PRIORITY_SETTINGS: number;
    readonly STYLE_PROVIDER_PRIORITY_APPLICATION: number;
    readonly STYLE_PROVIDER_PRIORITY_USER: number;
    show_uri: unknown;
}

/** What a driver hands the vectors. */
export interface GtkPlatformSubject {
    readonly name: string;
    readonly isOracle: boolean;
    readonly Gtk: GtkPlatformLike;
}

export const GTK_PLATFORM_ROWS = ['priorities', 'provider', 'settings', 'icon-theme', 'controller', 'members'] as const;

export type GtkPlatformRow = (typeof GTK_PLATFORM_ROWS)[number];

export interface GtkPlatformVector {
    readonly row: GtkPlatformRow;
    readonly rule: string;
    readonly observe: (subject: GtkPlatformSubject) => unknown;
    readonly shows: unknown;
}

function thrown(fn: () => void): boolean {
    try {
        fn();
        return false;
    } catch {
        return true;
    }
}

export const GTK_PLATFORM_VECTORS: readonly GtkPlatformVector[] = [
    {
        row: 'priorities',
        rule: 'the style provider priorities are GTK values (gtk/gtkstyleprovider.h)',
        observe: ({ Gtk }) => [
            Gtk.STYLE_PROVIDER_PRIORITY_FALLBACK,
            Gtk.STYLE_PROVIDER_PRIORITY_THEME,
            Gtk.STYLE_PROVIDER_PRIORITY_SETTINGS,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
            Gtk.STYLE_PROVIDER_PRIORITY_USER,
        ],
        shows: [1, 200, 400, 600, 800],
    },
    {
        row: 'provider',
        rule: 'a provider answers the CSS it was loaded with, and an empty one answers an empty string',
        observe({ Gtk }) {
            const provider = new Gtk.CssProvider();
            const empty = provider.to_string();
            provider.load_from_string('label { color: red; }');
            return [empty, provider.to_string()];
        },
        shows: ['', 'label { color: red; }'],
    },
    {
        row: 'provider',
        rule: 'a provider can be added and removed again, and removing one never added is not an error',
        observe({ Gtk }) {
            const provider = new Gtk.CssProvider();
            provider.load_from_string('a {}');
            const failed = [
                thrown(() =>
                    Gtk.StyleContext.add_provider_for_display(null, provider, Gtk.STYLE_PROVIDER_PRIORITY_USER),
                ),
                thrown(() => Gtk.StyleContext.remove_provider_for_display(null, provider)),
                thrown(() => Gtk.StyleContext.remove_provider_for_display(null, provider)),
            ];
            return failed;
        },
        shows: [false, false, false],
    },
    {
        row: 'settings',
        rule: 'Settings.get_default is one object, and gtk-font-name answers what was written to it',
        observe({ Gtk }) {
            const settings = Gtk.Settings.get_default();
            const same = settings === Gtk.Settings.get_default();
            settings.gtk_font_name = 'Mono 9';
            return [same, settings.gtk_font_name];
        },
        shows: [true, 'Mono 9'],
    },
    {
        row: 'icon-theme',
        rule: 'an icon theme keeps each resource path once, in the order they were added',
        observe({ Gtk }) {
            const theme = Gtk.IconTheme.get_for_display(null);
            const before = theme.get_resource_path().length;
            theme.add_resource_path('/vector/a');
            theme.add_resource_path('/vector/b');
            theme.add_resource_path('/vector/a');
            return theme.get_resource_path().slice(before);
        },
        shows: ['/vector/a', '/vector/b'],
    },
    {
        row: 'controller',
        rule: 'a key controller connects key-pressed and key-released, and refuses any other signal',
        observe({ Gtk }) {
            const controller = new Gtk.EventControllerKey();
            const pressed = controller.connect('key-pressed', () => true);
            const released = controller.connect('key-released', () => {});
            return [
                pressed > 0,
                released > 0,
                pressed !== released,
                thrown(() => controller.connect('nope', () => true)),
            ];
        },
        shows: [true, true, true, true],
    },
    {
        row: 'controller',
        rule: 'disconnect removes a handler once, and an id that is not connected is an error',
        observe({ Gtk }) {
            const controller = new Gtk.EventControllerKey();
            const id = controller.connect('key-pressed', () => true);
            return [thrown(() => controller.disconnect(id)), thrown(() => controller.disconnect(id))];
        },
        shows: [false, true],
    },
    {
        row: 'members',
        rule: 'show_uri is a function',
        observe: ({ Gtk }) => typeof Gtk.show_uri,
        shows: 'function',
    },
];

export async function driveGtkPlatformVectors(
    subject: GtkPlatformSubject,
    harness: ConstructHarness,
    vectors: readonly GtkPlatformVector[] = GTK_PLATFORM_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: Gtk platform`, async () => {
        for (const vector of vectors) {
            await it(`${vector.row}: ${vector.rule}`, async () => {
                const observed = await vector.observe(subject);
                expect(JSON.stringify(observed)).toBe(JSON.stringify(vector.shows));
            });
        }
    });
}
