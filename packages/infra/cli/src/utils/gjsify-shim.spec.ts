// SPDX-License-Identifier: MIT
// Unit tests for the self-shim DECISION (`needsSelfShim`).
//
// The decision is what regressed a platform leg, and it is the half that can be
// asserted from any host: it takes the runtime and the two paths as parameters
// rather than reading them ambiently, so the bootstrap case that only Windows
// can HIT is still checkable on Linux.
//
// What this cannot cover, and what does cover it: that cmd.exe actually
// executes the emitted `gjsify.cmd` — that is `windows-suites.yml`, whose
// `Bootstrap the toolchain` step is a cold tree driven by a bootstrap CLI and
// therefore fails the moment this decision returns the wrong answer.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from '@gjsify/unit';
import { buildSelfShimScript, needsSelfShim, pathWithoutSelfShim } from './gjsify-shim.js';

export default async () => {
    await describe('needsSelfShim', async () => {
        // Under GJS the npm bin is the NODE entry, which a node-free sandbox
        // (Flatpak) cannot run at all — so the shim is unconditional there and
        // the location of the entry is irrelevant.
        await it('is always needed under GJS, wherever the entry lives', async () => {
            expect(
                needsSelfShim({
                    gjs: true,
                    selfEntry: '/repo/packages/infra/cli/dist/cli.gjs.mjs',
                    workspaceRoot: '/repo',
                }),
            ).toBe(true);
        });

        // The tree's own CLI is running: `node_modules/.bin/gjsify` is the CLI
        // the tree wants, and shadowing it would move in-repo nested builds off
        // the GJS bundle the shim prefers.
        await it('is not needed when the running CLI lives inside the workspace', async () => {
            expect(
                needsSelfShim({
                    gjs: false,
                    selfEntry: '/repo/packages/infra/cli/lib/index.js',
                    workspaceRoot: '/repo',
                }),
            ).toBe(false);
        });

        // The regression this exists for: `npx --yes @gjsify/cli@latest run
        // build:infra` on an installed-but-unbuilt tree. `.bin/gjsify` exists
        // and every target it dispatches to does not, so the first nested
        // `gjsify` dies with `Cannot find module …/lib/index.js`.
        await it('is needed for an npx bootstrap CLI outside the workspace', async () => {
            expect(
                needsSelfShim({
                    gjs: false,
                    selfEntry: '/home/u/.npm/_npx/abc123/node_modules/@gjsify/cli/lib/index.js',
                    workspaceRoot: '/repo',
                }),
            ).toBe(true);
        });

        await it('is needed for a globally installed CLI', async () => {
            expect(
                needsSelfShim({
                    gjs: false,
                    selfEntry: '/usr/lib/node_modules/@gjsify/cli/lib/index.js',
                    workspaceRoot: '/repo',
                }),
            ).toBe(true);
        });

        // A sibling directory sharing a name prefix is OUTSIDE the workspace.
        // A plain `startsWith(root)` string test gets this wrong, which is why
        // the check goes through `relative()`.
        await it('treats a prefix-sharing sibling directory as outside', async () => {
            expect(
                needsSelfShim({
                    gjs: false,
                    selfEntry: '/repo-vendor/node_modules/@gjsify/cli/lib/index.js',
                    workspaceRoot: '/repo',
                }),
            ).toBe(true);
        });

        // Windows spellings, asserted from a Linux host — the same trick
        // `bin-shim.spec.ts` uses. `relative()` is POSIX-semantics here, so
        // what is pinned is the shape of the answer, not drive-letter parsing.
        await it('answers for a POSIX-spelled tree the same way regardless of separator style', async () => {
            expect(
                needsSelfShim({
                    gjs: false,
                    selfEntry: '/c/Users/runneradmin/AppData/npm-cache/_npx/x/node_modules/@gjsify/cli/lib/index.js',
                    workspaceRoot: '/c/a/gjsify/gjsify',
                }),
            ).toBe(true);
        });
    });

    await describe('pathWithoutSelfShim', async () => {
        // The shim is prepended to the CLI's own PATH, so `self-update` resolving
        // `gjsify` there found the running (old) version and reported a failed update.
        await it('drops the self-shim dir and keeps every other entry in order', async () => {
            expect(
                pathWithoutSelfShim('/tmp/gjsify-shim-x:/home/u/.local/bin:/usr/bin', '/tmp/gjsify-shim-x', ':'),
            ).toBe('/home/u/.local/bin:/usr/bin');
        });

        await it('leaves PATH untouched when no shim is active', async () => {
            expect(pathWithoutSelfShim('/tmp/gjsify-shim-x:/usr/bin', undefined, ':')).toBe(
                '/tmp/gjsify-shim-x:/usr/bin',
            );
        });

        // An npx temp bin is the user's shell's real winner for that run; only
        // OUR dir is removed, so `verifyPathResolution` still reports it.
        await it('keeps a different gjsify-shim dir', async () => {
            expect(pathWithoutSelfShim('/tmp/gjsify-shim-y:/usr/bin', '/tmp/gjsify-shim-x', ':')).toBe(
                '/tmp/gjsify-shim-y:/usr/bin',
            );
        });

        await it('splits on the given separator (win32)', async () => {
            expect(pathWithoutSelfShim('C:\\Temp\\gjsify-shim-x;C:\\bin', 'C:\\Temp\\gjsify-shim-x', ';')).toBe(
                'C:\\bin',
            );
        });
    });

    // `gjsify workspace <pkg> build` on macOS died in the CHILD with `Failed to load
    // shared library 'libgjsifyterminal.dylib'`: the self-shim is a `/bin/sh` script,
    // SIP strips `DYLD_*` at that exec, and the child `gjs` lost the loader path.
    await describe('buildSelfShimScript', async () => {
        const dyldEnv = { DYLD_LIBRARY_PATH: "/n m/prebuilds/darwin-arm64:/it's", PATH: '/usr/bin', HOME: '/h' };

        await it('re-exports every set DYLD_* variable on darwin', async () => {
            const script = buildSelfShimScript({
                interpreter: 'gjs',
                interpreterArgs: ['-m'],
                target: '/cli.gjs.mjs',
                platform: 'darwin',
                env: { ...dyldEnv, DYLD_FALLBACK_LIBRARY_PATH: '/usr/local/lib', DYLD_EMPTY: '' },
            });
            expect(script).toBe(
                '#!/bin/sh\n' +
                    "DYLD_FALLBACK_LIBRARY_PATH='/usr/local/lib'\nexport DYLD_FALLBACK_LIBRARY_PATH\n" +
                    "DYLD_LIBRARY_PATH='/n m/prebuilds/darwin-arm64:/it'\\''s'\nexport DYLD_LIBRARY_PATH\n" +
                    'exec "gjs" -m "/cli.gjs.mjs" "$@"\n',
            );
        });

        // LD_LIBRARY_PATH crosses `/bin/sh` untouched on Linux; baking would only
        // freeze a value the child already inherits.
        await it('adds nothing off darwin', async () => {
            const script = buildSelfShimScript({
                interpreter: 'gjs',
                interpreterArgs: ['-m'],
                target: '/cli.gjs.mjs',
                platform: 'linux',
                env: dyldEnv,
            });
            expect(script).toBe('#!/bin/sh\nexec "gjs" -m "/cli.gjs.mjs" "$@"\n');
        });

        // The EFFECT, through a real `/bin/sh`: the interpreter is this (unprotected)
        // Node, so the value it prints is what a child `gjs` would have seen. On macOS
        // a shim without the preamble prints nothing here.
        await it('delivers DYLD_LIBRARY_PATH to the interpreter it execs', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-self-shim-spec-'));
            try {
                const probe = join(dir, 'probe.mjs');
                writeFileSync(probe, 'process.stdout.write(process.env.DYLD_LIBRARY_PATH ?? "<unset>");\n');
                const shim = join(dir, 'gjsify');
                const env = { ...process.env, DYLD_LIBRARY_PATH: '/probe/prebuilds' };
                writeFileSync(
                    shim,
                    buildSelfShimScript({ interpreter: process.execPath, interpreterArgs: [], target: probe, env }),
                    { mode: 0o755 },
                );
                const res = spawnSync('/bin/sh', [shim], { env, encoding: 'utf8' });
                expect(res.stdout).toBe('/probe/prebuilds');
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });
};
