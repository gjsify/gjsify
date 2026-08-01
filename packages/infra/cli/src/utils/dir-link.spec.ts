// SPDX-License-Identifier: MIT
// Unit tests for portable directory linking.
//
// The whole point of this file: the WINDOWS branch is exercised HERE, on Linux,
// by injecting the link type into a pure function. That branch is why the file
// exists — `dlx-cache.ts` created a directory *symlink*, which Windows refuses
// without elevation, and every non-elevated user hit `EPERM` on a plain
// `npx @gjsify/cli@latest showcase …`. Nothing in CI runs on Windows, so an
// injected `'junction'` is the ONLY way that branch is ever executed; the same
// reasoning (and the same shape) as `detect-native-packages.spec.ts`.
//
// What is NOT covered here, and cannot be off-host: whether Windows actually
// accepts the junction. That needs a Windows runner. What IS covered is the
// thing that was wrong — which spelling of the target each platform gets.

import { describe, it, expect } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, lstatSync, readlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { dirLinkTarget, linkDirSync, replicateLinkSync } from './dir-link.js';

export default async () => {
    await describe('dirLinkTarget', async () => {
        await it('gives Windows an ABSOLUTE target, because a junction demands one', async () => {
            // Node resolves a junction target against the process CWD, not the
            // link's directory, so a relative target would point elsewhere.
            const link = join('/tmp', 'cache', 'pkg');
            const target = join('/tmp', 'cache', 'abc123');
            expect(dirLinkTarget(link, target, 'junction')).toBe(resolve(target));
        });

        await it('gives POSIX a RELATIVE target, so the tree survives being moved', async () => {
            const link = join('/tmp', 'cache', 'pkg');
            const target = join('/tmp', 'cache', 'abc123');
            expect(dirLinkTarget(link, target, undefined)).toBe('abc123');
        });

        await it('keeps the two spellings distinct for a nested target', async () => {
            const link = join('/tmp', 'cache', 'sub', 'pkg');
            const target = join('/tmp', 'cache', 'abc123');
            expect(dirLinkTarget(link, target, undefined)).toBe(join('..', 'abc123'));
            expect(dirLinkTarget(link, target, 'junction')).toBe(resolve(target));
        });
    });

    await describe('linkDirSync', async () => {
        await it('rejects a relative target on EVERY platform', async () => {
            // Rejected everywhere rather than only where it misbehaves: the bug
            // would otherwise be invisible until it reached the one host nobody
            // tests on.
            let threw = false;
            try {
                linkDirSync(join(tmpdir(), 'irrelevant'), join('relative', 'target'));
            } catch (e) {
                threw = true;
                expect(String(e)).toContain('must be an absolute path');
            }
            expect(threw).toBe(true);
        });

        await it('creates a usable link to a directory', async () => {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-dir-link-'));
            try {
                const target = join(root, 'real');
                mkdirSync(target);
                const link = join(root, 'link');
                linkDirSync(link, target);
                expect(lstatSync(link).isSymbolicLink()).toBe(true);
                // POSIX spelling is relative; assert what it points AT, not how.
                expect(resolve(root, readlinkSync(link))).toBe(target);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });

    await describe('replicateLinkSync', async () => {
        await it('preserves a relative target verbatim on POSIX', async () => {
            // Copying the target verbatim is right here and wrong on Windows —
            // the asymmetry the function exists for.
            const root = mkdtempSync(join(tmpdir(), 'gjsify-dir-link-'));
            try {
                const target = join(root, 'real');
                mkdirSync(target);
                const src = join(root, 'src-link');
                linkDirSync(src, target);
                const dst = join(root, 'dst-link');
                replicateLinkSync(src, dst);
                expect(readlinkSync(dst)).toBe(readlinkSync(src));
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('copies a DANGLING link as-is instead of inventing a kind', async () => {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-dir-link-'));
            try {
                const src = join(root, 'dangling');
                linkDirSync(src, join(root, 'gone'));
                const dst = join(root, 'copy');
                replicateLinkSync(src, dst);
                expect(readlinkSync(dst)).toBe(readlinkSync(src));
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });
};
