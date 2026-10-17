// Which file of a `Gtk.IconTheme` resource path answers an icon name — ADR 0116 § 4 as observable
// behaviour, over `fixtures/gio-resource/icons.gresource`. The SAME vectors run on real GTK (the
// ORACLE: `gtk_icon_theme_lookup_by_gicon` with a `GThemedIcon`, as `GtkImage` asks) and on each
// port's lookup. The fixture's icons sit at `/org/gjsify/icons/icons/`: the path `GtkApplication`
// adds for the application id `org.gjsify.icons`, laid out as hicolor subdirectories WITHOUT a
// `hicolor/` component, which is how `theme_subdir_load` joins a resource path and a subdir.
//
// `go-next-symbolic` is a glyph of the current theme (Adwaita on GTK, the compiled subset on a
// port): the theme answers it before the resource that holds the same name, and answers `go-next`
// before the resource's colour `16x16/actions/go-next.png`.

import type { ConstructHarness } from './constructs.js';
import { gioResourceFixtures } from './gio-resource.js';

/** The fixture's icon path: `GtkApplication`'s `<resource-base-path>/icons/` for `org.gjsify.icons`. */
export const ICON_FIXTURE_PATH = '/org/gjsify/icons/icons/';

export type IconLookupDirection = 'ltr' | 'rtl' | null;

/** What answered: a resource file (`resource:///…`), the current theme, or nothing. */
export type IconThemeResourceAnswer = { readonly uri: string; readonly symbolic: boolean } | 'theme' | null;

export interface IconThemeLike {
    add_resource_path(path: string): void;
    set_resource_path(path: string[] | null): void;
}

/** What a driver hands the vectors. */
export interface IconThemeResourceSubject {
    readonly name: string;
    readonly isOracle: boolean;
    /** Registers the bytes as a `Gio.Resource`; the returned function unregisters it. */
    register(data: Uint8Array): () => void;
    /** A theme whose resource path is `[]`. */
    theme(): IconThemeLike;
    lookup(
        theme: IconThemeLike,
        name: string,
        size: number,
        scale: number,
        direction: IconLookupDirection,
    ): IconThemeResourceAnswer;
}

export const ICON_THEME_RESOURCE_ROWS = ['size', 'names', 'symbolic', 'suffix', 'unthemed', 'scan'] as const;

export type IconThemeResourceRow = (typeof ICON_THEME_RESOURCE_ROWS)[number];

export interface IconThemeResourceVector {
    readonly row: IconThemeResourceRow;
    readonly rule: string;
    readonly observe: (subject: IconThemeResourceSubject) => unknown;
    readonly shows: unknown;
}

type Query = readonly [name: string, size: number, scale: number, direction: IconLookupDirection];

function withFixture<T>(subject: IconThemeResourceSubject, run: (theme: IconThemeLike) => T): T {
    const unregister = subject.register(gioResourceFixtures().icons);
    try {
        const theme = subject.theme();
        theme.add_resource_path(ICON_FIXTURE_PATH);
        return run(theme);
    } finally {
        unregister();
    }
}

const lookups = (queries: readonly Query[]) => (subject: IconThemeResourceSubject) =>
    withFixture(subject, (theme) => queries.map((query) => subject.lookup(theme, ...query)));

const file = (subpath: string, symbolic = false) => ({ uri: `resource://${ICON_FIXTURE_PATH}${subpath}`, symbolic });

export const ICON_THEME_RESOURCE_VECTORS: readonly IconThemeResourceVector[] = [
    {
        row: 'size',
        rule: 'an exact Threshold directory wins; between them the Scalable directory (difference 0) wins',
        observe: lookups([
            ['size', 16, 1, null],
            ['size', 48, 1, null],
            ['size', 24, 1, null],
            ['size', 32, 1, null],
            ['size', 100, 1, null],
        ]),
        shows: [
            file('16x16/apps/size.png'),
            file('48x48/apps/size.png'),
            file('scalable/apps/size.svg'),
            file('scalable/apps/size.svg'),
            file('scalable/apps/size.svg'),
        ],
    },
    {
        row: 'size',
        rule: 'scale 2 prefers the @2 directory over the Scalable one of scale 1',
        observe: lookups([['size', 16, 2, null]]),
        shows: [file('16x16@2/apps/size.png')],
    },
    {
        row: 'names',
        rule: 'X asks for X before X-symbolic; X-symbolic for X-symbolic before X',
        observe: lookups([
            ['sym', 16, 1, null],
            ['sym-symbolic', 16, 1, null],
            ['only', 16, 1, null],
        ]),
        shows: [
            file('16x16/apps/sym.png'),
            file('scalable/apps/sym-symbolic.svg', true),
            file('symbolic/apps/only-symbolic.svg', true),
        ],
    },
    {
        row: 'names',
        rule: 'the direction variant is tried before the plain name',
        observe: lookups([
            ['arrow', 16, 1, 'rtl'],
            ['arrow', 16, 1, 'ltr'],
            ['arrow', 16, 1, null],
        ]),
        shows: [file('16x16/apps/arrow-rtl.png'), file('16x16/apps/arrow.png'), file('16x16/apps/arrow.png')],
    },
    {
        row: 'symbolic',
        rule: "a symbolic glyph of the current theme answers before the resource's file of the same name",
        observe: lookups([['go-next-symbolic', 16, 1, null]]),
        shows: ['theme'],
    },
    {
        row: 'symbolic',
        rule: "X takes the current theme's X-symbolic before hicolor's colour X (theme outer, name inner)",
        observe: lookups([
            ['go-next', 16, 1, null],
            ['go-next', 16, 1, 'ltr'],
        ]),
        shows: ['theme', 'theme'],
    },
    {
        row: 'symbolic',
        rule: 'a .symbolic.png answers X and X-symbolic, and is recoloured',
        observe: lookups([
            ['tint', 16, 1, null],
            ['tint-symbolic', 16, 1, null],
        ]),
        shows: [file('16x16/apps/tint.symbolic.png', true), file('16x16/apps/tint.symbolic.png', true)],
    },
    {
        row: 'suffix',
        rule: 'in one directory a .png beats a .svg; a compressed entry is still found',
        observe: lookups([
            ['suffix', 24, 1, null],
            ['packed', 22, 1, null],
        ]),
        shows: [file('24x24/apps/suffix.png'), file('22x22/apps/packed.png')],
    },
    {
        row: 'unthemed',
        rule: 'a file directly under the path answers; an SVG beats an XPM but not a PNG',
        observe: lookups([
            ['loose', 16, 1, null],
            ['flat', 16, 1, null],
            ['old', 16, 1, null],
            ['nothing-here', 16, 1, null],
        ]),
        shows: [file('loose.svg'), file('flat.png'), file('old.xpm'), null],
    },
    {
        row: 'scan',
        rule: 'a resource registered after the first lookup is seen only once the resource path changes',
        observe(subject) {
            const theme = subject.theme();
            theme.set_resource_path([ICON_FIXTURE_PATH]);
            const before = subject.lookup(theme, 'size', 16, 1, null);
            const unregister = subject.register(gioResourceFixtures().icons);
            try {
                const registered = subject.lookup(theme, 'size', 16, 1, null);
                theme.add_resource_path('/org/gjsify/icons/none/');
                return [before, registered, subject.lookup(theme, 'size', 16, 1, null)];
            } finally {
                unregister();
            }
        },
        shows: [null, null, file('16x16/apps/size.png')],
    },
];

/** Holds a subject to the vectors. */
export async function driveIconThemeResourceVectors(
    subject: IconThemeResourceSubject,
    harness: ConstructHarness,
    vectors: readonly IconThemeResourceVector[] = ICON_THEME_RESOURCE_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: Gtk.IconTheme resource paths (ADR 0116 § 4)`, async () => {
        for (const vector of vectors) {
            await it(`${vector.row}: ${vector.rule}`, () => {
                expect(JSON.stringify(vector.observe(subject))).toBe(JSON.stringify(vector.shows));
            });
        }
    });
}
