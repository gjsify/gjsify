// SPDX-License-Identifier: MIT
// The darwin bundle's locale catalogs — see packages/node-gi/scripts/locale-darwin.mjs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DARWIN_LOCALE_DOMAINS, stageDarwinLocale } from '../../scripts/locale-darwin.mjs';

describe('stageDarwinLocale', () => {
    it('throws when the source locale dir is missing', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-locale-'));
        try {
            assert.throws(() => stageDarwinLocale(dir, join(dir, 'nope')), /does not exist/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('copies only the four owned domains and only present locales', () => {
        const src = mkdtempSync(join(tmpdir(), 'gjsify-localesrc-'));
        const out = mkdtempSync(join(tmpdir(), 'gjsify-localeout-'));
        try {
            // Two locales, one complete, one partial, plus an unrelated domain.
            for (const lang of ['de', 'fr']) {
                mkdirSync(join(src, lang, 'LC_MESSAGES'), { recursive: true });
            }
            writeFileSync(join(src, 'de', 'LC_MESSAGES', 'gtk40.mo'), 'de-gtk');
            writeFileSync(join(src, 'de', 'LC_MESSAGES', 'libadwaita.mo'), 'de-adw');
            writeFileSync(join(src, 'de', 'LC_MESSAGES', 'glib20.mo'), 'de-glib');
            writeFileSync(join(src, 'de', 'LC_MESSAGES', 'gtksourceview-5.mo'), 'de-gsv');
            writeFileSync(join(src, 'de', 'LC_MESSAGES', 'some-other.mo'), 'unrelated');
            writeFileSync(join(src, 'fr', 'LC_MESSAGES', 'gtk40.mo'), 'fr-gtk');

            const result = stageDarwinLocale(out, src);
            assert.equal(result.locales, 2);
            assert.equal(result.files, 5);
            assert.ok(existsSync(join(out, 'share', 'locale', 'de', 'LC_MESSAGES', 'gtk40.mo')));
            assert.ok(existsSync(join(out, 'share', 'locale', 'de', 'LC_MESSAGES', 'libadwaita.mo')));
            assert.ok(!existsSync(join(out, 'share', 'locale', 'de', 'LC_MESSAGES', 'some-other.mo')));
            assert.ok(existsSync(join(out, 'share', 'locale', 'fr', 'LC_MESSAGES', 'gtk40.mo')));
        } finally {
            rmSync(src, { recursive: true, force: true });
            rmSync(out, { recursive: true, force: true });
        }
    });

    it('exposes the four owned domains', () => {
        assert.deepEqual(DARWIN_LOCALE_DOMAINS, ['gtk40', 'libadwaita', 'glib20', 'gtksourceview-5']);
    });
});
