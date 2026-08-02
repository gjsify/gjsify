// SPDX-License-Identifier: MIT
// `readPackageJson` — the permissive manifest reader every discovery path uses
// (`gjsify run`/`workspace`/`foreach`/`check`, native-prebuild scanning).
//
// Why the BOM rows exist: this reader reports an unparseable manifest as
// `null`, and `null` is indistinguishable from "no package.json here" to every
// caller. `JSON.parse` rejects `U+FEFF` — it is not whitespace — so a manifest
// with a UTF-8 BOM made a package look like it had no manifest at all: `gjsify
// check` found no `check` script, discovery skipped the package, and nothing
// said why.
//
// That file shape is the Windows default, not an exotic one. Windows PowerShell
// 5.1 writes a BOM for `-Encoding utf8`, which is what `Out-File` and
// `Set-Content` use unless told otherwise, so any script that edits a manifest
// there produces one — and npm reads it without complaint (`npm pkg get name`
// returns the name), so nothing upstream flags the file as wrong.

import { describe, expect, it } from '@gjsify/unit';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readPackageJson, stripBom } from './pkg-json.js';

const BOM = '﻿';

export default async () => {
    await describe('stripBom', async () => {
        await it('removes a leading BOM', () => {
            expect(stripBom(`${BOM}{"a":1}`)).toBe('{"a":1}');
        });

        await it('leaves text without a BOM untouched', () => {
            expect(stripBom('{"a":1}')).toBe('{"a":1}');
            expect(stripBom('')).toBe('');
        });

        await it('only strips a LEADING one', () => {
            // Elsewhere `U+FEFF` is a zero-width no-break space inside a string
            // value; removing it would corrupt the data.
            expect(stripBom(`{"a":"x${BOM}y"}`)).toBe(`{"a":"x${BOM}y"}`);
        });
    });

    await describe('readPackageJson', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-pkg-json-'));

        try {
            await it('reads a plain manifest', () => {
                const p = join(dir, 'plain.json');
                writeFileSync(p, JSON.stringify({ name: 'plain', version: '1.0.0' }));
                expect(readPackageJson(p)?.name).toBe('plain');
            });

            await it('reads a manifest written with a UTF-8 BOM', () => {
                // The regression: this returned `null`, which every caller reads
                // as "no package.json".
                const p = join(dir, 'bom.json');
                writeFileSync(p, BOM + JSON.stringify({ name: 'bom', version: '1.0.0' }));
                expect(readPackageJson(p)?.name).toBe('bom');
            });

            await it('still returns null for a missing file', () => {
                expect(readPackageJson(join(dir, 'nope.json'))).toBe(null);
            });

            await it('still returns null for genuinely malformed JSON', () => {
                // The permissive contract is unchanged — only the BOM stopped
                // counting as malformed.
                const p = join(dir, 'broken.json');
                writeFileSync(p, '{ this is not json');
                expect(readPackageJson(p)).toBe(null);
            });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
};
