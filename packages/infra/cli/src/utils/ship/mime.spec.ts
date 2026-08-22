// SPDX-License-Identifier: MIT
// MIME-type definitions, and — the half that matters — what they REFUSE.
//
// Every refusal covers one shape of the same failure: a file type that is registered and then never
// resolves. That failure is silent by construction. Nothing on the system knows the type exists, so
// the file manager never assigns it, `MimeType=` in the desktop entry matches nothing, and a
// double-click does nothing at all — no error, no log line. It is indistinguishable from the app
// not being installed, which is why it has to be refused at pack time rather than reported at
// install time.

import { describe, expect, it } from '@gjsify/unit';

import { renderMimePackage, validateMimeTypes } from './mime.js';
import type { ShipMimeType } from './types.js';

const BAUPLAN: ShipMimeType = {
    type: 'application/x-bauplan',
    comment: 'Bauplaner project',
    globs: ['*.bauplan'],
};

/** The message of the error a call throws, or null when it does not throw. */
function refusal(fn: () => void): string | null {
    try {
        fn();
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

export default async () => {
    await describe('validateMimeTypes', async () => {
        await it('accepts a well-formed definition', () => {
            expect(refusal(() => validateMimeTypes([BAUPLAN]))).toBe(null);
            expect(
                refusal(() =>
                    validateMimeTypes([
                        { type: 'application/x-bauplan+zip', comment: 'Zipped', subClassOf: 'application/zip' },
                    ]),
                ),
            ).toBe(null);
        });

        // update-mime-database ignores a malformed name, so the type installs and never resolves.
        await it('refuses a type that is not <media>/<subtype>', () => {
            for (const type of ['bauplan', 'application/', '/x-bauplan', 'application/x bauplan', 'App/X']) {
                const message = refusal(() => validateMimeTypes([{ ...BAUPLAN, type }]));
                expect(message !== null).toBe(true);
                expect(message?.includes(type)).toBe(true);
            }
        });

        await it('refuses a duplicate definition, whose winner would depend on order', () => {
            const message = refusal(() => validateMimeTypes([BAUPLAN, { ...BAUPLAN, comment: 'Other' }]));
            expect(message?.includes('twice')).toBe(true);
        });

        // A file manager falls back to showing the raw type string.
        await it('refuses an empty comment', () => {
            expect(refusal(() => validateMimeTypes([{ ...BAUPLAN, comment: '' }])) !== null).toBe(true);
            expect(refusal(() => validateMimeTypes([{ ...BAUPLAN, comment: '   ' }])) !== null).toBe(true);
        });

        // `bauplan` as a glob matches a file called exactly `bauplan`, never `haus.bauplan`.
        await it('refuses a glob with no wildcard, and suggests the pattern', () => {
            const message = refusal(() => validateMimeTypes([{ ...BAUPLAN, globs: ['bauplan'] }]));
            expect(message?.includes('*.bauplan')).toBe(true);
            // A leading dot is stripped from the suggestion rather than doubled.
            expect(refusal(() => validateMimeTypes([{ ...BAUPLAN, globs: ['.bauplan'] }]))?.includes('*.bauplan')).toBe(
                true,
            );
        });

        // Registered and unreachable: nothing can ever match it.
        await it('refuses a type with neither globs nor a parent type', () => {
            const message = refusal(() => validateMimeTypes([{ type: 'application/x-void', comment: 'Void' }]));
            expect(message?.includes('never')).toBe(true);
            expect(
                refusal(() => validateMimeTypes([{ type: 'application/x-void', comment: 'V', globs: [] }])) !== null,
            ).toBe(true);
        });
    });

    await describe('renderMimePackage', async () => {
        await it('writes the shared-mime-info document update-mime-database reads', () => {
            const xml = renderMimePackage([BAUPLAN]);
            expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
            // The namespace is not decoration: without it the document is skipped entirely.
            expect(xml.includes('xmlns="http://www.freedesktop.org/standards/shared-mime-info"')).toBe(true);
            expect(xml.includes('<mime-type type="application/x-bauplan">')).toBe(true);
            expect(xml.includes('<comment>Bauplaner project</comment>')).toBe(true);
            expect(xml.includes('<glob pattern="*.bauplan"/>')).toBe(true);
            expect(xml.trimEnd().endsWith('</mime-info>')).toBe(true);
        });

        await it('carries sub-class-of and generic-icon when given', () => {
            const xml = renderMimePackage([
                {
                    type: 'application/x-bauplan',
                    comment: 'Bauplaner project',
                    globs: ['*.bauplan'],
                    subClassOf: 'application/zip',
                    genericIcon: 'text-x-generic',
                },
            ]);
            expect(xml.includes('<sub-class-of type="application/zip"/>')).toBe(true);
            expect(xml.includes('<generic-icon name="text-x-generic"/>')).toBe(true);
        });

        // An unescaped `&` makes the document malformed, and update-mime-database then skips the
        // WHOLE file — so one bad comment silently costs every type in the package.
        await it('escapes XML metacharacters in text and attributes', () => {
            const xml = renderMimePackage([
                { type: 'application/x-a', comment: 'Plans & "sections" <draft>', globs: ['*.a&b'] },
            ]);
            expect(xml.includes('Plans &amp; &quot;sections&quot; &lt;draft&gt;')).toBe(true);
            expect(xml.includes('pattern="*.a&amp;b"')).toBe(true);
            expect(xml.includes('Plans & "')).toBe(false);
        });

        await it('emits every declared type in one document', () => {
            const xml = renderMimePackage([
                BAUPLAN,
                { type: 'application/x-other', comment: 'Other', globs: ['*.oth'] },
            ]);
            expect((xml.match(/<mime-type /g) ?? []).length).toBe(2);
        });
    });
};
