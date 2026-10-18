// `Gio.AppInfo.launch_default_for_uri` and `Gdk.Display.get_app_launch_context` as observable
// behaviour. The SAME vectors run on real `gi://Gio` (the ORACLE), on the core and on each port's
// doors. No vector launches anything: what a vector may observe is what GLib answers before it asks a
// handler, so a URI that would open something is the host's and held by `gio-app-info.spec.ts`.

import type { ConstructHarness } from './constructs.js';

interface GLibErrorLike {
    matches(domain: unknown, code: number): boolean;
}

/** The parts of `Gio`, `GLib` and `Gdk` the vectors read. */
export interface GioAppInfoNamespaces {
    readonly Gio: {
        readonly AppInfo: { launch_default_for_uri(uri: string, context: object | null): boolean };
        readonly IOErrorEnum: { readonly NOT_SUPPORTED: number };
    };
    readonly GLib: { readonly Error: abstract new (...args: never[]) => GLibErrorLike };
    readonly Gdk: {
        readonly Display: { get_default(): { get_app_launch_context(): object } | null };
        readonly AppLaunchContext: abstract new (...args: never[]) => object;
    };
}

export interface GioAppInfoSubject extends GioAppInfoNamespaces {
    readonly name: string;
    readonly isOracle: boolean;
    /** Whether `Gdk.Display.get_default()` is a display; false skips the vectors that need one. */
    readonly display: boolean;
}

export const GIO_APP_INFO_ROWS = ['members', 'no-scheme', 'context'] as const;

export type GioAppInfoRow = (typeof GIO_APP_INFO_ROWS)[number];

export interface GioAppInfoVector {
    readonly row: GioAppInfoRow;
    readonly rule: string;
    readonly needsDisplay?: boolean;
    readonly observe: (subject: GioAppInfoSubject) => unknown;
    readonly shows: unknown;
}

function notSupported(subject: GioAppInfoSubject, uri: string, context: object | null): boolean | string {
    try {
        subject.Gio.AppInfo.launch_default_for_uri(uri, context);
        return 'launched';
    } catch (error) {
        return (
            error instanceof subject.GLib.Error &&
            error.matches(subject.Gio.IOErrorEnum, subject.Gio.IOErrorEnum.NOT_SUPPORTED)
        );
    }
}

export const GIO_APP_INFO_VECTORS: readonly GioAppInfoVector[] = [
    {
        row: 'members',
        rule: 'launch_default_for_uri is a static function of Gio.AppInfo',
        observe: ({ Gio }) => typeof Gio.AppInfo.launch_default_for_uri,
        shows: 'function',
    },
    {
        row: 'no-scheme',
        rule: 'a string with no URI scheme throws a GLib.Error matching IOErrorEnum.NOT_SUPPORTED',
        observe: (subject) => [notSupported(subject, 'not a uri', null), notSupported(subject, '', null)],
        shows: [true, true],
    },
    {
        row: 'context',
        rule: 'the display hands out a Gdk.AppLaunchContext, a new one per call, that launch accepts',
        needsDisplay: true,
        observe(subject) {
            const display = subject.Gdk.Display.get_default()!;
            const context = display.get_app_launch_context();
            return [
                context instanceof subject.Gdk.AppLaunchContext,
                context === display.get_app_launch_context(),
                notSupported(subject, 'not a uri', context),
            ];
        },
        shows: [true, false, true],
    },
];

export async function driveGioAppInfoVectors(
    subject: GioAppInfoSubject,
    harness: ConstructHarness,
    vectors: readonly GioAppInfoVector[] = GIO_APP_INFO_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: Gio.AppInfo`, async () => {
        for (const vector of vectors) {
            if (vector.needsDisplay && !subject.display) continue;
            await it(`${vector.row}: ${vector.rule}`, async () => {
                const observed = await vector.observe(subject);
                expect(JSON.stringify(observed)).toBe(JSON.stringify(vector.shows));
            });
        }
    });
}
