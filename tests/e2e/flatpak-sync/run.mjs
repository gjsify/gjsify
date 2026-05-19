// E2E test for `gjsify flatpak sync-flathub`.
//
// Strategy: invoke the locally built CLI (`packages/infra/cli/lib/index.js`)
// under Node so the test does not depend on a packed-workspace install. This
// also sidesteps any GJS-runtime regressions in unrelated polyfills since
// sync-flathub is a pure CLI command that only shells out to `git` + `gh`.
//
// Test environment per case:
//   - synthetic project dir with `package.json#gjsify.flatpak.appId`
//   - stubbed `git` shim that fakes clone (copies a fixture manifest into
//     the simulated clone-dir) and no-ops fetch/checkout/reset/add/commit/push
//   - stubbed `gh` shim that traces invocations
//   - XDG_CACHE_HOME pointed at the tmp dir so the clone-cache stays isolated

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    writeFileSync,
    readFileSync,
    mkdirSync,
    chmodSync,
    existsSync,
    mkdtempSync,
    rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

function runCli(args, opts = {}) {
    return execFileSync('node', [CLI_ENTRY, ...args], {
        stdio: opts.stdio ?? 'pipe',
        timeout: opts.timeout ?? 60 * 1000,
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        encoding: 'utf8',
    });
}

describe('CLI flatpak sync-flathub E2E', { timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-sync-flathub-'));
        if (!existsSync(CLI_ENTRY)) {
            throw new Error(`CLI entry not built: ${CLI_ENTRY} — run \`yarn workspace @gjsify/cli build\` first`);
        }
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('--dry-run resolves but writes nothing', () => {
        const projectDir = join(tmpDir, 'dry');
        scaffoldProject(projectDir, { appId: 'org.example.SyncDry' });

        const out = runCli([
            'flatpak', 'sync-flathub',
            '--version', 'v0.6.6',
            '--commit', 'deadbeef0000000000000000000000000000aaaa',
            '--dry-run',
        ], { cwd: projectDir });

        assert.match(out, /appId=org\.example\.SyncDry/);
        assert.match(out, /flathubRepo=flathub\/org\.example\.SyncDry/);
        assert.match(out, /version=v0\.6\.6/);
        assert.match(out, /commit=deadbeef0000000000000000000000000000aaaa/);
        assert.match(out, /branch=update-to-0\.6\.6/);
        assert.match(out, /--dry-run set/);
    });

    it('patches manifest, commits locally (--no-pr skips push + gh)', () => {
        const projectDir = join(tmpDir, 'real');
        scaffoldProject(projectDir, { appId: 'org.example.SyncReal' });

        const fixtureDir = join(tmpDir, 'fixture-real');
        mkdirSync(fixtureDir, { recursive: true });
        writeFileSync(
            join(fixtureDir, 'org.example.SyncReal.json'),
            JSON.stringify({
                id: 'org.example.SyncReal',
                runtime: 'org.gnome.Platform',
                'runtime-version': '50',
                sdk: 'org.gnome.Sdk',
                command: 'syncreal',
                modules: [{
                    name: 'syncreal',
                    sources: [{
                        type: 'git',
                        url: 'https://github.com/example/syncreal.git',
                        tag: 'v0.6.5',
                        commit: '0000000000000000000000000000000000000000',
                    }],
                }],
            }, null, 2) + '\n',
            'utf-8',
        );

        const stubDir = join(tmpDir, 'stub-real');
        mkdirSync(stubDir, { recursive: true });
        writeGitStub(stubDir, fixtureDir);
        writeShim(stubDir, 'gh', 'GH_CALLS');

        const xdgCache = join(tmpDir, 'xdg-real');
        mkdirSync(xdgCache, { recursive: true });

        runCli([
            'flatpak', 'sync-flathub',
            '--version', 'v0.6.6',
            '--commit', 'deadbeef0000000000000000000000000000aaaa',
            '--no-pr',
            '--verbose',
        ], {
            cwd: projectDir,
            env: {
                ...process.env,
                PATH: `${stubDir}:${process.env.PATH ?? ''}`,
                XDG_CACHE_HOME: xdgCache,
            },
        });

        const cloneDir = join(xdgCache, 'gjsify', 'flathub-sync', 'flathub__org.example.SyncReal');
        const patchedPath = join(cloneDir, 'org.example.SyncReal.json');
        assert.ok(existsSync(patchedPath), 'manifest missing in clone dir');

        const patched = JSON.parse(readFileSync(patchedPath, 'utf-8'));
        const source = patched.modules[0].sources[0];
        assert.equal(source.tag, 'v0.6.6');
        assert.equal(source.commit, 'deadbeef0000000000000000000000000000aaaa');
        assert.ok(source['x-checker-data'], 'x-checker-data injected');
        assert.equal(source['x-checker-data'].type, 'git');
        assert.match(source['x-checker-data']['tag-pattern'], /\^v/);

        // 2-space indent preserved
        assert.match(readFileSync(patchedPath, 'utf-8'), /^{\n  "id":/);

        const gitCalls = readFileSync(join(stubDir, 'GIT_CALLS'), 'utf-8');
        assert.match(gitCalls, /clone https:\/\/github\.com\/flathub\/org\.example\.SyncReal\.git/);
        assert.match(gitCalls, /commit -m Update to v0\.6\.6/);
        assert.doesNotMatch(gitCalls, /push /, '--no-pr should skip push');

        assert.equal(existsSync(join(stubDir, 'GH_CALLS')), false, '--no-pr should skip gh');
    });

    it('opens PR via gh pr create when --no-pr not set', () => {
        const projectDir = join(tmpDir, 'pr');
        scaffoldProject(projectDir, {
            appId: 'org.example.SyncPr',
            flathubRepo: 'flathub/org.example.SyncPr',
        });

        const fixtureDir = join(tmpDir, 'fixture-pr');
        mkdirSync(fixtureDir, { recursive: true });
        writeFileSync(
            join(fixtureDir, 'org.example.SyncPr.json'),
            JSON.stringify({
                id: 'org.example.SyncPr',
                modules: [{
                    name: 'syncpr',
                    sources: [{
                        type: 'git',
                        url: 'https://github.com/example/syncpr.git',
                        tag: 'v0.5.0',
                        commit: '1111111111111111111111111111111111111111',
                    }],
                }],
            }, null, 2) + '\n',
            'utf-8',
        );

        const stubDir = join(tmpDir, 'stub-pr');
        mkdirSync(stubDir, { recursive: true });
        writeGitStub(stubDir, fixtureDir);
        writeShim(stubDir, 'gh', 'GH_CALLS');

        const xdgCache = join(tmpDir, 'xdg-pr');
        mkdirSync(xdgCache, { recursive: true });

        runCli([
            'flatpak', 'sync-flathub',
            '--version', 'v0.6.0',
            '--commit', 'cafef00d0000000000000000000000000000bbbb',
        ], {
            cwd: projectDir,
            env: {
                ...process.env,
                PATH: `${stubDir}:${process.env.PATH ?? ''}`,
                XDG_CACHE_HOME: xdgCache,
            },
        });

        const ghCalls = readFileSync(join(stubDir, 'GH_CALLS'), 'utf-8').trim();
        assert.match(ghCalls, /pr create --repo flathub\/org\.example\.SyncPr/);
        assert.match(ghCalls, /--head update-to-0\.6\.0/);
        assert.match(ghCalls, /--title Update to v0\.6\.0/);
    });

    it('no-op when manifest already pinned to target version', () => {
        const projectDir = join(tmpDir, 'idem');
        scaffoldProject(projectDir, { appId: 'org.example.SyncIdem' });

        const fixtureDir = join(tmpDir, 'fixture-idem');
        mkdirSync(fixtureDir, { recursive: true });
        writeFileSync(
            join(fixtureDir, 'org.example.SyncIdem.json'),
            JSON.stringify({
                id: 'org.example.SyncIdem',
                modules: [{
                    name: 'syncidem',
                    sources: [{
                        type: 'git',
                        url: 'https://github.com/example/syncidem.git',
                        tag: 'v1.0.0',
                        commit: 'feedfacefeedfacefeedfacefeedfacefeedface',
                        'x-checker-data': {
                            type: 'git',
                            'tag-pattern': '^v(\\d+\\.\\d+\\.\\d+)$',
                            'version-scheme': 'semantic',
                        },
                    }],
                }],
            }, null, 2) + '\n',
            'utf-8',
        );

        const stubDir = join(tmpDir, 'stub-idem');
        mkdirSync(stubDir, { recursive: true });
        writeGitStub(stubDir, fixtureDir);
        writeShim(stubDir, 'gh', 'GH_CALLS');

        const xdgCache = join(tmpDir, 'xdg-idem');
        mkdirSync(xdgCache, { recursive: true });

        const out = runCli([
            'flatpak', 'sync-flathub',
            '--version', 'v1.0.0',
            '--commit', 'feedfacefeedfacefeedfacefeedfacefeedface',
        ], {
            cwd: projectDir,
            env: {
                ...process.env,
                PATH: `${stubDir}:${process.env.PATH ?? ''}`,
                XDG_CACHE_HOME: xdgCache,
            },
        });

        assert.match(out, /already at v1\.0\.0 — nothing to do/);
        assert.equal(existsSync(join(stubDir, 'GH_CALLS')), false, 'gh should not be called on no-op');
    });
});

// ── helpers ─────────────────────────────────────────────────────────────

function scaffoldProject(dir, { appId, flathubRepo }) {
    mkdirSync(dir, { recursive: true });
    const pkg = {
        name: appId,
        version: '1.0.0',
        type: 'module',
        private: true,
        gjsify: {
            flatpak: {
                appId,
                ...(flathubRepo ? { flathubRepo } : {}),
            },
        },
    };
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
}

function writeShim(binDir, name, traceFile, exitCode = 0) {
    const trace = join(binDir, traceFile);
    const script = [
        '#!/bin/sh',
        `echo "$@" >> ${shellQuote(trace)}`,
        `exit ${exitCode}`,
    ].join('\n') + '\n';
    const path = join(binDir, name);
    writeFileSync(path, script, 'utf-8');
    chmodSync(path, 0o755);
}

/**
 * Write a `git` shim for the sync-flathub workflow. On `clone`, copies
 * the fixture directory into the target clone-dir so the manifest is
 * present for the subsequent edit step. Other subcommands are no-op
 * success.
 */
function writeGitStub(binDir, fixtureDir) {
    const trace = join(binDir, 'GIT_CALLS');
    const script = [
        '#!/bin/sh',
        `echo "$@" >> ${shellQuote(trace)}`,
        'case "$1" in',
        '  clone)',
        '    dir="$3"',
        '    mkdir -p "$dir/.git"',
        `    cp -r ${shellQuote(fixtureDir)}/. "$dir/"`,
        '    exit 0 ;;',
        '  remote)',
        '    if [ "$2" = "show" ]; then',
        '      echo "HEAD branch: master"',
        '    fi',
        '    exit 0 ;;',
        '  describe)',
        '    echo "v0.0.0"',
        '    exit 0 ;;',
        '  rev-list)',
        '    echo "0000000000000000000000000000000000000000"',
        '    exit 0 ;;',
        '  fetch|checkout|reset|add|commit|push|config)',
        '    exit 0 ;;',
        '  *)',
        '    exit 0 ;;',
        'esac',
    ].join('\n') + '\n';
    const path = join(binDir, 'git');
    writeFileSync(path, script, 'utf-8');
    chmodSync(path, 0o755);
}

function shellQuote(s) {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}
