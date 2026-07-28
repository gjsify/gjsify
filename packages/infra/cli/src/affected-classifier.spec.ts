// SPDX-License-Identifier: MIT
// Unit tests for the `gjsify affected` classifier.
//
// We exercise `classifyAndExpand` indirectly by spawning the built CLI
// bundle with `--changed-from-stdin` and `--format=json`. That keeps the
// internal helper unexported (it's a private detail of the command) but
// still gives us deterministic, behavioral coverage of every classifier
// branch.

import { describe, it, expect } from '@gjsify/unit';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Resolve the CLI entry from the workspace root rather than `import.meta.url`.
// `gjsify run test:node` runs `node dist/test.node.mjs` after bundling the
// spec, so `import.meta.url` at runtime points at the bundle in `dist/`,
// not at the original `src/` or `lib/` location. The workspace's npm script
// always runs from the package root, so `process.cwd()` is stable here and
// points at `packages/infra/cli`; the tsc-emitted CLI entry is `lib/index.js`.
const CLI_ENTRY = resolve(process.cwd(), 'lib/index.js');

interface ClassifyOutput {
    global: boolean;
    reason: string;
    workspaces: string[];
    runE2E: boolean;
    runIntegration: boolean;
    skipAll: boolean;
}

function makeMonorepo(): string {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-affected-spec-'));
    // root manifest with one workspaces pattern that picks up packages/*/*
    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
            name: 'monorepo-root',
            version: '0.0.0',
            private: true,
            workspaces: ['packages/*/*'],
        }) + '\n',
    );
    const pkgs = [
        { rel: 'packages/node/fs', name: '@gjsify/fs', deps: {}, devDeps: {} },
        { rel: 'packages/node/path', name: '@gjsify/path', deps: {}, devDeps: {} },
        // A depends on fs at RUNTIME — an fs change must cascade to A.
        {
            rel: 'packages/node/A',
            name: '@gjsify/A',
            deps: { '@gjsify/fs': 'workspace:*' },
            devDeps: {},
        },
        // B depends on fs only as a DEV dependency (the build/test-tooling edge
        // shape). The prod-deps-only closure must NOT pull B in when fs changes.
        {
            rel: 'packages/node/B',
            name: '@gjsify/B',
            deps: {},
            devDeps: { '@gjsify/fs': 'workspace:*' },
        },
    ];
    for (const p of pkgs) {
        const dir = join(root, p.rel);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({
                name: p.name,
                version: '0.0.0',
                dependencies: p.deps,
                devDependencies: p.devDeps,
            }) + '\n',
        );
    }
    return root;
}

/** Run any argv and return the raw streams — used by the transport tests. */
async function run(argv: string[], stdin?: string): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((res, rej) => {
        const child = spawn(process.execPath, argv, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += String(d)));
        child.stderr.on('data', (d) => (stderr += String(d)));
        child.on('error', rej);
        child.on('close', (code) => res({ code: code ?? -1, stdout, stderr }));
        child.stdin.end(stdin ?? '');
    });
}

/** Emit `--format=github-actions` and return the `include-args=` line's value. */
async function includeArgsFor(cwd: string, changedFiles: string[]): Promise<string> {
    const r = await run(
        [CLI_ENTRY, 'affected', '--changed-from-stdin', '--format=github-actions', '--cwd', cwd],
        changedFiles.join('\n') + '\n',
    );
    if (r.code !== 0) throw new Error(`affected exited ${r.code}: ${r.stderr}`);
    const line = r.stdout.split('\n').find((l) => l.startsWith('include-args='));
    if (line === undefined) throw new Error(`no include-args line in:\n${r.stdout}`);
    return line.slice('include-args='.length);
}

/**
 * Word-split `value` exactly as the CONSUMER does — an unquoted `$V` expansion
 * in a real POSIX shell. This is the assertion that actually matters: a unit
 * test comparing strings cannot tell a token from a token-with-quotes-attached,
 * which is the whole of repo task #75.
 */
async function shellWordSplit(value: string): Promise<string[]> {
    return new Promise((res, rej) => {
        // The value rides in as a positional (`$1`), then is expanded UNQUOTED
        // exactly like `$INCLUDE_ARGS` in main.yml. Positional rather than env
        // so the test needs no env plumbing on either runtime.
        const child = spawn('sh', ['-c', 'V="$1"; for a in $V; do printf "%s\\n" "$a"; done', 'sh', value], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        child.stdout.on('data', (d) => (out += String(d)));
        child.on('error', rej);
        child.on('close', () => res(out.split('\n').filter((s) => s.length > 0)));
    });
}

async function runClassify(cwd: string, changedFiles: string[]): Promise<ClassifyOutput> {
    return new Promise((res, rej) => {
        const child = spawn(
            process.execPath,
            [CLI_ENTRY, 'affected', '--changed-from-stdin', '--format=json', '--cwd', cwd],
            { stdio: ['pipe', 'pipe', 'pipe'] },
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += String(d)));
        child.stderr.on('data', (d) => (stderr += String(d)));
        child.on('close', (code) => {
            if (code !== 0) {
                rej(new Error(`affected exited ${code}: ${stderr}`));
                return;
            }
            try {
                res(JSON.parse(stdout.trim()));
            } catch (e) {
                rej(new Error(`bad json: ${stdout}\n${(e as Error).message}`));
            }
        });
        child.stdin.end(changedFiles.join('\n') + '\n');
    });
}

export default async (): Promise<void> => {
    await describe('gjsify affected classifier', async () => {
        const root = makeMonorepo();

        await it('empty diff → skipAll=true', async () => {
            const r = await runClassify(root, []);
            expect(r.skipAll).toBe(true);
            expect(r.global).toBe(false);
        });

        await it('only docs → skipAll=true', async () => {
            const r = await runClassify(root, ['README.md', 'docs/foo.md', 'STATUS.md']);
            expect(r.skipAll).toBe(true);
        });

        await it('flatpak SDK-extension manifest → skipAll (build tooling, ignored)', async () => {
            const r = await runClassify(root, [
                'flatpak/org.freedesktop.Sdk.Extension.gjsify.json',
                'flatpak/org.freedesktop.Sdk.Extension.gjsify.metainfo.xml',
            ]);
            expect(r.skipAll).toBe(true);
            expect(r.global).toBe(false);
        });

        await it('flatpak manifest alongside a real src change → flatpak ignored, no full run', async () => {
            // The flatpak manifest is dropped by IGNORE, so it neither forces a
            // global run nor widens the closure — only the real `fs` change drives it.
            const r = await runClassify(root, [
                'flatpak/org.freedesktop.Sdk.Extension.gjsify.json',
                'packages/node/fs/src/index.ts',
            ]);
            expect(r.global).toBe(false);
            expect(r.skipAll).toBe(false);
        });

        await it('packages/node-gi change → skipAll (own node-gi.yml, not a workspace)', async () => {
            // node-gi is not a gjsify workspace; its own workflow builds + tests
            // it. Its files are ignored so a node-gi-only PR skips the main run.
            const r = await runClassify(root, [
                'packages/node-gi/node-gi/src/addon.cc',
                'packages/node-gi/node-gi/index.js',
                'packages/node-gi/node-gi/test/callbacks.test.mjs',
            ]);
            expect(r.skipAll).toBe(true);
            expect(r.global).toBe(false);
        });

        await it('node-gi.yml workflow change → ignored (its own workflow)', async () => {
            const r = await runClassify(root, ['.github/workflows/node-gi.yml']);
            expect(r.skipAll).toBe(true);
            expect(r.global).toBe(false);
        });

        await it('node-gi alongside a real src change → node-gi ignored, no full run', async () => {
            const r = await runClassify(root, [
                'packages/node-gi/node-gi/src/addon.cc',
                'packages/node/fs/src/index.ts',
            ]);
            expect(r.global).toBe(false);
            expect(r.skipAll).toBe(false);
        });

        await it('packages/napi change → skipAll (own napi.yml, not a workspace)', async () => {
            // napi is not a gjsify workspace; its own workflow builds + tests it
            // (Vala+C++/meson shim + node-gyp addons). Its files are ignored so a
            // napi-only PR skips the main run.
            const r = await runClassify(root, [
                'packages/napi/napi/src/cc/value.cc',
                'packages/napi/napi/conformance/programs/test_number.mjs',
                'packages/napi/napi/scripts/conformance.mjs',
            ]);
            expect(r.skipAll).toBe(true);
            expect(r.global).toBe(false);
        });

        await it('napi.yml workflow change → ignored (its own workflow)', async () => {
            const r = await runClassify(root, ['.github/workflows/napi.yml']);
            expect(r.skipAll).toBe(true);
            expect(r.global).toBe(false);
        });

        await it('napi alongside a real src change → napi ignored, no full run', async () => {
            const r = await runClassify(root, [
                'packages/napi/napi/src/cc/value.cc',
                'packages/node/fs/src/index.ts',
            ]);
            expect(r.global).toBe(false);
            expect(r.skipAll).toBe(false);
        });

        await it('docs inside a global-trigger dir → skipAll (ignore wins over global)', async () => {
            // A README in a GLOBAL_TRIGGERS path (packages/infra/cli/,
            // workspace/, …) must NOT force a full run — IGNORE is applied
            // before the global-trigger check.
            const r = await runClassify(root, [
                'packages/infra/cli/README.md',
                'packages/infra/workspace/README.md',
            ]);
            expect(r.skipAll).toBe(true);
            expect(r.global).toBe(false);
        });

        await it('real src in a global-trigger dir still triggers global (alongside a README)', async () => {
            const r = await runClassify(root, [
                'packages/infra/cli/README.md',
                'packages/infra/cli/src/commands/build.ts',
            ]);
            expect(r.global).toBe(true);
        });

        await it('infra workspace touched → global=true', async () => {
            const r = await runClassify(root, ['packages/infra/workspace/src/index.ts']);
            expect(r.global).toBe(true);
            expect(r.runIntegration).toBe(true);
            expect(r.runE2E).toBe(true);
        });

        await it('root lockfile bump → global=true', async () => {
            const r = await runClassify(root, ['gjsify-lock.json']);
            expect(r.global).toBe(true);
        });

        await it('root tsconfig → global=true', async () => {
            const r = await runClassify(root, ['tsconfig.json']);
            expect(r.global).toBe(true);
        });

        await it('workflow files (other than main.yml) → ignored', async () => {
            const r = await runClassify(root, [
                '.github/workflows/deploy-docs.yml',
                '.github/workflows/audit-runtimes.yml',
            ]);
            expect(r.skipAll).toBe(true);
        });

        await it('single-pkg code change → seeds + prod dependents only', async () => {
            const r = await runClassify(root, ['packages/node/fs/src/index.ts']);
            expect(r.global).toBe(false);
            // fs and its RUNTIME dependent A — closure size 2. B (devDep on fs)
            // is intentionally excluded by the prod-deps-only closure.
            expect(r.workspaces.length).toBe(2);
            expect(r.workspaces.includes('@gjsify/fs')).toBeTruthy();
            expect(r.workspaces.includes('@gjsify/A')).toBeTruthy();
        });

        await it('devDependent is NOT pulled into the closure (prod-deps only)', async () => {
            // @gjsify/B devDepends @gjsify/fs; a change to fs must not re-test B.
            // This is the core of the prod-only closure — build/test-tool devDep
            // edges no longer fan a single-package change out across the monorepo
            // (the cause of the historical 210/221-workspace closure explosion).
            const r = await runClassify(root, ['packages/node/fs/src/index.ts']);
            expect(r.workspaces.includes('@gjsify/B')).toBe(false);
            expect(r.workspaces.includes('@gjsify/A')).toBeTruthy();
        });

        await it('@gjsify/unit (universal test framework) change → global=true', async () => {
            // packages/gjs/unit is a GLOBAL_TRIGGERS path: under the prod-deps-
            // only closure a unit change would otherwise yield a near-empty
            // closure, but a matcher bug can break assertions anywhere — so a
            // change to the test framework must force a full run.
            const r = await runClassify(root, ['packages/gjs/unit/src/index.ts']);
            expect(r.global).toBe(true);
        });

        await it('test-only change for one ws → no closure expansion', async () => {
            const r = await runClassify(root, ['packages/node/fs/src/foo.spec.ts']);
            expect(r.global).toBe(false);
            expect(r.workspaces.length).toBe(1);
            expect(r.workspaces[0]).toBe('@gjsify/fs');
        });

        await it('unmatched-but-not-ignored file → conservative global', async () => {
            const r = await runClassify(root, ['scripts/unknown.mjs']);
            // scripts/ is not in IGNORE and not in any workspace; classifier
            // bails out conservatively.
            expect(r.global).toBe(true);
        });

        // ── include-args transport (repo task #75) ──────────────────────
        // `include-args` is consumed as an UNQUOTED `$INCLUDE_ARGS` expansion
        // inside main.yml's `su … -c "… sh -c '…'"` nesting. It therefore must
        // carry NO quoting of its own: an expansion result is never re-scanned
        // for quotes, so a pre-quoted token arrives with the quotes glued on,
        // matches zero workspaces, and `gjsify foreach` exits 0 — CI built
        // nothing on every selective run for as long as that shipped.

        await it('github-actions include-args carries NO quoting', async () => {
            const value = await includeArgsFor(root, ['packages/node/fs/src/index.ts']);
            expect(value.includes("'")).toBe(false);
            expect(value.includes('"')).toBe(false);
            // Sorted closure = @gjsify/A (prod dependent) + @gjsify/fs (seed).
            expect(value).toBe('--include @gjsify/A --include @gjsify/fs');
        });

        await it('include-args word-splits into exactly the argv CI intends', async () => {
            // The real proof: run the consumer's own expansion in a real shell.
            const value = await includeArgsFor(root, ['packages/node/fs/src/index.ts']);
            const argv = await shellWordSplit(value);
            expect(argv.join('|')).toBe('--include|@gjsify/A|--include|@gjsify/fs');
            // Belt and braces: no surviving token may carry a quote character.
            // Pre-quoting produced `'@gjsify/fs'` here, which is what silently
            // matched nothing.
            expect(argv.some((a) => a.includes("'") || a.includes('"'))).toBe(false);
        });

        await it('global run emits an EMPTY include-args (the full-run signal)', async () => {
            // main.yml keys FULL off `include-args == ''`, so a global
            // classification must not smuggle tokens into the value.
            const value = await includeArgsFor(root, ['gjsify-lock.json']);
            expect(value).toBe('');
        });

        await it("include-args still satisfies the workflow's contains() gates", async () => {
            // Thirteen `contains(needs.changes.outputs.include-args, '@gjsify/…')`
            // expressions substring-match this value. They matched the quoted
            // spelling too — which is exactly why the gates kept firing while
            // the build did nothing — so this pins that unquoting them did not
            // break the gates either.
            const value = await includeArgsFor(root, ['packages/node/fs/src/index.ts']);
            expect(value.includes('@gjsify/fs')).toBe(true);
            expect(value.includes('@gjsify/example-')).toBe(false);
        });

        // Cleanup last so failing tests still surface the fixture state.
        await it('teardown', async () => {
            rmSync(root, { recursive: true, force: true });
            expect(true).toBe(true);
        });
    });
};
