// E2E for ADR 0001 step 3 — the loud version-conflict warning.
//
// When two workspaces declare INCOMPATIBLE ranges of the same external dep,
// `workspaceInstall` aggregates both as top-level specs and the BFS resolver
// keeps a single hoisted copy at the root — one workspace silently gets a
// version outside its declared range (the real per-workspace dedup pass is
// Phase D.8). Until dedup lands, the resolver must surface the conflict
// loudly with a single greppable line naming the package, every conflicting
// range WITH the workspace that requested it, and the version that won:
//
//   [gjsify] warning: version conflict for dep-x: installed 2.5.0 at
//   node_modules/dep-x — does NOT satisfy ^1.0.0 (requested by @fixture/ws-a); …
//
// COMPATIBLE ranges (^1.2.0 + ^1.4.0 both satisfied by 1.9.0) must stay
// silent — the warning only fires when some requester's range is actually
// violated by the picked version.
//
// The fixture install exercises both shapes at once: `dep-x` conflicts
// (^1.0.0 vs ^2.0.0), `dep-y` agrees (^1.2.0 vs ^1.4.0 → one 1.9.0 copy).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, startMockRegistry } from '../mock-registry.mjs';

const PACKAGES = {
    'dep-x': {
        '1.9.0': { main: 'index.js', dependencies: {}, files: { 'index.js': 'module.exports = "1.9.0";\n' } },
        '2.5.0': { main: 'index.js', dependencies: {}, files: { 'index.js': 'module.exports = "2.5.0";\n' } },
    },
    'dep-y': {
        '1.9.0': { main: 'index.js', dependencies: {}, files: { 'index.js': 'module.exports = "1.9.0";\n' } },
    },
};

function writeWorkspace(root, dirName, manifest) {
    const dir = join(root, 'packages', dirName);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
}

describe('gjsify install — version-conflict warning (ADR 0001 step 3)', { timeout: 120_000 }, () => {
    let registry, root, cliEntry, envForCli, result;

    before(async () => {
        registry = await startMockRegistry(PACKAGES);
        cliEntry = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));

        root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-conflict-warn-'));
        const homeDir = join(root, 'home');
        mkdirSync(homeDir, { recursive: true });
        envForCli = {
            ...process.env,
            GJSIFY_INSTALL_BACKEND: 'native',
            npm_config_registry: registry.url,
            XDG_CACHE_HOME: join(root, 'xdg-cache'),
            HOME: homeDir,
            GJSIFY_NPM_CACHE: '0',
        };

        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify(
                { name: 'conflict-warn-root', version: '0.0.0', private: true, workspaces: ['packages/*'] },
                null,
                2,
            ) + '\n',
        );
        writeFileSync(join(root, '.npmrc'), `registry=${registry.url}\n`);
        // ws-a and ws-b CONFLICT on dep-x (^1 vs ^2 — no version satisfies
        // both) and AGREE on dep-y (^1.2 and ^1.4 are both satisfied by 1.9.0).
        writeWorkspace(root, 'ws-a', {
            name: '@fixture/ws-a',
            version: '0.0.1',
            dependencies: { 'dep-x': '^1.0.0', 'dep-y': '^1.2.0' },
        });
        writeWorkspace(root, 'ws-b', {
            name: '@fixture/ws-b',
            version: '0.0.1',
            dependencies: { 'dep-x': '^2.0.0', 'dep-y': '^1.4.0' },
        });

        result = await runCli(cliEntry, ['install'], { timeoutMs: 60_000, cwd: root, env: envForCli });
    });

    after(async () => {
        await registry?.close();
        if (root) rmSync(root, { recursive: true, force: true });
    });

    it('install succeeds despite the conflict', () => {
        assert.equal(result.status, 0, `install failed:\n${result.stderr}\n${result.stdout}`);
    });

    it('warns once, naming package, both ranges with requesters, and the picked version', () => {
        const lines = result.stderr.split('\n').filter((l) => l.includes('[gjsify] warning: version conflict'));
        assert.equal(
            lines.length,
            1,
            `expected exactly ONE conflict-warning line (single-line-per-package), got:\n${result.stderr}`,
        );
        const line = lines[0];
        assert.match(line, /^\[gjsify\] warning: version conflict for dep-x: /, 'warning must name the package');
        // The version actually installed at the root must be the one the
        // warning reports.
        const installed = JSON.parse(readFileSync(join(root, 'node_modules', 'dep-x', 'package.json'), 'utf-8'));
        assert.ok(
            line.includes(`installed ${installed.version}`),
            `warning must name the picked version ${installed.version}: ${line}`,
        );
        // Both conflicting ranges, each attributed to its requesting workspace.
        assert.ok(line.includes('^1.0.0'), `warning must name the ^1.0.0 range: ${line}`);
        assert.ok(line.includes('^2.0.0'), `warning must name the ^2.0.0 range: ${line}`);
        assert.ok(line.includes('@fixture/ws-a'), `warning must attribute ^1.0.0 to @fixture/ws-a: ${line}`);
        assert.ok(line.includes('@fixture/ws-b'), `warning must attribute ^2.0.0 to @fixture/ws-b: ${line}`);
        // The violated range must be flagged as unsatisfied, next to its requester.
        const loser = installed.version.startsWith('2.')
            ? '^1.0.0 (requested by @fixture/ws-a)'
            : '^2.0.0 (requested by @fixture/ws-b)';
        assert.ok(line.includes(`does NOT satisfy ${loser}`), `warning must flag the violated range ${loser}: ${line}`);
    });

    it('does NOT warn for compatible ranges of the same package', () => {
        assert.ok(
            !result.stderr.includes('version conflict for dep-y'),
            `dep-y ranges agree (one version satisfies both) — no warning expected:\n${result.stderr}`,
        );
        // Sanity: dep-y resolved to the single satisfying version.
        const depY = JSON.parse(readFileSync(join(root, 'node_modules', 'dep-y', 'package.json'), 'utf-8'));
        assert.equal(depY.version, '1.9.0');
    });
});
