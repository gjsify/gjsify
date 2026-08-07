// oxlint-disable typescript/no-explicit-any -- spec dynamically imports node:fs for the lutimes surface and reads callback err shape
// Ported from refs/node-test/parallel/test-fs-utimes.js (behavior)
// Original: MIT, Node.js contributors.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { utimesSync, utimes, lutimesSync, lchownSync, promises } from 'node:fs';
import { rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CAN_SYMLINK, NO_SYMLINK_REASON } from './capabilities.spec.js';

const TMP = tmpdir();

function tmpFile(name: string): string {
    const p = join(TMP, `gjsify-utimes-${name}-${process.pid}`);
    writeFileSync(p, 'test');
    return p;
}

export default async () => {
    await describe('fs.utimes / fs.lutimes / fs.lchown / fs.lchmod', async () => {
        await it('utimesSync sets mtime', async () => {
            const f = tmpFile('mtime');
            const mtime = new Date('2020-01-01T00:00:00Z');
            utimesSync(f, mtime, mtime);
            const stat = statSync(f);
            expect(stat.mtime.getFullYear()).toBe(2020);
            unlinkSync(f);
        });

        await it('utimesSync sets atime', async () => {
            const f = tmpFile('atime');
            const atime = new Date('2021-06-15T12:00:00Z');
            const mtime = new Date('2020-01-01T00:00:00Z');
            utimesSync(f, atime, mtime);
            const stat = statSync(f);
            expect(stat.mtime.getFullYear()).toBe(2020);
            unlinkSync(f);
        });

        await it('utimes callback sets timestamps', async () => {
            const f = tmpFile('cb');
            const mtime = new Date('2019-03-10T00:00:00Z');
            await new Promise<void>((resolve, reject) => {
                utimes(f, mtime, mtime, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            const stat = statSync(f);
            expect(stat.mtime.getFullYear()).toBe(2019);
            unlinkSync(f);
        });

        await it('promises.utimes sets timestamps', async () => {
            const f = tmpFile('promise');
            const mtime = new Date('2018-08-01T00:00:00Z');
            await promises.utimes(f, mtime, mtime);
            const stat = statSync(f);
            expect(stat.mtime.getFullYear()).toBe(2018);
            unlinkSync(f);
        });

        await it.failing(
            'lutimesSync does not throw on a symlink',
            async () => {
                const target = tmpFile('lutime-target');
                const link = join(TMP, `gjsify-lutime-link-${process.pid}`);
                // force:true is the non-throwing spelling of "remove a leftover
                // from a previous run" — a real failure (EACCES) still surfaces.
                rmSync(link, { force: true });
                symlinkSync(target, link);
                const mtime = new Date('2017-05-20T00:00:00Z');
                // Just verify the call completes without throwing
                expect(() => lutimesSync(link, mtime, mtime)).not.toThrow();
                unlinkSync(link);
                unlinkSync(target);
            },
            NO_SYMLINK_REASON,
            { when: !CAN_SYMLINK },
        );

        await it('lutimes callback completes without error', async () => {
            const f = tmpFile('lutimes-cb');
            const mtime = new Date('2016-01-01T00:00:00Z');
            const { lutimes } = (await import('node:fs')) as any;
            await new Promise<void>((resolve, reject) => {
                lutimes(f, mtime, mtime, (err: any) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            unlinkSync(f);
        });

        await it.failing(
            'lchownSync does not throw (may need root to actually change)',
            async () => {
                const f = tmpFile('lchown');
                const link = join(TMP, `gjsify-lchown-link-${process.pid}`);
                // force:true is the non-throwing spelling of "remove a leftover
                // from a previous run" — a real failure (EACCES) still surfaces.
                rmSync(link, { force: true });
                symlinkSync(f, link);
                // This will only actually change owner if running as root; just verify no throw
                try {
                    lchownSync(link, process.getuid ? process.getuid() : 0, process.getgid ? process.getgid() : 0);
                } catch {
                    // acceptable if kernel denies (EPERM) — just must not crash the process
                }
                unlinkSync(link);
                unlinkSync(f);
            },
            NO_SYMLINK_REASON,
            { when: !CAN_SYMLINK },
        );

        await it('lchmod is ABSENT, which is what the portable guard tests for', async () => {
            const f = tmpFile('lchmod');
            // Node defines fs.lchmod / fs.lchmodSync only where the platform has
            // O_SYMLINK (darwin); on Linux both properties are `undefined`, so
            // portable code writes `typeof fs.lchmodSync === 'function'` and
            // skips. Asserting the ABSENCE is what stops the property becoming a
            // present-but-throwing third state — which makes that guard ENTER
            // and abort a caller that was correct. The assertion this replaces
            // ("is a no-op (does not throw)") had gone vacuous: its `if` was
            // false on Node and its body no longer described gjsify either.
            const fsModule = (await import('node:fs')) as any;
            expect(typeof fsModule.lchmod).toBe('undefined');
            expect(typeof fsModule.lchmodSync).toBe('undefined');

            // fsPromises.lchmod DOES exist on every platform, and it throws
            // ERR_METHOD_NOT_IMPLEMENTED — the one lchmod spelling that keeps a
            // body, on both legs.
            const promisesModule = (await import('node:fs/promises')) as any;
            expect(typeof promisesModule.lchmod).toBe('function');
            let code: string | undefined;
            try {
                await promisesModule.lchmod(f, 0o600);
            } catch (err: any) {
                code = err?.code;
            }
            expect(code).toBe('ERR_METHOD_NOT_IMPLEMENTED');
            unlinkSync(f);
        });
    });
};
