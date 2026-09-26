// `--app node` and Node-API addon packages: an addon finds its `.node` relative to its
// OWN files, so a bundled copy looked beside the bundle instead.
// `@signalapp/libsignal-client`'s `node-gyp-build(import.meta.dirname + '/..')` threw
// "No native build was found" from an `--app node` bundle that ran fine as source.
//
// The fixture is shaped like that package, with a stub `node-gyp-build` that READS the
// prebuild instead of dlopen-ing it: the question is WHERE the lookup lands, and a text
// "binary" answers it on every host, including those no real prebuild exists for.

import { describe, expect, it } from '@gjsify/unit';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rolldown } from 'rolldown';

import { nodeBinary } from './utils/run-node.js';

import { gjsifyPlugin, isNodeAddonPackage, packageNameOf, rewriteContents } from '@gjsify/rolldown-plugin-gjsify';

function write(file: string, content: string): void {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
}

/** A project whose `node_modules/esm-addon` loads its prebuild the libsignal way. */
function addonProject(): string {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-node-native-'));
    write(join(root, 'package.json'), JSON.stringify({ name: 'app', private: true, type: 'module' }));
    write(join(root, 'src', 'index.mjs'), "import binding from 'esm-addon';\nconsole.log('BINDING=' + binding);\n");
    const addon = join(root, 'node_modules', 'esm-addon');
    write(
        join(addon, 'package.json'),
        JSON.stringify({
            name: 'esm-addon',
            version: '1.0.0',
            type: 'module',
            exports: './dist/index.js',
            dependencies: { 'node-gyp-build': '^4.8.0' },
        }),
    );
    write(
        join(addon, 'dist', 'index.js'),
        "import load from 'node-gyp-build';\nexport default load(import.meta.dirname + '/..');\n",
    );
    write(join(addon, 'prebuilds', `${process.platform}-${process.arch}`, 'esm-addon.node'), 'NATIVE-OK');
    const loader = join(root, 'node_modules', 'node-gyp-build');
    write(join(loader, 'package.json'), JSON.stringify({ name: 'node-gyp-build', version: '4.8.4', main: 'index.js' }));
    write(
        join(loader, 'index.js'),
        "var fs = require('fs'), path = require('path');\n" +
            'module.exports = function load(dir) {\n' +
            "  var d = path.join(dir, 'prebuilds', process.platform + '-' + process.arch);\n" +
            "  var f = fs.existsSync(d) && fs.readdirSync(d).find(function (n) { return n.endsWith('.node'); });\n" +
            "  if (!f) throw new Error('No native build was found for ' + dir);\n" +
            "  return fs.readFileSync(path.join(d, f), 'utf8');\n" +
            '};\n',
    );
    return root;
}

async function bundleForNode(root: string): Promise<string> {
    const entry = join(root, 'src', 'index.mjs');
    const outFile = join(root, 'dist', 'app.mjs');
    const cfg = await gjsifyPlugin({ input: entry, output: { file: outFile } }, { app: 'node' });
    const bundle = await rolldown({ ...cfg.options, input: entry, plugins: [...cfg.prePlugins, ...cfg.plugins] });
    await bundle.write({ ...cfg.options.output, file: outFile, format: 'esm' });
    return outFile;
}

function fixturePackage(pkg: Record<string, unknown>, files: Record<string, string> = {}): string {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-addon-pkg-'));
    write(join(root, 'package.json'), JSON.stringify({ name: 'fixture', ...pkg }));
    for (const [name, content] of Object.entries(files)) write(join(root, name), content);
    return root;
}

export default async () => {
    await describe('--app node: a native addon loads from its own package', async () => {
        await it('keeps the addon package external and finds its prebuild', async () => {
            const root = addonProject();
            try {
                const outFile = await bundleForNode(root);
                const run = spawnSync(nodeBinary(), [outFile], { encoding: 'utf8' });
                expect(`${run.stdout}${run.stderr}`.trim()).toBe('BINDING=NATIVE-OK');
                expect(run.status).toBe(0);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });

    await describe('isNodeAddonPackage', async () => {
        const cases: [string, Record<string, unknown>, Record<string, string>, boolean][] = [
            ['gypfile', { gypfile: true }, {}, true],
            ['binding.gyp', {}, { 'binding.gyp': '{}' }, true],
            ['node-pre-gyp binary block', { binary: { module_name: 'x' } }, {}, true],
            ['node-gyp-build dependency', { dependencies: { 'node-gyp-build': '^4' } }, {}, true],
            ['prebuild-install dependency', { dependencies: { 'prebuild-install': '^7' } }, {}, true],
            ['napi-rs config', { napi: { binaryName: 'x' } }, {}, true],
            ['a .node under prebuilds/', {}, { 'prebuilds/linux-x64/x.node': '' }, true],
            ['a .node under build/Release/', {}, { 'build/Release/x.node': '' }, true],
            ['plain JS package', { dependencies: { debug: '^4' } }, { 'index.js': '' }, false],
            ['gjsify GI bridge', { gjsify: { platforms: ['linux-x64'] } }, { 'prebuilds/linux-x64/x.node': '' }, false],
        ];
        for (const [label, pkg, files, want] of cases) {
            await it(`${label} → ${want}`, async () => {
                const root = fixturePackage(pkg, files);
                try {
                    expect(isNodeAddonPackage(root, { name: 'fixture', ...pkg })).toBe(want);
                } finally {
                    rmSync(root, { recursive: true, force: true });
                }
            });
        }
    });

    await describe('packageNameOf', async () => {
        await it('names bare and scoped packages, rejects the rest', async () => {
            expect(packageNameOf('@signalapp/libsignal-client/dist/x')).toBe('@signalapp/libsignal-client');
            expect(packageNameOf('bufferutil')).toBe('bufferutil');
            expect(packageNameOf('node:fs')).toBe(null);
            expect(packageNameOf('./local')).toBe(null);
            expect(packageNameOf('\0virtual')).toBe(null);
        });
    });

    // The rewriter is the other half: a bundled package that reads files next to itself.
    await describe('rewriteContents: import.meta.dirname / import.meta.filename', async () => {
        await it('routes both through the package location, never the bundle', async () => {
            const path = '/proj/node_modules/pkg/dist/index.js';
            const src = 'const d = import.meta.dirname;\nconst f = import.meta.filename;\nexport { d, f };\n';
            const out = rewriteContents({ path }, src, '/proj/dist', false);
            expect(out === null).toBe(false);
            const code = out?.code ?? '';
            expect(code.includes('import.meta.dirname')).toBe(false);
            expect(code.includes('import.meta.filename')).toBe(false);
            expect(code.includes('var __dirname = new URL("../node_modules/pkg/dist/", import.meta.url)')).toBe(true);
            expect(
                code.includes('var __filename = new URL("../node_modules/pkg/dist/index.js", import.meta.url)'),
            ).toBe(true);
        });
    });
};
