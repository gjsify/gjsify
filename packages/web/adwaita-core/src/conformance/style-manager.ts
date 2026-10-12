// `Adw.StyleManager` as observable behaviour: the default instance, the read-only `dark`, and
// `notify::dark`. The SAME vectors run on real `gi://Adw` (the ORACLE: a vector that fails there is
// wrong, never a port bug), on the core with a fake source, and on each port's `Adw` door.
//
// What flips `dark` is the subject's: GJS forces a scheme with `color_scheme`, a port changes its own
// source. `settle` lets a source that reports asynchronously (a DOM observer) be heard.

import type { ConstructHarness } from './constructs.js';

export interface StyleManagerLike {
    readonly dark: boolean;
    get_dark(): boolean;
    connect(signal: string, handler: (manager: StyleManagerLike, pspec: { name: string }) => void): number;
    disconnect(id: number): void;
    color_scheme: number;
    get_color_scheme(): number;
    set_color_scheme(scheme: number): void;
}

/** The part of `Adw` the vectors read. */
export interface AdwStyleLike {
    StyleManager: { get_default(): StyleManagerLike };
    ColorScheme: {
        DEFAULT: number;
        FORCE_LIGHT: number;
        PREFER_LIGHT: number;
        PREFER_DARK: number;
        FORCE_DARK: number;
    };
}

export interface StyleManagerSubject {
    readonly name: string;
    readonly isOracle: boolean;
    readonly Adw: AdwStyleLike;
    /** Makes the interface dark or light the way the subject's platform does. */
    setDark(dark: boolean): void;
    settle(): Promise<void>;
}

export const STYLE_MANAGER_ROWS = [
    'default',
    'dark',
    'notify',
    'unchanged',
    'disconnect',
    'readonly',
    'scheme-values',
    'scheme-force',
    'scheme-notify',
    'scheme-default',
] as const;

export type StyleManagerRow = (typeof STYLE_MANAGER_ROWS)[number];

export interface StyleManagerVector {
    readonly row: StyleManagerRow;
    readonly rule: string;
    readonly observe: (subject: StyleManagerSubject) => unknown;
    readonly shows: unknown;
}

export const STYLE_MANAGER_VECTORS: readonly StyleManagerVector[] = [
    {
        row: 'default',
        rule: 'get_default() is one instance',
        observe: ({ Adw }) => Adw.StyleManager.get_default() === Adw.StyleManager.get_default(),
        shows: true,
    },
    {
        row: 'dark',
        rule: '`dark` and get_dark() follow the interface, both ways',
        async observe({ Adw, setDark, settle }) {
            const manager = Adw.StyleManager.get_default();
            const seen: boolean[] = [];
            for (const dark of [true, false]) {
                setDark(dark);
                await settle();
                seen.push(manager.dark, manager.get_dark());
            }
            return seen;
        },
        shows: [true, true, false, false],
    },
    {
        row: 'notify',
        rule: 'notify::dark fires with (manager, pspec "dark") once the value changed, and `dark` is already new',
        async observe({ Adw, setDark, settle }) {
            const manager = Adw.StyleManager.get_default();
            setDark(false);
            await settle();
            const calls: unknown[] = [];
            const id = manager.connect('notify::dark', (self, pspec) =>
                calls.push([self === manager, pspec.name, self.dark]),
            );
            setDark(true);
            await settle();
            manager.disconnect(id);
            return calls;
        },
        shows: [[true, 'dark', true]],
    },
    {
        row: 'unchanged',
        rule: 'setting the value it already has notifies nothing',
        async observe({ Adw, setDark, settle }) {
            const manager = Adw.StyleManager.get_default();
            setDark(true);
            await settle();
            let calls = 0;
            const id = manager.connect('notify::dark', () => void (calls += 1));
            setDark(true);
            await settle();
            manager.disconnect(id);
            return calls;
        },
        shows: 0,
    },
    {
        row: 'disconnect',
        rule: 'a disconnected handler is not called again',
        async observe({ Adw, setDark, settle }) {
            const manager = Adw.StyleManager.get_default();
            setDark(false);
            await settle();
            let calls = 0;
            const id = manager.connect('notify::dark', () => void (calls += 1));
            manager.disconnect(id);
            setDark(true);
            await settle();
            return calls;
        },
        shows: 0,
    },
    {
        row: 'readonly',
        rule: '`dark` cannot be assigned',
        observe({ Adw }) {
            try {
                (Adw.StyleManager.get_default() as { dark: boolean }).dark = true;
                return false;
            } catch {
                return true;
            }
        },
        shows: true,
    },
    {
        row: 'scheme-values',
        rule: 'Adw.ColorScheme carries the libadwaita values',
        observe: ({ Adw }) => Object.values(Adw.ColorScheme).sort(),
        shows: [0, 1, 2, 3, 4],
    },
    {
        row: 'scheme-force',
        rule: 'FORCE_DARK / FORCE_LIGHT pin `dark`, and color_scheme reads back through all three spellings',
        async observe({ Adw, settle }) {
            const manager = Adw.StyleManager.get_default();
            const seen: unknown[] = [];
            for (const scheme of [Adw.ColorScheme.FORCE_DARK, Adw.ColorScheme.FORCE_LIGHT]) {
                manager.set_color_scheme(scheme);
                await settle();
                seen.push(manager.dark, manager.color_scheme === scheme, manager.get_color_scheme() === scheme);
            }
            return seen;
        },
        shows: [true, true, true, false, true, true],
    },
    {
        row: 'scheme-notify',
        rule: 'notify::color-scheme fires once per change and not for the value it already has',
        async observe({ Adw, settle }) {
            const manager = Adw.StyleManager.get_default();
            manager.set_color_scheme(Adw.ColorScheme.FORCE_LIGHT);
            await settle();
            let calls = 0;
            const id = manager.connect('notify::color-scheme', () => void (calls += 1));
            manager.set_color_scheme(Adw.ColorScheme.FORCE_DARK);
            manager.set_color_scheme(Adw.ColorScheme.FORCE_DARK);
            await settle();
            manager.disconnect(id);
            return calls;
        },
        shows: 1,
    },
    {
        row: 'scheme-default',
        rule: 'DEFAULT hands the interface back and reads back as DEFAULT',
        async observe({ Adw, settle }) {
            const manager = Adw.StyleManager.get_default();
            manager.set_color_scheme(Adw.ColorScheme.FORCE_DARK);
            manager.set_color_scheme(Adw.ColorScheme.DEFAULT);
            await settle();
            return manager.color_scheme;
        },
        shows: 0,
    },
];

export async function driveStyleManagerVectors(
    subject: StyleManagerSubject,
    harness: ConstructHarness,
    vectors: readonly StyleManagerVector[] = STYLE_MANAGER_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: Adw.StyleManager`, async () => {
        for (const vector of vectors) {
            await it(`${vector.row}: ${vector.rule}`, async () => {
                const observed = await vector.observe(subject);
                expect(JSON.stringify(observed)).toBe(JSON.stringify(vector.shows));
            });
        }
    });
}
