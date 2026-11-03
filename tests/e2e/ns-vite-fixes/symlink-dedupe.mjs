// E2E for `@gjsify/nativescript-vite`'s `nativescriptDedupeSymlinks`.
//
// The incident: `@nativescript/vite` sets `resolve.preserveSymlinks: true`, and a workspace
// monorepo carries nested `packages/<x>/node_modules/@gjsify/<y>` symlinks. Every symlink path
// became its own module id, so one package was bundled several times and its module-level
// registry split — `useRealGObjectEngine()` registered in one copy, `adwaita-nativescript` read
// the empty slot of another ("No GObject engine was registered") and the app died at launch.
//
// Held here: a REAL Vite build of a fixture where `singleton` is reachable through two symlink
// paths (the app's own `node_modules` and `lib-b`'s nested one), with upstream's
// `preserveSymlinks: true`. Without the plugin the bundle holds it twice; with it, once.
//
// CI-safe: only `vite`, no `@nativescript/vite`, no NS CLI.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';

const LIB_URL = new URL('../../../packages/infra/nativescript-vite/lib/index.js', import.meta.url);
const { nativescriptDedupeSymlinks } = await import(LIB_URL);

const MARKER = 'SINGLETON_MODULE_BODY';

describe('@gjsify/nativescript-vite nativescriptDedupeSymlinks E2E', () => {
    let root;

    before(() => {
        root = mkdtempSync(join(tmpdir(), 'ns-symlink-dedupe-'));
        const pkg = (dir, name, files) => {
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, type: 'module', main: 'index.js' }));
            for (const [file, body] of Object.entries(files)) writeFileSync(join(dir, file), body);
        };
        // The workspace packages (real paths), as under `packages/`.
        pkg(join(root, 'packages/singleton'), 'singleton', {
            'index.js': `export const registry = { id: '${MARKER}' };\nexport const helper = () => registry;\n`,
            'util.js': `import { registry } from './index.js';\nexport const viaUtil = () => registry;\n`,
        });
        pkg(join(root, 'packages/lib-b'), 'lib-b', {
            'index.js': `import { registry } from 'singleton';\nexport const fromB = () => registry;\n`,
        });
        // Nested symlink: lib-b carries its own `node_modules/singleton`, as a workspace install does.
        mkdirSync(join(root, 'packages/lib-b/node_modules'), { recursive: true });
        symlinkSync('../../singleton', join(root, 'packages/lib-b/node_modules/singleton'), 'dir');
        // The app sees both through its own node_modules.
        mkdirSync(join(root, 'app/node_modules'), { recursive: true });
        symlinkSync('../../packages/singleton', join(root, 'app/node_modules/singleton'), 'dir');
        symlinkSync('../../packages/lib-b', join(root, 'app/node_modules/lib-b'), 'dir');
        writeFileSync(
            join(root, 'app/main.js'),
            `import { registry } from 'singleton';\nimport { viaUtil } from 'singleton/util.js';\nimport { fromB } from 'lib-b';\n` +
                `globalThis.__same = registry === fromB() && registry === viaUtil();\n`,
        );
    });

    after(() => rmSync(root, { recursive: true, force: true }));

    async function bundle(plugins) {
        const out = await build({
            root: join(root, 'app'),
            configFile: false,
            logLevel: 'silent',
            plugins,
            // What `@nativescript/vite` sets.
            resolve: { preserveSymlinks: true },
            build: {
                write: false,
                minify: false,
                rolldownOptions: { input: join(root, 'app/main.js'), output: { format: 'es' } },
            },
        });
        const chunks = (Array.isArray(out) ? out : [out]).flatMap((o) => o.output).filter((c) => c.type === 'chunk');
        return chunks.map((c) => c.code).join('\n');
    }

    const count = (code) => code.split(MARKER).length - 1;

    it('without the plugin, preserveSymlinks bundles the package once per symlink path (the bug)', async () => {
        assert.equal(count(await bundle([])), 2);
    });

    it('with the plugin, the package is bundled exactly once', async () => {
        assert.equal(count(await bundle([nativescriptDedupeSymlinks()])), 1);
    });
});
