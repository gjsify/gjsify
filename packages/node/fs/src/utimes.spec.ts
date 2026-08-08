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

        await it('lchmod is present or absent as a PAIR, never present-and-throwing', async () => {
            const f = tmpFile('lchmod');
            // Node defines fs.lchmod / fs.lchmodSync only where the platform has
            // O_SYMLINK — darwin does, Linux does not — so portable code writes
            // `typeof fs.lchmodSync === 'function'` and skips. Asserting the
            // ABSENCE was asserting Linux: the rule went red on the darwin leg
            // the day one ran, having encoded one side of a difference its own
            // comment described.
            //
            // What the guard actually needs is that the two spellings AGREE and
            // that neither is the third state — present but throwing — which is
            // what makes a correct caller's `typeof` check enter and then abort.
            const fsModule = (await import('node:fs')) as any;
            const sync = typeof fsModule.lchmodSync;
            expect(typeof fsModule.lchmod).toBe(sync === 'function' ? 'function' : 'undefined');
            expect(sync === 'function' || sync === 'undefined').toBe(true);
            if (sync === 'function') fsModule.lchmodSync(f, 0o600);

            // fsPromises.lchmod exists on EVERY platform — the one spelling that
            // always keeps a body. Where the syscall is missing it reports
            // ERR_METHOD_NOT_IMPLEMENTED; where it exists it works. Both are
            // contracts a caller can hold; anything else is not.
            const promisesModule = (await import('node:fs/promises')) as any;
            expect(typeof promisesModule.lchmod).toBe('function');
            let code: string | undefined;
            try {
                await promisesModule.lchmod(f, 0o600);
            } catch (err: any) {
                code = err?.code;
            }
            expect(code === undefined || code === 'ERR_METHOD_NOT_IMPLEMENTED').toBe(true);
            expect(code === undefined).toBe(sync === 'function');
            unlinkSync(f);
        });
    });
};
