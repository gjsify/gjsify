// The package's own catalogues are asserted here and not in `check`, which is `gjsify tsc
// --noEmit` across this repository. A stale `po/` is a fact about the sources, so a test is where
// it belongs — and the only place that runs without a build having happened first.

import { createRequire } from 'node:module';
import { dirname } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';

import { syncSiteI18n } from '../site.js';

/**
 * This checkout. `import.meta.url` cannot answer it: the suite runs as a bundle at the package
 * root, so the inlined `site.ts` would resolve one directory too high.
 */
const packageDir = dirname(createRequire(import.meta.url).resolve('@gjsify/site/package.json'));

export default async () => {
    await describe('page catalogues', async () => {
        await it('carries every string the renderers can emit, all translated', async () => {
            const { stale, untranslated } = await syncSiteI18n({ packageDir, check: true });
            expect(stale).toStrictEqual([]);
            expect(untranslated).toStrictEqual([]);
        });
    });
};
