// SPDX-License-Identifier: MIT
// The `./types` declaration types a `.gresource.xml` import as `Uint8Array` (ADR 0116 § 1).
// The reference below goes through the package's own export map, so a broken `exports` entry or a
// `.d.ts` missing from `files` fails `check` here. The import is `import type`: erased, so the
// bundler never resolves the (nonexistent) XML.

/// <reference types="@gjsify/rolldown-plugin-gjsify/types" />

import { describe, it, expect } from '@gjsify/unit';
import type bytes from './fixture.data.gresource.xml';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const isUint8Array: Equal<typeof bytes, Uint8Array> = true;

export default async () => {
    await describe('gresource.xml ambient declaration', async () => {
        await it('types the default export as Uint8Array', async () => {
            expect(isUint8Array).toBe(true);
        });
    });
};
