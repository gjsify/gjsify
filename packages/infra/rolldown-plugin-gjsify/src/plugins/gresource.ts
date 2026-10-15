// `import bytes from './data/<app-id>.data.gresource.xml'` (ADR 0116 §§ 1–2): the app's compiled
// GResource as a `Uint8Array` default export, for `Gio.Resource.new_from_data(bytes)`.
//
// The `.gresource.xml` stays the single source and `glib-compile-resources` stays the compiler, so
// the embedded bytes are the bytes GNOME loads; base64 is only the transport through a one-file
// bundle, as in `adwaita-app/scripts/build-icon-gresource.mjs`. ADR 0116 decides the host tool over
// an in-JS GVDB writer ("What this does not decide": a JS replacement for glib-compile-resources).
//
// § 2 per file: `prefix`, `alias`, nested and `../` paths, `xml-stripblanks`, `json-stripblanks` go
// through unchanged. `compressed="true"` is dropped for the browser and NativeScript (`strip`),
// because those targets have no synchronous inflate; GIO answers `lookup_data` and `get_info` with
// the same data either way. `preprocess="to-pixdata"` is refused, naming the file and line.
//
// The decoder is emitted inline instead of calling `atob`/`Uint8Array.fromBase64`: GJS has neither
// global without an injected register, and the module must evaluate the same on all four targets.

import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import type { Plugin } from 'rolldown';

const execFileAsync = promisify(execFile);

export const GRESOURCE_PLUGIN = 'gjsify-gresource';

const SUFFIX = /\.gresource\.xml$/;
const TOOL = 'glib-compile-resources';

export interface GresourcePluginOptions {
    /**
     * `keep`: compile the XML as written (GJS, Node — real GIO inflates).
     * `strip`: drop `compressed="true"` first (browser, NativeScript, ADR 0116 § 2).
     */
    compressed: 'keep' | 'strip';
}

function lineOf(xml: string, index: number): number {
    return xml.slice(0, index).split('\n').length;
}

function attr(tag: string, name: string): string | undefined {
    return new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`)
        .exec(tag)
        ?.slice(1)
        .find((v) => v !== undefined);
}

/**
 * Apply the § 2 rules to the descriptor's text. Returns the XML to compile; throws on a refused
 * option. Comments are blanked first so a commented-out `<file>` neither refuses nor rewrites.
 */
export function prepareGresourceXml(xml: string, file: string, options: GresourcePluginOptions): string {
    const source = xml.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
    for (const m of source.matchAll(/<file\b([^>]*)>([\s\S]*?)<\/file>/g)) {
        const preprocess = (attr(m[1], 'preprocess') ?? '').split(',').map((p) => p.trim());
        if (preprocess.includes('to-pixdata')) {
            throw new Error(
                `${file}:${lineOf(source, m.index!)}: '${m[2].trim()}' uses preprocess="to-pixdata", which GLib ` +
                    'deprecated and the web and NativeScript cannot decode; ship the PNG as it is (ADR 0116 § 2)',
            );
        }
    }
    if (options.compressed === 'keep') return xml;
    let out = '';
    let last = 0;
    for (const m of source.matchAll(/<file\b[^>]*>/g)) {
        out += xml.slice(last, m.index!);
        out += xml.slice(m.index!, m.index! + m[0].length).replace(/\scompressed\s*=\s*(?:"[^"]*"|'[^']*')/, '');
        last = m.index! + m[0].length;
    }
    return out + xml.slice(last);
}

async function compileResources(args: string[]): Promise<string> {
    try {
        const { stdout } = await execFileAsync(TOOL, args, { maxBuffer: 64 * 1024 * 1024 });
        return stdout;
    } catch (err: unknown) {
        const e = err as { code?: unknown; stderr?: string | Buffer };
        if (e?.code === 'ENOENT') {
            throw new Error(
                `${TOOL} not found; embedding a .gresource.xml needs it on the build host for every target ` +
                    '(ADR 0116). Install it via your distro (package: glib2-devel / libglib2.0-dev).',
            );
        }
        throw new Error(
            `${TOOL} failed${e?.code !== undefined ? ` (exit ${e.code})` : ''}: ${String(e?.stderr ?? '')}`,
        );
    }
}

/**
 * Compile `xmlPath` as `glib-compile-resources --sourcedir=<its dir>` would, after the § 2 rules.
 * Returns the compiled bytes and every file they were read from.
 */
export async function compileGresource(
    xmlPath: string,
    options: GresourcePluginOptions,
): Promise<{ bytes: Uint8Array; inputs: string[] }> {
    const xml = await readFile(xmlPath, 'utf8');
    const prepared = prepareGresourceXml(xml, xmlPath, options);
    const sourcedir = dirname(xmlPath);
    const tmp = await mkdtemp(join(tmpdir(), 'gjsify-gresource-'));
    try {
        let descriptor = xmlPath;
        if (prepared !== xml) {
            descriptor = join(tmp, 'resources.gresource.xml');
            await writeFile(descriptor, prepared);
        }
        const target = join(tmp, 'resources.gresource');
        const deps = await compileResources([`--sourcedir=${sourcedir}`, '--generate-dependencies', descriptor]);
        await compileResources([`--sourcedir=${sourcedir}`, `--target=${target}`, descriptor]);
        const bytes = new Uint8Array(await readFile(target));
        return { bytes, inputs: deps.split('\n').filter((l) => l !== '') };
    } finally {
        await rm(tmp, { recursive: true, force: true });
    }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** The module source: the bytes as base64 and an inline decoder to a `Uint8Array` default export. */
export function gresourceModuleSource(bytes: Uint8Array): string {
    const b64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
    return [
        `const s = ${JSON.stringify(b64)};`,
        `const a = ${JSON.stringify(B64)};`,
        'const t = new Uint8Array(128);',
        'for (let i = 0; i < 64; i++) t[a.charCodeAt(i)] = i;',
        'const b = new Uint8Array((s.length / 4) * 3 - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0));',
        'for (let i = 0, j = 0; i < s.length; i += 4) {',
        '    const v = (t[s.charCodeAt(i)] << 18) | (t[s.charCodeAt(i + 1)] << 12) | (t[s.charCodeAt(i + 2)] << 6) | t[s.charCodeAt(i + 3)];',
        '    b[j++] = v >> 16;',
        '    if (j < b.length) b[j++] = (v >> 8) & 255;',
        '    if (j < b.length) b[j++] = v & 255;',
        '}',
        'export default b;',
    ].join('\n');
}

export function gresourcePlugin(options: GresourcePluginOptions): Plugin {
    return {
        name: GRESOURCE_PLUGIN,
        async load(id) {
            if (!SUFFIX.test(id)) return null;
            const { bytes, inputs } = await compileGresource(id, options);
            // The native engine's context may predate `addWatchFile`/`info`; a build must not
            // fail over bookkeeping (rolldown-native `NativePluginContext`).
            const ctx = this as { addWatchFile?: (f: string) => void; info?: (m: string) => void };
            for (const f of [id, ...inputs]) ctx.addWatchFile?.(f);
            const code = gresourceModuleSource(bytes);
            ctx.info?.(`${id}: ${bytes.byteLength} B compiled, ${code.length} B embedded (ADR 0116)`);
            return { code, moduleType: 'js' as const };
        },
    };
}
