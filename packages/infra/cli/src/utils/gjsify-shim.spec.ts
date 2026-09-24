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

import { describe, it, expect } from '@gjsify/unit';
import { needsSelfShim, pathWithoutSelfShim } from './gjsify-shim.js';

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
};
