// E2E test for `gjsify.ship.nodeModules` on a GJS payload — issue #2439.
//
// WHAT THIS CLOSES. The declaration used to apply to `--app node` only, on the argument that a GJS
// bundle inlines or rewrites its imports. It does not rewrite the one thing that matters here: a
// Node-API addon. `@gjsify/napi` finds the `.node` file at run time relative to the BUNDLE (ADR
// 0084), so a GJS app that loads one needs the package's directory in a `node_modules/` beside the
// bundle — and `ship` staged nothing there, so the packaged app failed where the dev tree, which
// has `node_modules`, worked. Found by Stamped's semantic search (node-llama-cpp), which loaded
// from a checkout and not from the `.deb`.
//
// The fixture is a synthetic addon package: the closure walk, the platform filter and the exclude
// list are what `ship` owns. That a REAL addon then loads from the staged tree is the consumer's
// measurement (Stamped's embedder integration test, run from the stage with its checkout hidden).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCliSync } from '../mock-registry.mjs';
import { CLI_ENTRY, listPayload, scaffold } from '../ship/fixture.mjs';

process.env.GJSIFY_GTK_RUNTIME_FETCH = '0';

// `ship` labels the stage with the host architecture unless told otherwise, and the platform
// filter compares against that label — so the per-platform package below is named for the host.
const CPU = process.arch;

/** Install a fake package at `<project>/node_modules/<name>`. */
function install(project, name, manifest, files = {}) {
    const dir = join(project, 'node_modules', ...name.split('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...manifest }));
    for (const [rel, text] of Object.entries(files)) {
        mkdirSync(join(dir, rel, '..'), { recursive: true });
        writeFileSync(join(dir, rel), text);
    }
}

/** A GJS project (the default fixture) declaring `nodeModules`, with the addon installed. */
function scaffoldAddonApp(dir, shipExtras = {}) {
    const project = scaffold(dir, (pkg) => {
        pkg.gjsify.ship.nodeModules = ['fake-addon'];
        Object.assign(pkg.gjsify.ship, shipExtras);
    });
    install(
        project,
        'fake-addon',
        {
            main: 'index.js',
            dependencies: { 'fake-addon-helper': '^1' },
            optionalDependencies: {
                [`@fake-addon/linux-${CPU}`]: '1.0.0',
                [`@fake-addon/linux-${CPU}-cuda`]: '1.0.0',
                '@fake-addon/win32-x64': '1.0.0',
            },
        },
        { 'index.js': 'module.exports = {};\n' },
    );
    install(project, 'fake-addon-helper', {}, { 'index.js': 'module.exports = {};\n' });
    install(
        project,
        `@fake-addon/linux-${CPU}`,
        { os: ['linux'], cpu: [CPU] },
        { [`bins/linux-${CPU}/addon.node`]: 'not a real addon\n' },
    );
    install(
        project,
        `@fake-addon/linux-${CPU}-cuda`,
        { os: ['linux'], cpu: [CPU] },
        { [`bins/linux-${CPU}-cuda/addon.node`]: 'not a real addon\n' },
    );
    return project;
}

describe('CLI ship E2E — nodeModules on a GJS payload', { timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;

    before(() => {
        if (!existsSync(CLI_ENTRY)) throw new Error(`CLI entry not built: ${CLI_ENTRY}`);
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ship-node-modules-'));
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(tmpDir, { recursive: true, force: true });
    });

    const stageOf = (project) => {
        runCliSync(CLI_ENTRY, ['ship', '--skip-build', '--stage'], { cwd: project });
        return listPayload(join(project, 'ship', 'stage'));
    };

    it('stages the addon package beside the GJS bundle, with its closure', () => {
        const staged = stageOf(scaffoldAddonApp(join(tmpDir, 'carried')));
        const under = (rel) => `lib/ship-demo/node_modules/${rel}`;

        // Beside the bundle, which is where `@gjsify/napi` resolves from.
        assert.ok(staged.includes('lib/ship-demo/gjs.js'));
        assert.ok(staged.includes(under('fake-addon/package.json')));
        assert.ok(staged.includes(under('fake-addon/index.js')));
        assert.ok(staged.includes(under('fake-addon-helper/package.json')));
        // The host's prebuilt addon, the file the loader is actually after.
        assert.ok(staged.includes(under(`@fake-addon/linux-${CPU}/bins/linux-${CPU}/addon.node`)));
    });

    it('leaves out another platform’s build', () => {
        const staged = stageOf(scaffoldAddonApp(join(tmpDir, 'platform')));
        // The package IS carried; only the build for a platform this stage is not for is not.
        assert.ok(staged.includes('lib/ship-demo/node_modules/fake-addon/package.json'));
        assert.equal(
            staged.some((rel) => rel.includes('win32-x64')),
            false,
        );
    });

    it('honours nodeModulesExclude for a GJS payload', () => {
        const staged = stageOf(
            scaffoldAddonApp(join(tmpDir, 'excluded'), { nodeModulesExclude: [`@fake-addon/linux-${CPU}-cuda`] }),
        );
        assert.ok(staged.some((rel) => rel.includes(`@fake-addon/linux-${CPU}/`)));
        assert.equal(
            staged.some((rel) => rel.includes('-cuda')),
            false,
        );
    });

    it('stages no node_modules when none is declared', () => {
        const project = scaffold(join(tmpDir, 'undeclared'));
        const staged = stageOf(project);
        assert.equal(
            staged.some((rel) => rel.includes('node_modules/')),
            false,
        );
    });
});
