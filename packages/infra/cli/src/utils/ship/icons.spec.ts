import { describe, expect, it } from '@gjsify/unit';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pngSize, tinyPng } from './icon-fixture.spec.js';
import { RASTERIZER, rasterizeSvg, readPngSize, resolveAppIcon } from './icons.js';

/** The message of the error an async call rejects with, or null when it resolves. */
async function refusal(run: () => Promise<unknown>): Promise<string | null> {
    try {
        await run();
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

/** A fake renderer: solid PNGs at the asked sizes, recording what it was asked for. */
function fakeRasterizer(asked: number[][]): (input: { svg: string; sizes: readonly number[] }) => Promise<Map<number, Uint8Array>> {
    return async ({ sizes }) => {
        asked.push([...sizes]);
        return new Map(sizes.map((size) => [size, tinyPng(size)]));
    };
}

function hasCommand(name: string): boolean {
    try {
        execFileSync(name, ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

export default async () => {
    await describe('ship icons: readPngSize', async () => {
        await it('reads the IHDR and refuses what is not a whole PNG', async () => {
            expect(readPngSize(tinyPng(48), 'x')).toStrictEqual({ width: 48, height: 48 });
            expect(readPngSize(tinyPng(20, 10), 'x')).toStrictEqual({ width: 20, height: 10 });
            expect(() => readPngSize(new Uint8Array(40), 'a.png')).toThrow('not a PNG');
            // A truncated file keeps its whole header, so the size reads fine —
            // and the IEND check is what says the file is not all there.
            expect(() => readPngSize(tinyPng(16).subarray(0, 60), 'cut.png')).toThrow('truncated');
        });
    });

    await describe('ship icons: resolveAppIcon', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-icons-'));
        const hicolor = join(dir, 'data', 'icons', 'hicolor');
        const svg = join(hicolor, 'scalable', 'apps', 'org.example.App.svg');
        mkdirSync(join(hicolor, 'scalable', 'apps'), { recursive: true });
        writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>\n');
        const symbolic = join(hicolor, 'symbolic', 'apps', 'org.example.App-symbolic.svg');
        mkdirSync(join(hicolor, 'symbolic', 'apps'), { recursive: true });
        writeFileSync(symbolic, '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
        const sized = (size: number, bytes = tinyPng(size)): string => {
            const path = join(hicolor, `${size}x${size}`, 'apps', 'org.example.App.png');
            mkdirSync(join(hicolor, `${size}x${size}`, 'apps'), { recursive: true });
            writeFileSync(path, bytes);
            return path;
        };

        await it('renders every size from the SVG when the project ships nothing else', async () => {
            const asked: number[][] = [];
            const icon = await resolveAppIcon({
                iconFiles: [svg, symbolic],
                appId: 'org.example.App',
                sizes: [16, 32, 256],
                target: 'the test',
                rasterize: fakeRasterizer(asked),
            });
            expect(asked).toStrictEqual([[16, 32, 256]]);
            expect([...icon.png.keys()]).toStrictEqual([16, 32, 256]);
            expect(icon.source).toContain(svg);
            // The symbolic icon is never the source: the SVG chosen is the scalable one.
            expect(icon.source.includes('symbolic')).toBe(false);
        });

        await it("uses a project's own PNG at its size and renders only the rest", async () => {
            const png32 = sized(32);
            const asked: number[][] = [];
            const icon = await resolveAppIcon({
                iconFiles: [svg, png32],
                appId: 'org.example.App',
                sizes: [16, 32, 48],
                target: 'the test',
                rasterize: fakeRasterizer(asked),
            });
            expect(asked).toStrictEqual([[16, 48]]);
            // The PROJECT's bytes at 32, not a render — byte-identical to the file.
            expect(Buffer.from(icon.png.get(32) ?? []).equals(Buffer.from(tinyPng(32)))).toBe(true);
            expect(icon.source).toContain('1 sized PNG(s)');
            rmSync(join(hicolor, '32x32'), { recursive: true });
        });

        await it('refuses an app with no icon at all, naming the file to add', async () => {
            const message = await refusal(() =>
                resolveAppIcon({ iconFiles: [symbolic], appId: 'org.example.App', sizes: [16], target: 'the Windows icon' }),
            );
            expect(message).toContain('the Windows icon');
            expect(message).toContain('data/icons/hicolor/scalable/apps/org.example.App.svg');
            expect(message).toContain('gjsify.ship.icon');
        });

        await it('refuses PNGs that leave a size uncovered when there is no SVG to render it from', async () => {
            const png48 = sized(48);
            const message = await refusal(() =>
                resolveAppIcon({ iconFiles: [png48], appId: 'org.example.App', sizes: [16, 48, 256], target: 'the test' }),
            );
            // Names exactly the sizes missing and the two ways to supply them.
            expect(message).toContain('16, 256 px');
            expect(message).toContain('data/icons/hicolor/16x16/apps/org.example.App.png');
            expect(message).toContain('data/icons/hicolor/256x256/apps/org.example.App.png');
            expect(message).toContain('scalable/apps/org.example.App.svg');
            rmSync(join(hicolor, '48x48'), { recursive: true });
        });

        await it('refuses a PNG whose pixels disagree with its path', async () => {
            // `32x32/apps/x.png` holding a 48 px image: the theme would serve it at
            // the wrong size and the icon writers would embed it under a header
            // that lies. The IHDR is the truth; the path is the claim.
            const lying = sized(32, tinyPng(48));
            const message = await refusal(() =>
                resolveAppIcon({ iconFiles: [svg, lying], appId: 'org.example.App', sizes: [32], target: 'the test' }),
            );
            expect(message).toContain('48×48');
            expect(message).toContain('32x32');
            rmSync(join(hicolor, '32x32'), { recursive: true });
        });

        await it('refuses a non-square PNG', async () => {
            const wide = sized(64, tinyPng(64, 32));
            const message = await refusal(() =>
                resolveAppIcon({ iconFiles: [svg, wide], appId: 'org.example.App', sizes: [64], target: 'the test' }),
            );
            expect(message).toContain('64×32');
            rmSync(join(hicolor, '64x64'), { recursive: true });
        });

        rmSync(dir, { recursive: true, force: true });
    });

    await describe('ship icons: the GJS rasterizer', async () => {
        // BOTH ARMS DISCRIMINATE, and which one runs is a fact about the host,
        // printed in the test name rather than hidden in a skip. With a `gjs` on
        // PATH the child renders and the PNGs are read back by arithmetic; without
        // one the refusal has to name the tool and the packages that provide it —
        // which is the message a stranger's build sees.
        const present = hasCommand(RASTERIZER);
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-rasterize-'));
        const svg = join(dir, 'icon.svg');
        writeFileSync(
            svg,
            '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">' +
                '<rect width="8" height="8" fill="#204080"/></svg>\n',
        );

        await it(`renders through ${RASTERIZER} at every asked size (${RASTERIZER} ${present ? 'present' : 'absent'})`, async () => {
            if (!present) {
                const message = await refusal(() => rasterizeSvg({ svg, sizes: [16] }));
                expect(message).toContain(RASTERIZER);
                expect(message).toContain('dnf install');
                return;
            }
            const png = await rasterizeSvg({ svg, sizes: [16, 24, 256] });
            expect([...png.keys()]).toStrictEqual([16, 24, 256]);
            for (const size of [16, 24, 256]) {
                expect(pngSize(png.get(size) ?? new Uint8Array())).toStrictEqual({ width: size, height: size });
            }
            // Rendered per size, not resampled: two different sizes are two
            // different files, and the same size twice is the same file.
            expect(Buffer.from(png.get(16) ?? []).equals(Buffer.from(png.get(24) ?? []))).toBe(false);
            const again = await rasterizeSvg({ svg, sizes: [16] });
            expect(Buffer.from(png.get(16) ?? []).equals(Buffer.from(again.get(16) ?? []))).toBe(true);
        });

        await it(`refuses a file that is not an SVG, with the renderer's own words (${present ? 'live' : 'absent'})`, async () => {
            if (!present) return expect(present).toBe(false);
            writeFileSync(join(dir, 'not.svg'), 'this is not xml');
            const message = await refusal(() => rasterizeSvg({ svg: join(dir, 'not.svg'), sizes: [16] }));
            expect(message).toContain('not.svg');
            expect(message).toContain('failed');
        });

        rmSync(dir, { recursive: true, force: true });
    });
};
