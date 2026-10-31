// SPDX-License-Identifier: MIT
// The `./types` declaration types a stylesheet import as the CSS `string` the plugin's
// `export default` carries (`plugins/css-as-string.ts`). The reference below goes through the
// package's own export map, so a broken `exports` entry or a `.d.ts` missing from `files` fails
// `check` here. The imports are `import type`: erased, so neither the file nor the bundled test
// has to exist.

/// <reference types="@gjsify/rolldown-plugin-gjsify/types" />

import { describe, it, expect } from '@gjsify/unit';
import type css from './fixture.css';
import type scss from './fixture.scss';
import type sass from './fixture.sass';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const isCssString: Equal<typeof css, string> = true;
const isScssString: Equal<typeof scss, string> = true;
const isSassString: Equal<typeof sass, string> = true;

export default async () => {
    await describe('stylesheet ambient declaration', async () => {
        await it('types .css, .scss and .sass default exports as string', async () => {
            expect(isCssString).toBe(true);
            expect(isScssString).toBe(true);
            expect(isSassString).toBe(true);
        });
    });
};
