// Phase D-2.B regression coverage for @gjsify/rolldown-native.
//
// Each `it()` block was previously a one-off `gjs -m /tmp/...` smoke
// script; this file turns them into permanent regression guards
// against the Vala/Rust prebuild + the TS facade. GJS-only because
// the native bridge needs the GjsifyRolldown typelib.

import { describe, expect, it, on } from '@gjsify/unit';
import GLib from 'gi://GLib?version=2.0';
import { bundleWithPlugins, type NativePlugin } from '@gjsify/rolldown-native';

function tmpdir(prefix: string): string {
    const dir = `/tmp/${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    GLib.mkdir_with_parents(dir, 0o755);
    return dir;
}

function writeFile(path: string, contents: string): void {
    GLib.file_set_contents(path, contents);
}

export default async () => {
    await on('Gjs', async () => {
        await describe('bundleWithPlugins() — B.5a facade', async () => {
            await it('runs all 12 hook positions on a single multi-hook plugin (B.2)', async () => {
                const dir = tmpdir('rdn-int-b2');
                writeFile(`${dir}/main.mjs`, 'import {x} from "virtual:foo";\nexport const y = x + 1;');

                const calls: Record<string, number> = {};
                const bump = (h: string): void => { calls[h] = (calls[h] ?? 0) + 1; };

                const plugin: NativePlugin = {
                    name: 'multi-hook',
                    resolveId(specifier) {
                        bump('resolveId');
                        if (specifier === 'virtual:foo') return '\0virtual:foo';
                        return null;
                    },
                    load(id) {
                        bump('load');
                        if (id === '\0virtual:foo') return 'export const x = 41;';
                        return null;
                    },
                    transform() { bump('transform'); return null; },
                    renderChunk(code) { bump('renderChunk'); return '/* renderChunk-prefix */\n' + code; },
                    banner() { bump('banner'); return '// banner-line'; },
                    footer() { bump('footer'); return '// footer-line'; },
                    intro() { bump('intro'); return null; },
                    outro() { bump('outro'); return null; },
                    buildStart() { bump('buildStart'); },
                    buildEnd() { bump('buildEnd'); },
                    generateBundle() { bump('generateBundle'); },
                };

                const result = await bundleWithPlugins(
                    {
                        input: [{ name: 'main', import: `${dir}/main.mjs` }],
                        cwd: dir,
                        format: 'esm',
                    },
                    [plugin],
                );

                expect(calls.buildStart).toBe(1);
                expect(calls.buildEnd).toBe(1);
                expect(calls.generateBundle).toBe(1);
                expect(calls.banner).toBe(1);
                expect(calls.footer).toBe(1);
                expect(calls.renderChunk).toBe(1);
                expect((calls.resolveId ?? 0) >= 1).toBe(true);
                expect((calls.load ?? 0) >= 1).toBe(true);
                expect((calls.transform ?? 0) >= 1).toBe(true);

                expect(result.output.length).toBe(1);
                const chunk = result.output[0];
                if (chunk.type !== 'chunk') throw new Error('expected chunk output');
                expect(chunk.code.includes('/* renderChunk-prefix */')).toBe(true);
                expect(chunk.code.includes('// banner-line')).toBe(true);
                expect(chunk.code.includes('// footer-line')).toBe(true);
                expect(chunk.code.includes('const y = 42')).toBe(true);
            });

            await it('idFilter.load short-circuits non-matching ids (B.2)', async () => {
                const dir = tmpdir('rdn-int-b2filter');
                writeFile(`${dir}/main.mjs`, 'import a from "./a.mjs";\nimport b from "./b.txt";\nexport const v = a + b.length;');
                writeFile(`${dir}/a.mjs`, 'export default 41;');
                writeFile(`${dir}/b.txt`, 'hello');

                const txtCalls: string[] = [];
                const noFilterCalls: string[] = [];

                const txtOnly: NativePlugin = {
                    name: 'txt-only',
                    idFilter: { load: '\\.txt$' },
                    load(id) {
                        txtCalls.push(id);
                        if (id.endsWith('.txt')) return 'export default "hello";';
                        return null;
                    },
                };
                const noFilter: NativePlugin = {
                    name: 'no-filter',
                    load(id) { noFilterCalls.push(id); return null; },
                };

                await bundleWithPlugins(
                    {
                        input: [{ name: 'main', import: `${dir}/main.mjs` }],
                        cwd: dir,
                        format: 'esm',
                    },
                    [txtOnly, noFilter],
                );

                // Filter plugin must only see ids that match its regex.
                expect(txtCalls.every((id) => id.endsWith('.txt'))).toBe(true);
                expect(txtCalls.length >= 1).toBe(true);
                // Non-filter plugin must see strictly more ids
                // (it sees the .mjs files the filter plugin's load
                // never reaches; it does NOT see .txt because the
                // filter plugin's ok-response short-circuits the
                // chain for that id).
                expect(noFilterCalls.length >= 2).toBe(true);
                expect(noFilterCalls.some((id) => id.endsWith('.mjs'))).toBe(true);
            });

            await it('this.resolve() re-enters the resolver pipeline (B.3)', async () => {
                const dir = tmpdir('rdn-int-b3');
                writeFile(`${dir}/main.mjs`, 'import {x} from "./other.mjs";\nexport const y = x + 1;');
                writeFile(`${dir}/other.mjs`, 'export const x = 41;');

                let observedResolved: { id: string; external: boolean } | null = null;

                const probe: NativePlugin = {
                    name: 'ctx-resolve-probe',
                    async load(id) {
                        if (id.endsWith('main.mjs')) {
                            observedResolved = await this.resolve('./other.mjs', id, { skipSelf: true });
                            this.warn('probe load saw main');
                        }
                        return null;
                    },
                };

                const result = await bundleWithPlugins(
                    {
                        input: [{ name: 'main', import: `${dir}/main.mjs` }],
                        cwd: dir,
                        format: 'esm',
                    },
                    [probe],
                );

                expect(observedResolved !== null).toBe(true);
                expect((observedResolved as unknown as { id: string }).id.endsWith('other.mjs')).toBe(true);
                expect(result.warnings.includes('probe load saw main')).toBe(true);
            });

            await it('this.resolve() from one plugin triggers another plugin\'s resolveId (B.3 re-entrancy)', async () => {
                const dir = tmpdir('rdn-int-b3re');
                writeFile(`${dir}/main.mjs`, 'export const v = 1;');
                writeFile(`${dir}/aliased.mjs`, 'export const a = 99;');

                let aliasFires = 0;
                let observed: { id: string; external: boolean } | null = null;

                const alias: NativePlugin = {
                    name: 'alias',
                    resolveId(specifier) {
                        aliasFires++;
                        if (specifier === '@alias/foo') return `${dir}/aliased.mjs`;
                        return null;
                    },
                };
                const probe: NativePlugin = {
                    name: 'ctx-resolve-probe',
                    async load(id) {
                        if (id.endsWith('main.mjs')) {
                            observed = await this.resolve('@alias/foo', id, { skipSelf: true });
                        }
                        return null;
                    },
                };

                await bundleWithPlugins(
                    {
                        input: [{ name: 'main', import: `${dir}/main.mjs` }],
                        cwd: dir,
                        format: 'esm',
                    },
                    [alias, probe],
                );

                expect(aliasFires >= 1).toBe(true);
                expect(observed !== null).toBe(true);
                expect((observed as unknown as { id: string }).id.endsWith('aliased.mjs')).toBe(true);
            });

            await it('this.error() throws in the JS handler (B.3 — JS-side invariant)', async () => {
                // `this.error(msg)` is a pure JS throw — the facade
                // catches it in its dispatch boundary and forwards as a
                // `kind:'error'` response. Whether rolldown then aborts
                // the build or downgrades to a warning depends on
                // hook-specific severity, so we test the invariant we
                // own: the throw fires synchronously in user-land.
                const dir = tmpdir('rdn-int-b3err');
                writeFile(`${dir}/main.mjs`, 'export const v = 1;');

                let observedThrow: Error | null = null;
                const angry: NativePlugin = {
                    name: 'angry',
                    load(id) {
                        if (id.endsWith('main.mjs')) {
                            try {
                                this.error('intentional failure for B.3 error path');
                            } catch (e) {
                                observedThrow = e as Error;
                                throw e;
                            }
                        }
                        return null;
                    },
                };

                try {
                    await bundleWithPlugins(
                        {
                            input: [{ name: 'main', import: `${dir}/main.mjs` }],
                            cwd: dir,
                            format: 'esm',
                        },
                        [angry],
                    );
                } catch {
                    // Either resolution is acceptable for this test —
                    // the assertion below targets the JS-side throw.
                }

                expect(observedThrow !== null).toBe(true);
                expect((observedThrow as unknown as Error).message.includes('intentional failure')).toBe(true);
            });

            await it('rolldown-shaped {filter, handler} hooks dispatch correctly via toNativePlugin', async () => {
                // Mirrors how the CLI wire-up (B.5b) translates rolldown's
                // {filter:{id:/regex/}, handler} hook form into our
                // NativePlugin idFilter — exercised here directly through
                // bundleWithPlugins to keep the regression guard close
                // to the FFI layer.
                const dir = tmpdir('rdn-int-b5a');
                writeFile(`${dir}/main.mjs`, 'import t from "./inline.txt";\nexport const v = t.length;');
                writeFile(`${dir}/inline.txt`, 'hi');

                const seen: string[] = [];
                const txt: NativePlugin = {
                    name: 'txt',
                    idFilter: { load: /\.txt$/.source },
                    load(id) {
                        seen.push(id);
                        return 'export default "hi";';
                    },
                };

                const result = await bundleWithPlugins(
                    {
                        input: [{ name: 'main', import: `${dir}/main.mjs` }],
                        cwd: dir,
                        format: 'esm',
                    },
                    [txt],
                );
                expect(seen.length).toBe(1);
                expect(seen[0].endsWith('inline.txt')).toBe(true);
                const chunk = result.output[0];
                if (chunk.type !== 'chunk') throw new Error('expected chunk');
                // 'hi'.length === 2 → 'const v = 2'
                expect(chunk.code.includes('const v = 2')).toBe(true);
            });

            await it('transform hook ships code via zero-copy bytes payload (B.4)', async () => {
                // Verifies the B.4 wire change: transform's `code`
                // travels out-of-band as a GLib.Bytes payload via the
                // session's request/response payload slots, not as a
                // JSON-escaped string in the envelope.
                //
                // From the user-handler's POV nothing changes — it
                // still receives a `code: string` arg and returns
                // `{code: <new string>}`. We verify only the
                // observable behavior (the transform RAN, modified
                // the code, and the change shows up in the bundle).
                const dir = tmpdir('rdn-int-b4');
                writeFile(`${dir}/main.mjs`, 'export const X = "ORIGINAL";');

                let observedReceived: string | null = null;
                const upper: NativePlugin = {
                    name: 'b4-uppercase',
                    transform(code, id, _moduleType) {
                        if (id.endsWith('main.mjs')) {
                            observedReceived = code;
                            return { code: code.replace('ORIGINAL', 'TRANSFORMED') };
                        }
                        return null;
                    },
                };

                const result = await bundleWithPlugins(
                    {
                        input: [{ name: 'main', import: `${dir}/main.mjs` }],
                        cwd: dir,
                        format: 'esm',
                    },
                    [upper],
                );

                // The handler received the original source (proves the
                // request-payload bytes path delivered the right code).
                expect(observedReceived !== null).toBe(true);
                expect((observedReceived as unknown as string).includes('"ORIGINAL"')).toBe(true);

                const chunk = result.output[0];
                if (chunk.type !== 'chunk') throw new Error('expected chunk');
                // The output reflects the transformed code (proves the
                // response-payload bytes path delivered the new code
                // back to rolldown).
                expect(chunk.code.includes('TRANSFORMED')).toBe(true);
                expect(chunk.code.includes('ORIGINAL')).toBe(false);
            });

            await it('transform hook returning null skips cleanly (no payload bytes stashed)', async () => {
                // Edge case: when the user handler returns null, the
                // B.4 path must NOT stash response-payload bytes; the
                // response just carries `kind:'skip'`. Verifies the
                // payload-slot lifecycle stays balanced.
                const dir = tmpdir('rdn-int-b4-skip');
                writeFile(`${dir}/main.mjs`, 'export const Y = 7;');

                let callCount = 0;
                const noop: NativePlugin = {
                    name: 'b4-skip',
                    transform() { callCount++; return null; },
                };

                const result = await bundleWithPlugins(
                    {
                        input: [{ name: 'main', import: `${dir}/main.mjs` }],
                        cwd: dir,
                        format: 'esm',
                    },
                    [noop],
                );

                expect(callCount >= 1).toBe(true);
                const chunk = result.output[0];
                if (chunk.type !== 'chunk') throw new Error('expected chunk');
                // Source survives the no-op transform.
                expect(chunk.code.includes('const Y = 7')).toBe(true);
            });

            await it('real-file load hook + idFilter inlines a CSS source as a JS string (mirrors cssAsStringPlugin behavior)', async () => {
                // End-to-end check that the native plugin bridge can drive
                // a file-backed `load`-hook transformation under GJS — the
                // same shape `cssAsStringPlugin` uses to turn
                // `import css from './app.css'` into a JS string default
                // export for Gtk.CssProvider.load_from_string.
                //
                // Reads the CSS via GLib.file_get_contents (GJS-native fs
                // — no Node polyfills involved), wraps the source as a
                // JSON-stringified default export, and asserts the bundled
                // chunk contains the original selector. Verifies:
                //   1. idFilter.load short-circuits non-CSS modules
                //   2. The load hook receives the right id
                //   3. Returning {code: <generated JS>} ends up in the bundle
                //   4. The whole flow works against real files on disk
                //      (not just synthetic strings emitted from the plugin)

                const dir = tmpdir('rdn-int-css-fixture');
                writeFile(`${dir}/main.mjs`, 'import css from "./app.css";\nexport const length = css.length;');
                writeFile(`${dir}/app.css`, '.btn { color: red; }\n.btn:hover { color: blue; }\n');

                const loadCalls: string[] = [];

                const cssAsString: NativePlugin = {
                    name: 'css-as-string-fixture',
                    idFilter: { load: '\\.css$' },
                    load(id) {
                        loadCalls.push(id);
                        const [ok, bytes] = GLib.file_get_contents(id);
                        if (!ok) {
                            this.error(`css fixture: could not read ${id}`);
                        }
                        // Rolldown removed its experimental CSS bundling
                        // and now rejects any `.css` module unless the
                        // load hook claims it AND tags the output as JS.
                        // Mirrors the real cssAsStringPlugin's
                        // `moduleType: 'js'` return.
                        const text = new (globalThis as unknown as { TextDecoder: new () => { decode(b: Uint8Array): string } }).TextDecoder().decode(bytes);
                        return {
                            code: `export default ${JSON.stringify(text)};`,
                            moduleType: 'js',
                        };
                    },
                };

                const result = await bundleWithPlugins(
                    {
                        input: [{ name: 'main', import: `${dir}/main.mjs` }],
                        cwd: dir,
                        format: 'esm',
                    },
                    [cssAsString],
                );

                // Filter must have steered the load hook to exactly the CSS file.
                expect(loadCalls.length).toBe(1);
                expect(loadCalls[0].endsWith('app.css')).toBe(true);

                const chunk = result.output[0];
                if (chunk.type !== 'chunk') throw new Error('expected chunk');

                // Rolldown tree-shakes the dead string body but
                // constant-folds `css.length` from the synthesized JS
                // module. The CSS file is exactly 49 bytes — finding
                // that constant inlined in the bundle proves the full
                // chain worked: idFilter routed → load hook fired →
                // returned `code: 'export default "<49-char string>";'`
                // with `moduleType: 'js'` → rolldown parsed + inlined.
                expect(chunk.code.includes('const length = 49')).toBe(true);
            });
        });
    });
};
