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
import { writeFileSync, readFileSync, mkdirSync, chmodSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runCliSync } from '../mock-registry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

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

        const out = runCliSync(
            CLI_ENTRY,
            [
                'flatpak',
                'sync-flathub',
                '--version',
                'v0.6.6',
                '--commit',
                'deadbeef0000000000000000000000000000aaaa',
                '--dry-run',
            ],
            { cwd: projectDir },
        );

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
            JSON.stringify(
                {
                    id: 'org.example.SyncReal',
                    runtime: 'org.gnome.Platform',
                    'runtime-version': '50',
                    sdk: 'org.gnome.Sdk',
                    command: 'syncreal',
                    modules: [
                        {
                            name: 'syncreal',
                            sources: [
                                {
                                    type: 'git',
                                    url: 'https://github.com/example/syncreal.git',
                                    tag: 'v0.6.5',
                                    commit: '0000000000000000000000000000000000000000',
                                },
                            ],
                        },
                    ],
                },
                null,
                2,
            ) + '\n',
            'utf-8',
        );

        const stubDir = join(tmpDir, 'stub-real');
        mkdirSync(stubDir, { recursive: true });
        writeGitStub(stubDir, fixtureDir);
        writeShim(stubDir, 'gh', 'GH_CALLS');

        const xdgCache = join(tmpDir, 'xdg-real');
        mkdirSync(xdgCache, { recursive: true });

        runCliSync(
            CLI_ENTRY,
            [
                'flatpak',
                'sync-flathub',
                '--version',
                'v0.6.6',
                '--commit',
                'deadbeef0000000000000000000000000000aaaa',
                '--no-pr',
                '--verbose',
            ],
            {
                cwd: projectDir,
                env: {
                    ...process.env,
                    PATH: `${stubDir}:${process.env.PATH ?? ''}`,
                    XDG_CACHE_HOME: xdgCache,
                },
            },
        );

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
            JSON.stringify(
                {
                    id: 'org.example.SyncPr',
                    modules: [
                        {
                            name: 'syncpr',
                            sources: [
                                {
                                    type: 'git',
                                    url: 'https://github.com/example/syncpr.git',
                                    tag: 'v0.5.0',
                                    commit: '1111111111111111111111111111111111111111',
                                },
                            ],
                        },
                    ],
                },
                null,
                2,
            ) + '\n',
            'utf-8',
        );

        const stubDir = join(tmpDir, 'stub-pr');
        mkdirSync(stubDir, { recursive: true });
        writeGitStub(stubDir, fixtureDir);
        writeShim(stubDir, 'gh', 'GH_CALLS');

        const xdgCache = join(tmpDir, 'xdg-pr');
        mkdirSync(xdgCache, { recursive: true });

        runCliSync(
            CLI_ENTRY,
            ['flatpak', 'sync-flathub', '--version', 'v0.6.0', '--commit', 'cafef00d0000000000000000000000000000bbbb'],
            {
                cwd: projectDir,
                env: {
                    ...process.env,
                    PATH: `${stubDir}:${process.env.PATH ?? ''}`,
                    XDG_CACHE_HOME: xdgCache,
                },
            },
        );

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
            JSON.stringify(
                {
                    id: 'org.example.SyncIdem',
                    modules: [
                        {
                            name: 'syncidem',
                            sources: [
                                {
                                    type: 'git',
                                    url: 'https://github.com/example/syncidem.git',
                                    tag: 'v1.0.0',
                                    commit: 'feedfacefeedfacefeedfacefeedfacefeedface',
                                    'x-checker-data': {
                                        type: 'git',
                                        'tag-pattern': '^v(\\d+\\.\\d+\\.\\d+)$',
                                        'version-scheme': 'semantic',
                                    },
                                },
                            ],
                        },
                    ],
                },
                null,
                2,
            ) + '\n',
            'utf-8',
        );

        const stubDir = join(tmpDir, 'stub-idem');
        mkdirSync(stubDir, { recursive: true });
        writeGitStub(stubDir, fixtureDir);
        writeShim(stubDir, 'gh', 'GH_CALLS');

        const xdgCache = join(tmpDir, 'xdg-idem');
        mkdirSync(xdgCache, { recursive: true });

        const out = runCliSync(
            CLI_ENTRY,
            ['flatpak', 'sync-flathub', '--version', 'v1.0.0', '--commit', 'feedfacefeedfacefeedfacefeedfacefeedface'],
            {
                cwd: projectDir,
                env: {
                    ...process.env,
                    PATH: `${stubDir}:${process.env.PATH ?? ''}`,
                    XDG_CACHE_HOME: xdgCache,
                },
            },
        );

        assert.match(out, /already at v1\.0\.0 — nothing to do/);
        assert.equal(existsSync(join(stubDir, 'GH_CALLS')), false, 'gh should not be called on no-op');
    });

    // An answer that is EMPTY rather than absent. Real `git show` exits non-zero
    // for a path a tag does not carry, so a caller that reads only the exit
    // status looks complete — and then reads "" as a file that exists and is
    // empty, writes it into the Flathub repo and names it in the manifest. That
    // is worse than skipping: the build still cannot install, and the manifest
    // now claims it can.
    it('skips a source list that comes back empty', () => {
        const projectDir = join(tmpDir, 'empty');
        scaffoldProject(projectDir, { appId: 'org.example.SyncEmpty' });

        const fixtureDir = join(tmpDir, 'fixture-empty');
        mkdirSync(fixtureDir, { recursive: true });
        writeFileSync(
            join(fixtureDir, 'org.example.SyncEmpty.json'),
            JSON.stringify(
                {
                    id: 'org.example.SyncEmpty',
                    modules: [
                        {
                            name: 'syncempty',
                            sources: [
                                {
                                    type: 'git',
                                    url: 'https://github.com/example/syncempty.git',
                                    tag: 'v1.0.0',
                                    commit: 'feedfacefeedfacefeedfacefeedfacefeedface',
                                    'x-checker-data': {
                                        type: 'git',
                                        'tag-pattern': '^v(\\d+\\.\\d+\\.\\d+)$',
                                        'version-scheme': 'semantic',
                                    },
                                },
                            ],
                        },
                    ],
                },
                null,
                2,
            ) + '\n',
            'utf-8',
        );

        const stubDir = join(tmpDir, 'stub-empty');
        mkdirSync(stubDir, { recursive: true });
        writeGitStub(stubDir, fixtureDir, { show: '' });
        writeShim(stubDir, 'gh', 'GH_CALLS');

        const xdgCache = join(tmpDir, 'xdg-empty');
        mkdirSync(xdgCache, { recursive: true });

        const out = runCliSync(
            CLI_ENTRY,
            ['flatpak', 'sync-flathub', '--version', 'v1.0.0', '--commit', 'feedfacefeedfacefeedfacefeedfacefeedface'],
            {
                cwd: projectDir,
                env: {
                    ...process.env,
                    PATH: `${stubDir}:${process.env.PATH ?? ''}`,
                    XDG_CACHE_HOME: xdgCache,
                },
            },
        );

        const clone = join(xdgCache, 'gjsify/flathub-sync/flathub__org.example.SyncEmpty');
        assert.equal(existsSync(join(clone, 'gjsify-sources.json')), false, 'no empty list may be written');
        assert.match(out, /already at v1\.0\.0 — nothing to do/);
        assert.equal(existsSync(join(stubDir, 'GH_CALLS')), false, 'gh should not be called');
    });

    // THE HALF OF A BUMP THAT IS NOT THE PIN. The tarball list changes whenever
    // a dependency does, so a release can need a PR with the tag unmoved — the
    // case an "is the pin current?" test answers "nothing to do" for, over a
    // Flathub repo carrying a stale list.
    it('opens a PR for a changed source list even when the pin is current', () => {
        const projectDir = join(tmpDir, 'srcs');
        scaffoldProject(projectDir, { appId: 'org.example.SyncSrcs' });

        const fixtureDir = join(tmpDir, 'fixture-srcs');
        mkdirSync(fixtureDir, { recursive: true });
        writeFileSync(
            join(fixtureDir, 'org.example.SyncSrcs.json'),
            JSON.stringify(
                {
                    id: 'org.example.SyncSrcs',
                    modules: [
                        {
                            name: 'syncsrcs',
                            sources: [
                                {
                                    type: 'git',
                                    url: 'https://github.com/example/syncsrcs.git',
                                    tag: 'v1.0.0',
                                    commit: 'feedfacefeedfacefeedfacefeedfacefeedface',
                                    // Present so the manifest comes out BYTE-IDENTICAL. Without it
                                    // `editManifest` injects the block, the manifest changes, and a
                                    // PR opens for that reason instead of the one under test —
                                    // measured: removing the source-list check left this green.
                                    'x-checker-data': {
                                        type: 'git',
                                        'tag-pattern': '^v(\\d+\\.\\d+\\.\\d+)$',
                                        'version-scheme': 'semantic',
                                    },
                                },
                                'gjsify-sources.json',
                            ],
                        },
                    ],
                },
                null,
                2,
            ) + '\n',
            'utf-8',
        );
        // The Flathub repo already carries a list, and it is the OLD one.
        writeFileSync(
            join(fixtureDir, 'gjsify-sources.json'),
            JSON.stringify([{ type: 'file', url: 'https://registry.invalid/old.tgz', sha512: 'aa' }], null, 2) + '\n',
            'utf-8',
        );

        const stubDir = join(tmpDir, 'stub-srcs');
        mkdirSync(stubDir, { recursive: true });
        // `git show <tag>:gjsify-sources.json` answers the NEW list, which is
        // what the tag being pinned actually contains.
        writeGitStub(stubDir, fixtureDir, {
            show: JSON.stringify([{ type: 'file', url: 'https://registry.invalid/new.tgz', sha512: 'bb' }], null, 2),
        });
        writeShim(stubDir, 'gh', 'GH_CALLS');

        const xdgCache = join(tmpDir, 'xdg-srcs');
        mkdirSync(xdgCache, { recursive: true });

        runCliSync(
            CLI_ENTRY,
            ['flatpak', 'sync-flathub', '--version', 'v1.0.0', '--commit', 'feedfacefeedfacefeedfacefeedfacefeedface'],
            {
                cwd: projectDir,
                env: {
                    ...process.env,
                    PATH: `${stubDir}:${process.env.PATH ?? ''}`,
                    XDG_CACHE_HOME: xdgCache,
                },
            },
        );

        const clone = join(xdgCache, 'gjsify/flathub-sync/flathub__org.example.SyncSrcs');
        assert.match(readFileSync(join(clone, 'gjsify-sources.json'), 'utf-8'), /new\.tgz/);
        assert.match(
            readFileSync(join(stubDir, 'GH_CALLS'), 'utf-8'),
            /pr create --repo flathub\/org\.example\.SyncSrcs/,
        );
    });

    // A FAILED `git show` IS NOT PROOF THE TAG LACKS THE FILE. Measured: path
    // absent, unknown tag and not-a-git-repository are all exit 128, and the
    // message is translated, so neither the status nor the text separates them.
    // Read as absence, a tag nobody fetched moves the pin and leaves the old
    // list in the Flathub repo — this command's own bug, silent. `--commit`
    // is what puts it in reach: it is the one path that resolves the tag for
    // nothing else.
    it('refuses a tag it cannot resolve rather than skipping the list', () => {
        const projectDir = join(tmpDir, 'badtag');
        scaffoldProject(projectDir, { appId: 'org.example.SyncBadTag' });

        const fixtureDir = join(tmpDir, 'fixture-badtag');
        mkdirSync(fixtureDir, { recursive: true });
        writeFileSync(
            join(fixtureDir, 'org.example.SyncBadTag.json'),
            JSON.stringify(
                {
                    id: 'org.example.SyncBadTag',
                    modules: [
                        {
                            name: 'syncbadtag',
                            sources: [
                                {
                                    type: 'git',
                                    url: 'https://github.com/example/syncbadtag.git',
                                    tag: 'v1.0.0',
                                    commit: 'feedfacefeedfacefeedfacefeedfacefeedface',
                                },
                                'gjsify-sources.json',
                            ],
                        },
                    ],
                },
                null,
                2,
            ) + '\n',
            'utf-8',
        );
        writeFileSync(
            join(fixtureDir, 'gjsify-sources.json'),
            JSON.stringify([{ type: 'file', url: 'https://registry.invalid/old.tgz', sha512: 'aa' }], null, 2) + '\n',
            'utf-8',
        );

        const stubDir = join(tmpDir, 'stub-badtag');
        mkdirSync(stubDir, { recursive: true });
        // No `show` answer — exit 128, exactly as for a path the tag lacks —
        // and a `rev-parse` that cannot name the tag either.
        writeGitStub(stubDir, fixtureDir, { tagResolves: false });
        writeShim(stubDir, 'gh', 'GH_CALLS');

        const xdgCache = join(tmpDir, 'xdg-badtag');
        mkdirSync(xdgCache, { recursive: true });

        let threw = false;
        try {
            runCliSync(
                CLI_ENTRY,
                [
                    'flatpak',
                    'sync-flathub',
                    '--version',
                    'v2.0.0',
                    '--commit',
                    'feedfacefeedfacefeedfacefeedfacefeedface',
                ],
                {
                    cwd: projectDir,
                    env: {
                        ...process.env,
                        PATH: `${stubDir}:${process.env.PATH ?? ''}`,
                        XDG_CACHE_HOME: xdgCache,
                    },
                },
            );
        } catch (err) {
            threw = true;
            assert.match(`${err.stderr ?? ''}${err.stdout ?? ''}`, /v2\.0\.0 does not resolve/);
            assert.match(`${err.stderr ?? ''}${err.stdout ?? ''}`, /git fetch --tags/);
        }
        assert.ok(threw, 'expected a non-zero exit on a tag that does not resolve');

        const clone = join(xdgCache, 'gjsify/flathub-sync/flathub__org.example.SyncBadTag');
        // The old list is still the old list, and no PR carries it anywhere.
        assert.match(readFileSync(join(clone, 'gjsify-sources.json'), 'utf-8'), /old\.tgz/);
        assert.equal(existsSync(join(stubDir, 'GH_CALLS')), false, 'gh must not be called');
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
    const script = ['#!/bin/sh', `echo "$@" >> ${shellQuote(trace)}`, `exit ${exitCode}`].join('\n') + '\n';
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
function writeGitStub(binDir, fixtureDir, answers = {}) {
    const trace = join(binDir, 'GIT_CALLS');
    // `show` defaults to the real thing's behaviour for a path the tag does not
    // carry: non-zero, no output. It used to fall through to the catch-all,
    // which exits 0 with nothing — and a caller that reads exit status alone
    // then believes the file exists and is empty.
    const showFile = join(binDir, 'GIT_SHOW_OUT');
    if (answers.show !== undefined) writeFileSync(showFile, answers.show, 'utf-8');
    // `rev-parse` needs an arm of its own for the same reason `show` does: the
    // catch-all answers exit 0 with NOTHING, which a caller reading the status
    // takes for a tag that exists. The default is a repo whose tag is there,
    // which is what every case but the bad-tag one means by a failed `show`.
    const revParse =
        answers.tagResolves === false ? '    exit 1 ;;' : '    echo "feedfacefeedfacefeedfacefeedfacefeedface" ;;';
    const script =
        [
            '#!/bin/sh',
            `echo "$@" >> ${shellQuote(trace)}`,
            'case "$1" in',
            '  show)',
            `    if [ -f ${shellQuote(showFile)} ]; then cat ${shellQuote(showFile)}; exit 0; fi`,
            '    exit 128 ;;',
            '  rev-parse)',
            revParse,
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
