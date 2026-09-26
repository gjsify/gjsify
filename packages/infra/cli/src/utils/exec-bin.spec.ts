// Unit tests for `gjsify exec`'s pure half (ADR 0076): what a bin name means, which
// runtime runs it, and when a rebuilt artifact is still the right one. The spawn and
// the rebuild are driven end to end by `tests/e2e/exec-command`.

import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    ExecBinNotFoundError,
    ExecPlanError,
    artifactFileName,
    execArtifactPath,
    execCacheKey,
    findProjectLockfile,
    planExec,
    resolveExecBin,
    splitExecArgv,
    type ResolvedBin,
} from './exec-bin.js';

function pkg(root: string, dir: string, manifest: Record<string, unknown>, files: string[]): string {
    const pkgDir = join(root, dir);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(manifest));
    for (const f of files) {
        mkdirSync(join(pkgDir, f, '..'), { recursive: true });
        writeFileSync(join(pkgDir, f), '// bin\n');
    }
    return pkgDir;
}

/** A project with three installed bins, written the ways package managers write them. */
function fixture(): { root: string; project: string; nm: string } {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'gjsify-exec-bin-')));
    const project = join(root, 'project');
    const nm = join(project, 'node_modules');
    pkg(project, '.', { name: 'the-project', version: '1.0.0', bin: { own: 'bin/own.mjs' } }, ['bin/own.mjs']);
    // `.bin/linked` is a symlink (npm/pnpm on POSIX).
    pkg(nm, 'linked-pkg', { name: 'linked-pkg', version: '2.0.0', bin: { linked: 'cli.js' } }, ['cli.js']);
    // `.bin/plain` is a regular file (a gjsify sh launcher, a Windows shim).
    pkg(nm, '@scope/plain', { name: '@scope/plain', version: '3.1.4', bin: 'dist/plain.cjs' }, ['dist/plain.cjs']);
    // Two packages declare `dup`; the one NAMED `dup` must win, as `npx dup` picks it.
    pkg(nm, 'aaa-other', { name: 'aaa-other', version: '1.0.0', bin: { dup: 'x.js' } }, ['x.js']);
    pkg(nm, 'dup', { name: 'dup', version: '9.9.9', bin: { dup: 'dup.js' } }, ['dup.js']);
    // Ships a GJS bundle beside the Node entry.
    pkg(
        nm,
        'dual',
        { name: 'dual', version: '0.1.0', bin: { dual: 'node.js' }, gjsify: { bin: { dual: 'dual.gjs.mjs' } } },
        ['node.js', 'dual.gjs.mjs'],
    );
    mkdirSync(join(nm, '.bin'), { recursive: true });
    for (const name of ['plain', 'dup', 'dual']) writeFileSync(join(nm, '.bin', name), '#!/bin/sh\n');
    return { root, project, nm };
}

const BIN: ResolvedBin = {
    binName: 'tool',
    pkgName: 'tool',
    pkgVersion: '1.0.0',
    pkgDir: '/p/node_modules/tool',
    entry: '/p/node_modules/tool/bin/tool.js',
    gjsEntry: null,
    nodeModules: '/p/node_modules',
    installed: true,
};

export default async () => {
    await describe('gjsify exec — splitExecArgv', async () => {
        await it('keeps flags AFTER the bin for the bin, --runtime included', () => {
            const inv = splitExecArgv(['--runtime', 'gjs', 'wxt', '--runtime', 'x', '-v']);
            expect(inv.runtime).toBe('gjs');
            expect(inv.bin).toBe('wxt');
            expect(inv.args).toStrictEqual(['--runtime', 'x', '-v']);
        });

        await it('reads --runtime=<r>, --rebuild and --verbose before the bin', () => {
            const inv = splitExecArgv(['--runtime=node', '--rebuild', '--verbose', 'semver', '1.2.3']);
            expect(inv.runtime).toBe('node');
            expect(inv.rebuild).toBe(true);
            expect(inv.verbose).toBe(true);
            expect(inv.args).toStrictEqual(['1.2.3']);
        });

        await it('defaults to the host runtime and no rebuild', () => {
            const inv = splitExecArgv(['prettier']);
            expect(inv.runtime).toBe(null);
            expect(inv.rebuild).toBe(false);
            expect(inv.args).toStrictEqual([]);
        });

        await it('hands a `--` after the bin to the bin', () => {
            expect(splitExecArgv(['tool', 'a'], ['--x']).args).toStrictEqual(['a', '--', '--x']);
        });

        await it('treats a `--` before the bin as a separator only', () => {
            const inv = splitExecArgv(['--rebuild'], ['-weird', 'arg']);
            expect(inv.bin).toBe('-weird');
            expect(inv.args).toStrictEqual(['arg']);
        });

        await it('refuses an unknown leading option, a bad runtime, and no bin', () => {
            expect(() => splitExecArgv(['--nope', 'tool'])).toThrow(ExecPlanError);
            expect(() => splitExecArgv(['--runtime', 'python', 'tool'])).toThrow(ExecPlanError);
            expect(() => splitExecArgv(['--runtime'])).toThrow(ExecPlanError);
            expect(() => splitExecArgv([])).toThrow(ExecPlanError);
        });
    });

    await describe('gjsify exec — resolveExecBin', async () => {
        await it('follows a `.bin` symlink to its package', () => {
            const { root, project, nm } = fixture();
            try {
                symlinkSync(join('..', 'linked-pkg', 'cli.js'), join(nm, '.bin', 'linked'));
                const bin = resolveExecBin('linked', project);
                expect(bin.pkgName).toBe('linked-pkg');
                expect(bin.pkgVersion).toBe('2.0.0');
                expect(bin.entry).toBe(join(nm, 'linked-pkg', 'cli.js'));
                expect(bin.nodeModules).toBe(nm);
                expect(bin.installed).toBe(true);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('reads the manifests when `.bin/<name>` is not a symlink (string `bin`, scoped)', () => {
            const { root, project, nm } = fixture();
            try {
                const bin = resolveExecBin('plain', project);
                expect(bin.pkgName).toBe('@scope/plain');
                expect(bin.entry).toBe(join(nm, '@scope', 'plain', 'dist', 'plain.cjs'));
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('prefers the package NAMED like the bin', () => {
            const { root, project } = fixture();
            try {
                expect(resolveExecBin('dup', project).pkgName).toBe('dup');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it("finds the project's own bin, which is never reused from a cache", () => {
            const { root, project } = fixture();
            try {
                const bin = resolveExecBin('own', project);
                expect(bin.pkgName).toBe('the-project');
                expect(bin.nodeModules).toBe(null);
                expect(bin.installed).toBe(false);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('walks up from a subdirectory', () => {
            const { root, project } = fixture();
            try {
                const sub = join(project, 'src', 'deep');
                mkdirSync(sub, { recursive: true });
                expect(resolveExecBin('plain', sub).pkgName).toBe('@scope/plain');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('reports the GJS bundle a package ships', () => {
            const { root, project, nm } = fixture();
            try {
                const bin = resolveExecBin('dual', project);
                expect(bin.gjsEntry).toBe(join(nm, 'dual', 'dual.gjs.mjs'));
                expect(bin.entry).toBe(join(nm, 'dual', 'node.js'));
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('names every node_modules it searched when nothing matches', () => {
            const { root, project, nm } = fixture();
            try {
                let err: unknown;
                try {
                    resolveExecBin('missing', project);
                } catch (e) {
                    err = e;
                }
                expect(err instanceof ExecBinNotFoundError).toBe(true);
                expect((err as ExecBinNotFoundError).searched).toContain(nm);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });

    await describe('gjsify exec — planExec (runtime selection)', async () => {
        await it('runs the npm entry unchanged on node, bun and deno', () => {
            for (const runtime of ['node', 'bun', 'deno'] as const) {
                expect(planExec(BIN, runtime)).toStrictEqual({ kind: 'direct', runtime, file: BIN.entry! });
            }
        });

        await it('rebuilds the npm entry on gjs', () => {
            expect(planExec(BIN, 'gjs')).toStrictEqual({ kind: 'rebuild', entry: BIN.entry! });
        });

        await it("runs a package's own GJS bundle on gjs instead of rebuilding", () => {
            const dual = { ...BIN, gjsEntry: '/p/node_modules/tool/tool.gjs.mjs' };
            expect(planExec(dual, 'gjs')).toStrictEqual({ kind: 'gjs-bundle', file: dual.gjsEntry });
            expect(planExec(dual, 'node')).toStrictEqual({ kind: 'direct', runtime: 'node', file: BIN.entry! });
        });

        await it('refuses a GJS-only bin on node rather than guessing', () => {
            const gjsOnly = { ...BIN, entry: null, gjsEntry: '/p/x.gjs.mjs' };
            expect(() => planExec(gjsOnly, 'node')).toThrow(ExecPlanError);
        });
    });

    await describe('gjsify exec — cache key and artifact path', async () => {
        const base = {
            pkgName: 'prettier',
            pkgVersion: '3.9.9',
            entry: 'bin/prettier.cjs',
            cliVersion: '0.52.0',
            lockfileHash: 'abc',
        };

        await it('is stable for the same inputs', () => {
            expect(execCacheKey(base)).toBe(execCacheKey({ ...base }));
        });

        await it('changes with the version, the entry, the CLI and the lockfile', () => {
            const key = execCacheKey(base);
            expect(execCacheKey({ ...base, pkgVersion: '3.9.10' })).not.toBe(key);
            expect(execCacheKey({ ...base, entry: 'bin/other.cjs' })).not.toBe(key);
            expect(execCacheKey({ ...base, cliVersion: '0.53.0' })).not.toBe(key);
            expect(execCacheKey({ ...base, lockfileHash: 'abd' })).not.toBe(key);
            expect(execCacheKey({ ...base, lockfileHash: null })).not.toBe(key);
        });

        await it("keeps the entry's name, turning .cjs into .mjs", () => {
            expect(artifactFileName('/x/bin/wxt.mjs')).toBe('wxt.mjs');
            expect(artifactFileName('/x/bin/semver.js')).toBe('semver.js');
            expect(artifactFileName('/x/bin/prettier.cjs')).toBe('prettier.mjs');
        });

        await it('puts the key in the directory, not the file name', () => {
            const path = execArtifactPath('/c', { pkgName: '@s/p', pkgVersion: '1.0.0' }, '/x/cli.js', 'f'.repeat(64));
            expect(path).toBe(join('/c', `@s_p@1.0.0-${'f'.repeat(16)}`, 'cli.js'));
        });

        await it('finds the nearest lockfile walking up', () => {
            const root = realpathSync(mkdtempSync(join(tmpdir(), 'gjsify-exec-lock-')));
            try {
                mkdirSync(join(root, 'a', 'b'), { recursive: true });
                expect(findProjectLockfile(join(root, 'a', 'b'))).toBe(null);
                writeFileSync(join(root, 'a', 'package-lock.json'), '{}');
                expect(findProjectLockfile(join(root, 'a', 'b'))).toBe(join(root, 'a', 'package-lock.json'));
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });
};
