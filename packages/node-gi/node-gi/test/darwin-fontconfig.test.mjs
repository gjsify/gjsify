// SPDX-License-Identifier: MIT
// The darwin bundle's fontconfig config — see packages/node-gi/scripts/fontconfig-darwin.mjs.
//
// This is a pure-data test: it does not build a bundle. It pins the shape of the config
// that fixed the "body text in Adwaita Mono, heading in Helvetica" defect, so a future
// edit cannot silently drop the relative dir, the system font dirs, or the rule that
// maps GTK's `.AppleSystemUIFont` (a CoreText-only name) to Adwaita Sans.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    DARWIN_FONTS_CONF_PATH,
    renderDarwinFontsConf,
    stageDarwinFontconfig,
} from '../../scripts/fontconfig-darwin.mjs';

describe('renderDarwinFontsConf', () => {
    const xml = renderDarwinFontsConf();

    it('uses a path relative to the config file, never the build host', () => {
        assert.match(xml, /<dir prefix="relative">..\/..\/share\/fonts<\/dir>/);
        // No absolute host prefix may leak in.
        assert.doesNotMatch(xml, /\/opt\/homebrew/);
        assert.doesNotMatch(xml, /\/usr\/local/);
    });

    it('names the macOS system font dirs for glyph fallback', () => {
        assert.match(xml, /<dir>\/System\/Library\/Fonts<\/dir>/);
        assert.match(xml, /<dir>\/System\/Library\/Fonts\/Supplemental<\/dir>/);
        assert.match(xml, /<dir>\/Library\/Fonts<\/dir>/);
        assert.match(xml, /<dir>~\/Library\/Fonts<\/dir>/);
    });

    it('uses an XDG cache dir inside the user profile, not the bundle', () => {
        assert.match(xml, /<cachedir prefix="xdg">fontconfig<\/cachedir>/);
    });

    it('maps GTKs CoreText-only gtk-font-name to Adwaita Sans', () => {
        // GTK's macOS backend sets gtk-font-name to .AppleSystemUIFont, which only CoreText
        // knows. With PANGOCAIRO_BACKEND=fc, fontconfig must be told what it means.
        assert.match(xml, /<test name="family"><string>\.AppleSystemUIFont<\/string><\/test>/);
        assert.match(xml, /<edit name="family" mode="assign" binding="strong"><string>Adwaita Sans<\/string><\/edit>/);
    });

    it('prefers Adwaita Sans / Adwaita Mono for the generic families', () => {
        assert.match(xml, /<family>sans-serif<\/family><prefer><family>Adwaita Sans<\/family>/);
        assert.match(xml, /<family>monospace<\/family><prefer><family>Adwaita Mono<\/family>/);
    });
});

describe('stageDarwinFontconfig', () => {
    it('refuses to stage when the faces are not there yet', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-fonts-'));
        try {
            assert.throws(() => stageDarwinFontconfig(dir), /share\/fonts does not exist/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('writes the config at etc/fonts/fonts.conf', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-fonts-'));
        try {
            mkdirSync(join(dir, 'share', 'fonts'), { recursive: true });
            const out = stageDarwinFontconfig(dir);
            assert.equal(out, join(dir, DARWIN_FONTS_CONF_PATH));
            assert.ok(existsSync(out));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
