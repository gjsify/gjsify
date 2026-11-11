import { describe, expect, it } from '@gjsify/unit';

import { BRAND_ICONS, icon, type IconName } from './icons.js';

const UI_ICONS: IconName[] = ['web', 'package', 'download', 'license', 'close', 'copy', 'feed'];

export default async () => {
    await describe('icons', async () => {
        await it('draws every icon as an svg with at least one shape', async () => {
            for (const name of [...BRAND_ICONS, ...UI_ICONS]) {
                const svg = icon(name);
                expect(svg.startsWith('<svg')).toBe(true);
                expect(/<(path|circle|ellipse)\b/.test(svg)).toBe(true);
            }
        });

        await it('gives every brand mark numbered part classes and the brand hooks', async () => {
            for (const name of BRAND_ICONS) {
                const svg = icon(name);
                expect(svg.includes(`icon-brand icon-${name}`)).toBe(true);
                expect(/class="b1"/.test(svg)).toBe(true);
            }
            expect((icon('windows').match(/class="b\d"/g) ?? []).length).toBe(4);
            expect(icon('download').includes('icon-brand')).toBe(false);
        });

        await it('uses no ids, which would repeat when a mark stands twice on a page', async () => {
            for (const name of BRAND_ICONS) expect(/\sid="/.test(icon(name))).toBe(false);
        });
    });
};
