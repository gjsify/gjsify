// Regression coverage for @gjsify/oxfmt-native — the Node-free engine
// behind `gjsify format` under GJS.
//
// Each `it()` block was previously a one-off `gjs -m /tmp/...` smoke
// script; this file turns them into permanent regression guards against
// the Vala/Rust prebuild + the TS facade. GJS-only because the native
// bridge needs the GjsifyOxfmt typelib.

import { describe, expect, it, on } from '@gjsify/unit';
import GLib from 'gi://GLib?version=2.0';
import { format, hasNativeOxfmt, runOxfmt } from '@gjsify/oxfmt-native';

// GJS provides TextDecoder natively; this suite compiles with `types: []`
// (no DOM/Node lib), so declare the minimal surface used below.
declare const TextDecoder: new () => { decode(bytes: Uint8Array): string };

function tmpdir(prefix: string): string {
    const dir = `/tmp/${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    GLib.mkdir_with_parents(dir, 0o755);
    return dir;
}

function writeFile(path: string, contents: string): void {
    GLib.file_set_contents(path, contents);
}

function readFile(path: string): string {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok) throw new Error(`failed to read ${path}`);
    return new TextDecoder().decode(bytes);
}

export default async () => {
    await on('Gjs', async () => {
        await describe('hasNativeOxfmt()', async () => {
            await it('loads the GjsifyOxfmt typelib', async () => {
                expect(hasNativeOxfmt()).toBe(true);
            });
        });

        await describe('format() — single-shot in-memory', async () => {
            await it('formats TypeScript with Prettier-compatible defaults', async () => {
                expect(format('const   x:number=1', 'f.ts')).toBe('const x: number = 1;\n');
            });

            await it('selects the dialect from the filename extension (TSX)', async () => {
                const out = format('const  el=<div className="x">hi</div>;', 'f.tsx');
                expect(out).toContain('<div');
            });

            await it('throws on a fatal parse error', async () => {
                expect(() => format('const ===', 'broken.ts')).toThrow();
            });
        });

        await describe('runOxfmt() — full in-process CLI', async () => {
            await it('--write formats a file in place and exits 0', async () => {
                const dir = tmpdir('oxfmt-int-write');
                const file = `${dir}/in.ts`;
                writeFile(file, 'const   x:number=1');
                expect(runOxfmt(['--write', file])).toBe(0);
                expect(readFile(file)).toBe('const x: number = 1;\n');
            });

            await it('--list-different exits 1 on drift, --check exits 0 when clean', async () => {
                const dir = tmpdir('oxfmt-int-check');
                const file = `${dir}/in.ts`;
                writeFile(file, 'const   y:string="a"');
                expect(runOxfmt(['--list-different', file])).toBe(1);
                expect(runOxfmt(['--write', file])).toBe(0);
                expect(runOxfmt(['--check', file])).toBe(0);
            });

            await it('honors .oxfmtrc.json via --config (4-space indent, single quotes)', async () => {
                const dir = tmpdir('oxfmt-int-config');
                const config = `${dir}/.oxfmtrc.json`;
                const file = `${dir}/in.ts`;
                writeFile(config, JSON.stringify({ useTabs: false, tabWidth: 4, singleQuote: true }));
                writeFile(file, 'function f(){return "x"}\n');
                expect(runOxfmt(['--write', '--config', config, file])).toBe(0);
                // 4-space body indent + double→single quote conversion prove
                // the config reached oxfmt's resolver (defaults are 2-space +
                // keep-double).
                expect(readFile(file)).toBe("function f() {\n    return 'x';\n}\n");
            });

            await it('exits 2 when no files match', async () => {
                const dir = tmpdir('oxfmt-int-nofiles');
                expect(runOxfmt(['--check', `${dir}/does-not-exist.ts`])).toBe(2);
            });
        });
    });
};
