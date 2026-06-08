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
        { rel: 'packages/node/fs', name: '@gjsify/fs', deps: {} },
        { rel: 'packages/node/path', name: '@gjsify/path', deps: {} },
        // A depends on fs — fs change should cascade to A
        {
            rel: 'packages/node/A',
            name: '@gjsify/A',
            deps: { '@gjsify/fs': 'workspace:*' },
        },
    ];
    for (const p of pkgs) {
        const dir = join(root, p.rel);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({ name: p.name, version: '0.0.0', dependencies: p.deps }) + '\n',
        );
    }
    return root;
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

        await it('single-pkg code change → seeds + dependents', async () => {
            const r = await runClassify(root, ['packages/node/fs/src/index.ts']);
            expect(r.global).toBe(false);
            // fs and its dependent A — closure size 2.
            expect(r.workspaces.length).toBe(2);
            expect(r.workspaces.includes('@gjsify/fs')).toBeTruthy();
            expect(r.workspaces.includes('@gjsify/A')).toBeTruthy();
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

        // Cleanup last so failing tests still surface the fixture state.
        await it('teardown', async () => {
            rmSync(root, { recursive: true, force: true });
            expect(true).toBe(true);
        });
    });
};
