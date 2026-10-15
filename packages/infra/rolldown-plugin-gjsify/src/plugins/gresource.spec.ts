// SPDX-License-Identifier: MIT
// `*.gresource.xml` imports (ADR 0116 §§ 1–2): the embedded bytes are `glib-compile-resources`'
// bytes, and the build options the subset cannot carry are refused by name.
//
// The fixture is Learn6502's `packages/app-gnome/data/eu.jumplink.Learn6502.data.gresource.xml`
// reduced to one entry per shape it uses (prefix, nested icon paths, `../` sources under an alias,
// `xml-stripblanks` everywhere). The resource FILES are stand-ins written here, not Learn6502's.

import { describe, it, expect } from '@gjsify/unit';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileGresource, gresourceModuleSource, gresourcePlugin, prepareGresourceXml } from './gresource.js';

const LEARN6502_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gresources>
  <gresource prefix="/eu/jumplink/Learn6502">
    <file preprocess="xml-stripblanks">metainfo/eu.jumplink.Learn6502.metainfo.xml</file>
    <file preprocess="xml-stripblanks">icons/scalable/actions/play-symbolic.svg</file>
    <file preprocess="xml-stripblanks">icons/scalable/actions/pause-symbolic.svg</file>
    <file alias="lang-specs/hex.lang" preprocess="xml-stripblanks">../../ui/data/lang-specs/hex.lang</file>
    <file alias="schemas/learn6502-style.xml" preprocess="xml-stripblanks">../../ui/data/styles/learn6502-style.xml</file>
  </gresource>
</gresources>
`;

const SVG = (d: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">\n  <path d="${d}"/>\n</svg>\n`;

const FILES: Record<string, string> = {
    'app-gnome/data/eu.jumplink.Learn6502.data.gresource.xml': LEARN6502_XML,
    'app-gnome/data/metainfo/eu.jumplink.Learn6502.metainfo.xml':
        '<?xml version="1.0"?>\n<component type="desktop-application">\n  <id>eu.jumplink.Learn6502</id>\n</component>\n',
    'app-gnome/data/icons/scalable/actions/play-symbolic.svg': SVG('M4 4v8l8-4z'),
    'app-gnome/data/icons/scalable/actions/pause-symbolic.svg': SVG('M4 4h3v8H4zm5 0h3v8H9z'),
    'ui/data/lang-specs/hex.lang':
        '<?xml version="1.0"?>\n<language id="hex" version="2.0">\n  <definitions/>\n</language>\n',
    'ui/data/styles/learn6502-style.xml':
        '<?xml version="1.0"?>\n<style-scheme id="Learn6502" version="1.0">\n</style-scheme>\n',
};

const XML_REL = 'app-gnome/data/eu.jumplink.Learn6502.data.gresource.xml';

function fixture(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-gresource-spec-'));
    for (const [rel, body] of Object.entries(files)) {
        const abs = join(root, ...rel.split('/'));
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, body, 'utf-8');
    }
    return root;
}

/** `glib-compile-resources --sourcedir=<xml dir>` run directly: the GNOME bytes. */
function compileDirect(root: string, xmlRel: string): Uint8Array {
    const xml = join(root, ...xmlRel.split('/'));
    const target = join(root, 'direct.gresource');
    execFileSync('glib-compile-resources', [`--sourcedir=${join(xml, '..')}`, `--target=${target}`, xml]);
    return new Uint8Array(readFileSync(target));
}

/** Evaluate the emitted module and return its default export. */
function evaluate(code: string): Uint8Array {
    return new Function(code.replace(/export default (\w+);\s*$/, 'return $1;'))() as Uint8Array;
}

function hasTool(name: string): boolean {
    try {
        execFileSync(name, ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

const throws = (fn: () => void): string => {
    try {
        fn();
    } catch (e) {
        return (e as Error).message;
    }
    return '';
};

export default async () => {
    await describe('gresource — § 2 descriptor rules', async () => {
        await it('refuses to-pixdata, naming the file, the line and the entry', async () => {
            const xml = LEARN6502_XML.replace(
                '<file preprocess="xml-stripblanks">icons/scalable/actions/pause',
                '<file preprocess="to-pixdata">icons/scalable/actions/pause',
            );
            const msg = throws(() => prepareGresourceXml(xml, 'app.gresource.xml', { compressed: 'keep' }));
            expect(msg).toContain('app.gresource.xml:6');
            expect(msg).toContain('pause-symbolic.svg');
            expect(msg).toContain('to-pixdata');
        });
        await it('refuses to-pixdata inside a preprocess list too', async () => {
            const xml =
                '<gresources><gresource><file preprocess="xml-stripblanks, to-pixdata">a.png</file></gresource></gresources>';
            expect(throws(() => prepareGresourceXml(xml, 'x', { compressed: 'strip' }))).toContain('a.png');
        });
        await it('ignores a commented-out to-pixdata entry', async () => {
            const xml = '<gresources><!-- <file preprocess="to-pixdata">a.png</file> --></gresources>';
            expect(prepareGresourceXml(xml, 'x', { compressed: 'keep' })).toBe(xml);
        });
        await it('drops compressed only under strip, leaving every other attribute', async () => {
            const xml =
                '<gresource>\n<file compressed="true" alias="b" preprocess="xml-stripblanks">a</file>\n</gresource>';
            expect(prepareGresourceXml(xml, 'x', { compressed: 'keep' })).toBe(xml);
            expect(prepareGresourceXml(xml, 'x', { compressed: 'strip' })).toBe(
                '<gresource>\n<file alias="b" preprocess="xml-stripblanks">a</file>\n</gresource>',
            );
        });
    });

    await describe('gresource — the emitted module', async () => {
        await it('decodes to the exact bytes for every padding length', async () => {
            for (let n = 0; n < 9; n++) {
                const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + 255) & 255);
                expect(Array.from(evaluate(gresourceModuleSource(bytes)))).toStrictEqual(Array.from(bytes));
            }
        });
    });

    const compile = hasTool('glib-compile-resources') ? it : it.skip;
    await describe('gresource — Learn6502 fixture, compiled (needs glib-compile-resources)', async () => {
        await compile('embeds the bytes glib-compile-resources produces for the XML', async () => {
            const root = fixture(FILES);
            try {
                const direct = compileDirect(root, XML_REL);
                const plugin = gresourcePlugin({ compressed: 'keep' });
                const watched: string[] = [];
                const load = plugin.load as (this: unknown, id: string) => Promise<{ code: string }>;
                const xml = join(root, ...XML_REL.split('/'));
                const { code } = await load.call({ addWatchFile: (f: string) => watched.push(f) }, xml);
                expect(Array.from(evaluate(code))).toStrictEqual(Array.from(direct));
                // Every file the bytes were read from is a build input, the aliased `../` ones too.
                expect(watched).toContain(xml);
                expect(watched.some((f) => f.endsWith('lang-specs/hex.lang'))).toBe(true);
                expect(watched.some((f) => f.endsWith('play-symbolic.svg'))).toBe(true);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
        await compile('strip compiles the XML as if compressed were absent', async () => {
            const compressedXml = LEARN6502_XML.replace(/<file /g, '<file compressed="true" ');
            const root = fixture({ ...FILES, [XML_REL]: compressedXml });
            try {
                const xml = join(root, ...XML_REL.split('/'));
                const stripped = await compileGresource(xml, { compressed: 'strip' });
                const kept = await compileGresource(xml, { compressed: 'keep' });
                writeFileSync(xml, LEARN6502_XML);
                const plain = compileDirect(root, XML_REL);
                expect(Array.from(stripped.bytes)).toStrictEqual(Array.from(plain));
                expect(Array.from(kept.bytes)).not.toStrictEqual(Array.from(plain));
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
        await compile('names a missing resource file through the compiler error', async () => {
            const root = fixture({ [XML_REL]: LEARN6502_XML });
            try {
                let msg = '';
                try {
                    await compileGresource(join(root, ...XML_REL.split('/')), { compressed: 'keep' });
                } catch (e) {
                    msg = (e as Error).message;
                }
                expect(msg).toContain('glib-compile-resources failed');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });
};
