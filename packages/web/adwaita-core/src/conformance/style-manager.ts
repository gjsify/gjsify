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
}

/** The part of `Adw` the vectors read. */
export interface AdwStyleLike {
    StyleManager: { get_default(): StyleManagerLike };
}

export interface StyleManagerSubject {
    readonly name: string;
    readonly isOracle: boolean;
    readonly Adw: AdwStyleLike;
    /** Makes the interface dark or light the way the subject's platform does. */
    setDark(dark: boolean): void;
    settle(): Promise<void>;
}

export const STYLE_MANAGER_ROWS = ['default', 'dark', 'notify', 'unchanged', 'disconnect', 'readonly'] as const;

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
