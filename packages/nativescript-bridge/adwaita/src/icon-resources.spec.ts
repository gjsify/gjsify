// What a resource icon draws as on this port (ADR 0116 § 4): `resolveIconDrawing` over a
// `Gtk.IconTheme` with the fixture's icons on its resource path. Which FILE answers is the shared
// vectors' business (`gio-resource.spec.ts` in the trees suite); this spec holds what the port
// makes of the file it gets, and the grid fit a symbolic file goes through first.
import { ICON_FIXTURE_PATH, gioResourceFixtures } from '@gjsify/adwaita-core/conformance';
import {
    GioResource,
    createGtkPlatform,
    resources_lookup_data,
    resources_register,
    resources_unregister,
    type IconTheme,
    type PlatformHost,
} from '@gjsify/adwaita-core';
import { describe, expect, it } from '@gjsify/unit';

import { fitIconToGrid } from './widgets/icon-path.js';
import { ICON_FALLBACK_NAME, onIconThemeChanged, resolveIconDrawing, resolveIconSource } from './widgets/icon-theme.js';

const host: PlatformHost = {
    setStyles: () => {},
    openUri: () => {},
    fontName: () => 'Cantarell 11',
    listenKeys: () => () => {},
};

const MISSING = { kind: 'svg', svg: resolveIconSource(ICON_FALLBACK_NAME) };

/** A fresh theme with the fixture's icons on its resource path, and `console.warn` recorded. */
async function withIcons(run: (theme: IconTheme, warned: unknown[][]) => Promise<void> | void) {
    const resource = GioResource.new_from_data(gioResourceFixtures().icons);
    resources_register(resource);
    const theme = createGtkPlatform(host).IconTheme.get_for_display(null);
    theme.add_resource_path(ICON_FIXTURE_PATH);
    const warn = console.warn;
    const warned: unknown[][] = [];
    console.warn = (...args: unknown[]) => void warned.push(args);
    try {
        await run(theme, warned);
    } finally {
        console.warn = warn;
        resources_unregister(resource);
    }
}

const base64 = (data: Uint8Array) => btoa(String.fromCharCode(...data));
const file = (subpath: string) => resources_lookup_data(`${ICON_FIXTURE_PATH}${subpath}`, 0).get_data();

export default async () => {
    await describe('resolveIconDrawing (resource icons, ADR 0116 § 4)', async () => {
        await it('draws a PNG as its bytes in base64, untinted', async () => {
            await withIcons((theme) => {
                expect(resolveIconDrawing(theme, 'flat', { size: 16 })).toStrictEqual({
                    kind: 'png',
                    base64: base64(file('flat.png')),
                    symbolic: false,
                });
            });
        });

        await it('marks a .symbolic.png for tinting', async () => {
            await withIcons((theme) => {
                expect(resolveIconDrawing(theme, 'tint', { size: 16 })).toStrictEqual({
                    kind: 'png',
                    base64: base64(file('16x16/apps/tint.symbolic.png')),
                    symbolic: true,
                });
            });
        });

        await it('picks the @2 file at scale 2', async () => {
            await withIcons((theme) => {
                expect(resolveIconDrawing(theme, 'size', { size: 16, scale: 2 })).toStrictEqual({
                    kind: 'png',
                    base64: base64(file('16x16@2/apps/size.png')),
                    symbolic: false,
                });
            });
        });

        await it('draws a symbolic SVG file through the rasteriser, fitted to the grid', async () => {
            await withIcons((theme) => {
                const svg = new TextDecoder().decode(file('scalable/apps/sym-symbolic.svg'));
                expect(resolveIconDrawing(theme, 'sym-symbolic', { size: 16 })).toStrictEqual({
                    kind: 'svg',
                    svg: fitIconToGrid(svg),
                });
            });
        });

        await it("draws the current theme's glyph when the theme answers first", async () => {
            await withIcons((theme) => {
                const glyph = { kind: 'svg', svg: resolveIconSource('go-next-symbolic') };
                expect(resolveIconDrawing(theme, 'go-next-symbolic', { size: 16 })).toStrictEqual(glyph);
                expect(resolveIconDrawing(theme, 'go-next', { size: 16 })).toStrictEqual(glyph);
            });
        });

        await it('falls back to resolveIconSource when no resource holds the name', async () => {
            await withIcons((theme) => {
                expect(resolveIconDrawing(theme, 'list-add', { size: 16 })).toStrictEqual({
                    kind: 'svg',
                    svg: resolveIconSource('list-add'),
                });
                expect(resolveIconDrawing(theme, 'nothing-here', { size: 16 })).toStrictEqual(MISSING);
            });
        });

        await it('passes SVG source through and leaves an empty value empty', async () => {
            await withIcons((theme) => {
                const svg = '<svg viewBox="0 0 16 16"></svg>';
                expect(resolveIconDrawing(theme, svg, { size: 16 })).toStrictEqual({ kind: 'svg', svg });
                expect(resolveIconDrawing(theme, '', { size: 16 })).toBe(null);
                expect(resolveIconDrawing(theme, null, { size: 16 })).toBe(null);
            });
        });

        for (const [name, size, why] of [
            ['loose', 16, 'a colour SVG (NativeScript decodes no SVG)'],
            ['old', 16, 'an XPM'],
            ['packed', 22, 'a compressed entry'],
        ] as const) {
            await it(`draws image-missing with a warning for ${why}`, async () => {
                await withIcons((theme, warned) => {
                    expect(resolveIconDrawing(theme, name, { size })).toStrictEqual(MISSING);
                    expect(warned.length).toBe(1);
                    // Once per scan: the drawing is cached by path.
                    resolveIconDrawing(theme, name, { size });
                    expect(warned.length).toBe(1);
                });
            });
        }

        await it('drops the cached drawings on `changed`, before any listener redraws', async () => {
            await withIcons(async (theme, warned) => {
                resolveIconDrawing(theme, 'old', { size: 16 });
                let redrawn = 0;
                const unsubscribe = onIconThemeChanged(theme, () => {
                    redrawn++;
                    resolveIconDrawing(theme, 'old', { size: 16 });
                });
                theme.add_resource_path('/org/gjsify/icons/none/');
                await new Promise((resolve) => setTimeout(resolve, 0));
                expect(redrawn).toBe(1);
                expect(warned.length).toBe(2);
                unsubscribe();
                resolveIconDrawing(theme, 'old', { size: 16 });
                theme.add_resource_path('/org/gjsify/icons/other/');
                await new Promise((resolve) => setTimeout(resolve, 0));
                expect(redrawn).toBe(1);
            });
        });
    });

    await describe('fitIconToGrid', async () => {
        await it('leaves a document already on the 16 grid, or one without a size, alone', () => {
            for (const svg of [
                '<svg viewBox="0 0 16 16"><path d="M0 0h1z"/></svg>',
                '<svg width="16" height="16"><path d="M0 0h1z"/></svg>',
                '<svg><path d="M0 0h1z"/></svg>',
                '<svg viewBox="0 0 0 16"><path d="M0 0h1z"/></svg>',
                'not an svg',
            ]) {
                expect(fitIconToGrid(svg)).toBe(svg);
            }
        });

        await it('scales a 32 viewBox down by half', () => {
            expect(fitIconToGrid('<svg viewBox="0 0 32 32"><path d="M0 0h1z"/></svg>')).toBe(
                '<svg viewBox="0 0 32 32"><g transform="matrix(0.5 0 0 0.5 0 0)"><path d="M0 0h1z"/></g></svg>',
            );
        });

        await it('reads width and height without a viewBox, and centres a non-square one', () => {
            expect(fitIconToGrid('<svg width="32" height="16"><path d="M0 0h1z"/></svg>')).toBe(
                '<svg width="32" height="16"><g transform="matrix(0.5 0 0 0.5 0 4)"><path d="M0 0h1z"/></g></svg>',
            );
        });

        await it('moves an offset viewBox to the origin', () => {
            expect(fitIconToGrid('<svg viewBox="8 8 16 16"><path d="M0 0h1z"/></svg>')).toBe(
                '<svg viewBox="8 8 16 16"><g transform="matrix(1 0 0 1 -8 -8)"><path d="M0 0h1z"/></g></svg>',
            );
        });
    });
};
