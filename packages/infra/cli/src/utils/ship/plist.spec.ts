// SPDX-License-Identifier: MIT
// `Contents/Info.plist` and `Contents/PkgInfo`, at the level a parser cannot see.
//
// `tests/e2e/ship-macos` reads a real bundle back with CPython's `plistlib`, which
// is the oracle and settles whether the file PARSES and whether its values agree
// with the stage. What it structurally cannot settle is what happens to input the
// fixture does not contain — an ampersand in a display name, a control character
// no XML document can carry — because a rendered plist that is wrong for those is
// still a plist, and `plistlib` would either read the wrong string back happily or
// fail three milestones later on somebody else's app.
//
// So: the oracle owns "is it a bundle", and this file owns the two edges that
// produce a WELL-FORMED WRONG answer.

import { describe, expect, it } from '@gjsify/unit';

import { BUNDLE_INFO_PLIST, BUNDLE_PKGINFO, renderInfoPlist, renderPkgInfo } from './plist.js';

const IDENTITY = {
    binaryName: 'ship-demo',
    name: 'Ship Demo',
    appId: 'org.example.ShipDemo',
    version: '1.2.3',
    release: '1',
};

/** `<key>K</key>\n\t<string>V</string>` → `V`, read out of the rendered text. */
function value(plist: string, key: string): string | null {
    const found = new RegExp(`<key>${key}</key>\\n\\t<string>([^<]*)</string>`).exec(plist);
    return found === null ? null : (found[1] as string);
}

export default async () => {
    await describe('renderInfoPlist', async () => {
        await it('names the two files with Apple spellings and nothing of ours', async () => {
            // The constants travel to `layout.ts` and to the e2e's expected file
            // set. A rename here that a reader "tidied" would move the file
            // LaunchServices looks for, and nothing at runtime would say so.
            expect(BUNDLE_INFO_PLIST).toBe('Contents/Info.plist');
            expect(BUNDLE_PKGINFO).toBe('Contents/PkgInfo');
        });

        await it('carries the version twice, and only one of them has the release', async () => {
            // Apple's rule, and this command already has the pair: the short
            // string is the marketing version a user sees, `CFBundleVersion` is
            // the build. Emitting `version` for both would throw away the one
            // distinction macOS has a field for — and the two look identical in
            // every fixture whose release is `1`, which is why this is asserted
            // with a release that is not.
            const plist = renderInfoPlist({ ...IDENTITY, release: '7' });
            expect(value(plist, 'CFBundleShortVersionString')).toBe('1.2.3');
            expect(value(plist, 'CFBundleVersion')).toBe('1.2.3-7');
        });

        await it('escapes `&` before the entities its own escaping introduces', async () => {
            // ORDER IS THE WHOLE BUG. Replacing `<` and `>` first and `&` last
            // re-escapes the ampersands the earlier passes wrote, so `A & B`
            // renders as `A &amp;amp; B` and every reader shows the user the
            // literal text `&amp;`. A plist that does that is well-formed, parses
            // cleanly, and is wrong.
            const plist = renderInfoPlist({ ...IDENTITY, name: 'Ship & <Co>' });
            expect(plist).toContain('<string>Ship &amp; &lt;Co&gt;</string>');
            expect(plist.includes('&amp;amp;')).toBe(false);
            expect(plist.includes('&amp;lt;')).toBe(false);
        });

        await it('leaves quotes alone, because element CONTENT is where these land', async () => {
            // Not laziness: `"` and `'` are only special inside an attribute
            // value, and every string this renders is element content. Escaping
            // them would produce a file whose values a human reading it has to
            // decode, for no reader's benefit.
            expect(renderInfoPlist({ ...IDENTITY, name: `The "Demo" App` })).toContain(
                '<string>The "Demo" App</string>',
            );
        });

        await it('refuses a control character XML has no escape for, naming the field and the key', async () => {
            // NOT representable — not merely inconvenient. There is no entity for
            // U+0001 in XML 1.0, so a name carrying one produces a file
            // `plistlib` and `CFPropertyList` both reject. Refusing here means the
            // author is told on the machine that has the config; the alternative
            // is a parse error on a Mac, three milestones away, with no config in
            // reach.
            //
            // ESCAPE SEQUENCES, never the literal bytes: a raw control character
            // in a source file is invisible in every diff and every review, and
            // `scripts/check-source-control-bytes.mjs` exists because one of them
            // (NUL) reached a tracked file already.
            expect(() => renderInfoPlist({ ...IDENTITY, name: 'Ship\u0001Demo' })).toThrow('U+0001');
            expect(() => renderInfoPlist({ ...IDENTITY, name: 'Ship\u0001Demo' })).toThrow('gjsify.ship.name');
            expect(() => renderInfoPlist({ ...IDENTITY, binaryName: 'a\u0000b' })).toThrow('CFBundleExecutable');
            expect(() => renderInfoPlist({ ...IDENTITY, appId: 'org\u001fexample.X' })).toThrow('CFBundleIdentifier');
        });

        await it('does NOT refuse DEL or C1, which the oracle accepts', async () => {
            // The half that keeps the guard from being a papercut, and it is
            // measured rather than reasoned: the first cut refused U+007F and
            // U+0080-U+009F "because XML forbids them", and XML 1.0 does not.
            // Probed through `plistlib` on CPython 3.14, one code point per
            // document, all three came back accepted with the value intact. A
            // guard that turns working packages into failures buys nothing over
            // the defect it prevents — the same trade `assertLauncherMatchesInterpreter`
            // makes one file over.
            expect(() => renderInfoPlist({ ...IDENTITY, name: 'Ship\u007fDemo' })).not.toThrow();
            expect(() => renderInfoPlist({ ...IDENTITY, name: 'Ship\u0085Demo' })).not.toThrow();
            expect(() => renderInfoPlist({ ...IDENTITY, name: 'Ship\u009fDemo' })).not.toThrow();
        });

        await it('allows the three whitespace characters XML does carry', async () => {
            // The other half of the same rule, and the half that turns a guard
            // into a papercut if it is wrong: tab, LF and CR are legal in element
            // content, so refusing them would reject a multi-line display name
            // over a rule about C0.
            expect(() => renderInfoPlist({ ...IDENTITY, name: 'Ship\tDemo\nII' })).not.toThrow();
        });

        await it('emits no key this milestone cannot cite', async () => {
            // The list is in `plist.ts`'s header with the measurement behind it.
            // Asserted here as well as in the oracle because the two catch
            // different hands: the oracle reads one bundle, this reads the
            // renderer, so a key added behind a conditional the fixture does not
            // reach reds here and nowhere else.
            const plist = renderInfoPlist(IDENTITY);
            for (const key of [
                'CFBundleIconFile',
                'LSMinimumSystemVersion',
                'NSHighResolutionCapable',
                'LSApplicationCategoryType',
                'NSHumanReadableCopyright',
            ]) {
                expect(plist.includes(key)).toBe(false);
            }
        });

        await it('is XML, not the binary form, and says which version of the format', async () => {
            // `plistlib` reads both, so a binary writer would pass the oracle —
            // and would be a file this tree wrote read back by a reader this tree
            // wrote, which ADR 0024 § A3 calls `selfReading` and refuses to
            // release. The XML form is what makes CPython an independent parser
            // rather than half of a round trip.
            const plist = renderInfoPlist(IDENTITY);
            expect(plist.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
            expect(plist).toContain('<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"');
            expect(plist).toContain('<plist version="1.0">');
            expect(plist.endsWith('</plist>\n')).toBe(true);
        });
    });

    await describe('renderPkgInfo', async () => {
        await it('is eight bytes with no terminator', async () => {
            // `refs/node/tools/gyp/pylib/gyp/mac_tool.py:245` writes
            // `f"{package_type}{signature_code}"` and nothing else. A trailing
            // newline makes it nine bytes — the kind of difference nothing
            // complains about and every byte comparison notices, which is why the
            // oracle compares bytes rather than a stripped string.
            expect(renderPkgInfo()).toBe('APPL????');
            expect(new TextEncoder().encode(renderPkgInfo()).byteLength).toBe(8);
        });

        await it('agrees with the plist about the package type', async () => {
            // The two files are redundant BY DESIGN — PkgInfo is the pre-plist
            // Carbon record LaunchServices still reads — and gyp writes both from
            // one source for exactly this reason. Two constants that can drift
            // apart is the shape where a bundle declares one type and records
            // another.
            expect(renderInfoPlist(IDENTITY)).toContain(`<string>${renderPkgInfo().slice(0, 4)}</string>`);
            expect(renderInfoPlist(IDENTITY)).toContain(`<string>${renderPkgInfo().slice(4)}</string>`);
        });

        await it('declares the font directory only when the bundle carries one', async () => {
            // ADR 0038, and on this OS the key is not a nicety beside the
            // XDG_DATA_DIRS path — it IS the path. Pango on macOS is CoreText-backed
            // and GTK is not built against fontconfig there, so a `fonts.conf` in the
            // bundle would be inert and this is the only per-app activation there is.
            const withFonts = renderInfoPlist(IDENTITY, 'share/fonts/org.example.ShipDemo');
            expect(value(withFonts, 'ATSApplicationFontsPath')).toBe('share/fonts/org.example.ShipDemo');

            // ABSENT, not empty. An empty string is a path too, and macOS would
            // activate `Contents/Resources` itself — every file in the bundle offered
            // to the font manager, which is a different bug and a silent one.
            expect(value(renderInfoPlist(IDENTITY), 'ATSApplicationFontsPath')).toBe(null);
            expect(renderInfoPlist(IDENTITY).includes('ATSApplicationFontsPath')).toBe(false);
        });
    });
};
