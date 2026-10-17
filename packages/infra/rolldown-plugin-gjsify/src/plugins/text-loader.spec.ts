// SPDX-License-Identifier: MIT
// `gjsify.loaders` runs before the app presets, so an `".xml": "text"` entry must not claim a
// `.gresource.xml` import: that one is `gresourcePlugin`'s compiled bytes (ADR 0116 § 1).

import { describe, it, expect } from '@gjsify/unit';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { textLoaderPlugin } from './text-loader.js';

type Load = (this: unknown, id: string) => Promise<{ code: string } | null>;

export default async () => {
    await describe('textLoaderPlugin', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-text-loader-'));
        const style = join(dir, 'style.xml');
        const descriptor = join(dir, 'app.data.gresource.xml');
        writeFileSync(style, '<style-scheme id="s"/>');
        writeFileSync(descriptor, '<gresources/>');
        const plugin = textLoaderPlugin({ loaders: { '.xml': 'text' } });
        const load = plugin?.load as Load;

        await it('loads a configured extension as a string default export', async () => {
            const result = await load.call({}, style);
            expect(result?.code).toBe(`export default ${JSON.stringify('<style-scheme id="s"/>')};`);
        });

        await it('leaves a .gresource.xml import to gresourcePlugin despite ".xml": "text"', async () => {
            expect(await load.call({}, descriptor)).toBeNull();
        });

        rmSync(dir, { recursive: true, force: true });
    });
};
