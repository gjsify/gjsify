// SPDX-License-Identifier: MIT
// The four conditions under which a PROJECT install acquires the GJS bundler
// engine — i.e. the decision that closes #1005.
//
// Why this exists at all, and why as a unit spec rather than only as the
// end-to-end recipe in the PR: the gap shipped because the documented consumer
// path was never EXERCISED. `@gjsify/rolldown-native` is an optional peer, npm
// 7+ skips optional peers, gjsify's native backend does not resolve
// peerDependencies at all, and `installGjsEnginePackages()` was wired into the
// global path only. Every one of those four facts is individually defensible;
// their conjunction meant `gjsify build` could not work for any consumer on a
// GJS host, and nothing said so. So the fix needs a check that fails if any of
// the four conditions is quietly widened or narrowed later.
//
// Driven through injected seams (`installFn`, `hasEngineFn`, `cwd`) rather than
// a mock registry, for the reason `installGjsEnginePackages`'s own docblock
// gives for its `installFn`: the DECISION is what can regress, and a registry
// adds nothing to it while making the test slow and host-dependent. The
// registry-shaped half is covered by `tests/e2e/global-install-engine`, and the
// real-world proof is reproducible in four lines (see the PR body).

import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureProjectGjsEngine } from './install.js';

/** A project tree that either does or does not carry `@gjsify/cli`. */
function makeProject(withCli: boolean, cliVersion = '9.9.9'): string {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-project-engine-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'consumer', version: '1.0.0' }));
    if (withCli) {
        const cliDir = join(dir, 'node_modules', '@gjsify', 'cli');
        mkdirSync(cliDir, { recursive: true });
        writeFileSync(join(cliDir, 'package.json'), JSON.stringify({ name: '@gjsify/cli', version: cliVersion }));
    }
    return dir;
}

/** Minimal InstallOptions — only the fields the decision reads. */
function opts(over: Record<string, unknown> = {}) {
    return { verbose: false, timeout: 0, ...over } as Parameters<typeof ensureProjectGjsEngine>[0];
}

/** Record every install the decision asks for. */
function recorder() {
    const calls: Array<{ prefix: string; version: string }> = [];
    return {
        calls,
        installFn: async (prefix: string, version: string) => {
            calls.push({ prefix, version });
        },
    };
}

export default async () => {
    await describe('ensureProjectGjsEngine', async () => {
        await it('installs the engine set when the host can run gjs and has none', async () => {
            const dir = makeProject(true, '0.30.0');
            const rec = recorder();
            try {
                await ensureProjectGjsEngine(opts(), true, {
                    cwd: dir,
                    installFn: rec.installFn,
                    hasEngineFn: () => false,
                });
                expect(rec.calls.length).toBe(1);
                expect(rec.calls[0]?.prefix).toBe(dir);
                // In LOCKSTEP with the CLI on disk, not `latest`: ADR 0008
                // guarantees compatibility only within a release train, so an
                // engine one release off the bundle is not a supported pairing.
                expect(rec.calls[0]?.version).toBe('0.30.0');
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('does nothing when the host cannot run gjs', async () => {
            // The ADR 0017 half: never fetch bytes the machine cannot load. A
            // Node-only host uses the npm `rolldown` crate and needs no prebuild.
            const dir = makeProject(true);
            const rec = recorder();
            try {
                await ensureProjectGjsEngine(opts(), false, {
                    cwd: dir,
                    installFn: rec.installFn,
                    hasEngineFn: () => false,
                });
                expect(rec.calls.length).toBe(0);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('does nothing when the tree has no @gjsify/cli', async () => {
            // No CLI means no caller for the engine. This is what keeps the
            // top-up off every unrelated `gjsify install` in a foreign project.
            const dir = makeProject(false);
            const rec = recorder();
            try {
                await ensureProjectGjsEngine(opts(), true, {
                    cwd: dir,
                    installFn: rec.installFn,
                    hasEngineFn: () => false,
                });
                expect(rec.calls.length).toBe(0);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('does nothing when an engine is already reachable', async () => {
            // Asked with the same walk the BUILD uses, so the installer and the
            // builder cannot disagree about whether the engine is present. This
            // row is also what keeps the gjsify monorepo a no-op and protects
            // ADR 0001's non-destructive invariant.
            const dir = makeProject(true);
            const rec = recorder();
            try {
                await ensureProjectGjsEngine(opts(), true, {
                    cwd: dir,
                    installFn: rec.installFn,
                    hasEngineFn: () => true,
                });
                expect(rec.calls.length).toBe(0);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('installs nothing under --immutable', async () => {
            // A frozen install cannot acquire what its lockfile does not name
            // without breaking the contract --immutable exists to hold. It warns
            // and names the DURABLE fix instead — which is the only thing that
            // helps a CI leg that will be frozen again next run.
            const dir = makeProject(true);
            const rec = recorder();
            try {
                await ensureProjectGjsEngine(opts({ immutable: true }), true, {
                    cwd: dir,
                    installFn: rec.installFn,
                    hasEngineFn: () => false,
                });
                expect(rec.calls.length).toBe(0);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('falls back to latest when the CLI on disk states no version', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-project-engine-nov-'));
            const cliDir = join(dir, 'node_modules', '@gjsify', 'cli');
            mkdirSync(cliDir, { recursive: true });
            writeFileSync(join(cliDir, 'package.json'), JSON.stringify({ name: '@gjsify/cli' }));
            const rec = recorder();
            try {
                await ensureProjectGjsEngine(opts(), true, {
                    cwd: dir,
                    installFn: rec.installFn,
                    hasEngineFn: () => false,
                });
                expect(rec.calls.length).toBe(1);
                expect(rec.calls[0]?.version).toBe('latest');
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });
};
