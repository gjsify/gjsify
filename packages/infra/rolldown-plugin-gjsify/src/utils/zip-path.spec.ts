import { describe, expect, it } from '@gjsify/unit';

import { hasZipSegment } from './zip-path.js';

export default async () => {
    await describe('hasZipSegment', async () => {
        await it('finds a zip segment in a win32 path only with the win32 separator', () => {
            // A `.zip/`-only test missed every backslash-separated module id on win32.
            expect(hasZipSegment('.yarn\\cache\\pkg.zip\\node_modules\\pkg\\index.js', '\\')).toBe(true);
            expect(hasZipSegment('.yarn\\cache\\pkg.zip\\node_modules\\pkg\\index.js', '/')).toBe(false);
        });

        await it('finds a POSIX zip segment on every host', () => {
            expect(hasZipSegment('.yarn/cache/pkg.zip/node_modules/pkg/index.js', '/')).toBe(true);
            expect(hasZipSegment('.yarn/cache/pkg.zip/node_modules/pkg/index.js', '\\')).toBe(true);
            expect(hasZipSegment('dist/archive.zip', '/')).toBe(false);
        });
    });
};
