// oxlint-disable typescript/no-explicit-any -- spec wraps fd callback APIs in new Promise<any> and reads the dynamically-shaped Stats result
// Ported from refs/node-test/parallel/test-fs-read-sync.js + test-fs-write-sync.js (behavior)
// Original: MIT, Node.js contributors.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect, on } from '@gjsify/unit';
import { isWin32 } from '@gjsify/utils/core';
import {
    openSync,
    closeSync,
    fstatSync,
    fstat,
    ftruncateSync,
    fdatasync,
    fsync,
    fchmodSync,
    readSync,
    writeSync,
    readv,
    writev,
    exists,
    openAsBlob,
    promises,
    writeFileSync,
    unlinkSync,
    readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const TMP = tmpdir();

function tmpFile(name: string, content = 'hello world'): string {
    const p = join(TMP, `gjsify-fdops-${name}-${process.pid}`);
    writeFileSync(p, content);
    return p;
}

export default async () => {
    await describe('fs fd-based operations', async () => {
        await it('fstatSync returns Stats with correct size', async () => {
            const f = tmpFile('fstat', 'hello');
            const fd = openSync(f, 'r');
            try {
                const st = fstatSync(fd);
                expect(st.size).toBe(5);
                expect(typeof st.mtime).toBe('object');
            } finally {
                closeSync(fd);
                unlinkSync(f);
            }
        });

        await it('fstat callback returns Stats', async () => {
            const f = tmpFile('fstat-cb', 'world');
            const fd = openSync(f, 'r');
            try {
                const st = await new Promise<any>((resolve, reject) => {
                    fstat(fd, (err, s) => (err ? reject(err) : resolve(s)));
                });
                expect(st.size).toBe(5);
            } finally {
                closeSync(fd);
                unlinkSync(f);
            }
        });

        await it('promises.fstat returns Stats', async () => {
            const f = tmpFile('fstat-p', 'gjsify');
            const fh = await promises.open(f, 'r');
            try {
                const st = await fh.stat();
                expect(st.size).toBe(6);
            } finally {
                await fh.close();
                unlinkSync(f);
            }
        });

        await it('ftruncateSync truncates file', async () => {
            const f = tmpFile('ftrunc', '0123456789');
            const fd = openSync(f, 'r+');
            try {
                ftruncateSync(fd, 4);
                const data = readFileSync(f, 'utf8');
                expect(data).toBe('0123');
            } finally {
                closeSync(fd);
                unlinkSync(f);
            }
        });

        await it('fdatasync callback completes without error', async () => {
            const f = tmpFile('fdatasync', 'data');
            const fd = openSync(f, 'r+');
            try {
                await new Promise<void>((resolve, reject) => {
                    fdatasync(fd, (err) => (err ? reject(err) : resolve()));
                });
            } finally {
                closeSync(fd);
                unlinkSync(f);
            }
        });

        await it('fsync callback completes without error', async () => {
            const f = tmpFile('fsync', 'data');
            const fd = openSync(f, 'r+');
            try {
                await new Promise<void>((resolve, reject) => {
                    fsync(fd, (err) => (err ? reject(err) : resolve()));
                });
            } finally {
                closeSync(fd);
                unlinkSync(f);
            }
        });

        await it.failing(
            'fchmodSync changes file permissions',
            async () => {
                const f = tmpFile('fchmod', 'x');
                const fd = openSync(f, 'r');
                try {
                    fchmodSync(fd, 0o600);
                    const st = fstatSync(fd);
                    expect(st.mode & 0o777).toBe(0o600);
                } finally {
                    closeSync(fd);
                    unlinkSync(f);
                }
            },
            'NTFS carries no POSIX permission bits, so Node reports 0o666 (0o444 when the read-only attribute is set) whatever mode was requested. The read-only case DOES work and is asserted unmarked elsewhere; the rest cannot be represented on win32.',
            { when: isWin32() },
        );

        await it('closeSync closes the fd', async () => {
            const f = tmpFile('close', 'c');
            const fd = openSync(f, 'r');
            closeSync(fd);
            expect(() => fstatSync(fd)).toThrow();
            unlinkSync(f);
        });

        await it('readSync reads bytes from position 0', async () => {
            const f = tmpFile('rsync', 'abcdef');
            const fd = openSync(f, 'r');
            try {
                const buf = Buffer.alloc(3);
                const n = readSync(fd, buf, 0, 3, 0);
                expect(n).toBe(3);
                expect(buf.toString()).toBe('abc');
            } finally {
                closeSync(fd);
                unlinkSync(f);
            }
        });

        await it('readSync reads into buffer at offset', async () => {
            const f = tmpFile('rsync-off', 'hello');
            const fd = openSync(f, 'r');
            try {
                const buf = Buffer.alloc(8);
                const n = readSync(fd, buf, 2, 5, 0);
                expect(n).toBe(5);
                expect(buf.slice(2, 7).toString()).toBe('hello');
            } finally {
                closeSync(fd);
                unlinkSync(f);
            }
        });

        await it('readSync with position:null advances the fd position and terminates', async () => {
            // Regression: `_readSync` used to open a fresh stream at offset 0 on every
            // call, so a `readSync(fd, buf, 0, len, null)` loop re-read the first chunk
            // forever (the build-cache hashFileStream hang). It must advance + hit EOF.
            const f = tmpFile('rsync-seq', 'abcdefghij');
            const fd = openSync(f, 'r');
            try {
                const buf = Buffer.alloc(3);
                let out = '';
                let n: number;
                let guard = 0;
                while ((n = readSync(fd, buf, 0, buf.length, null)) > 0) {
                    out += buf.slice(0, n).toString();
                    if (++guard > 100) throw new Error('readSync(position:null) did not terminate');
                }
                expect(out).toBe('abcdefghij');
            } finally {
                closeSync(fd);
                unlinkSync(f);
            }
        });

        await it('writeSync writes bytes to file', async () => {
            const f = tmpFile('wsync', '-----');
            const fd = openSync(f, 'r+');
            try {
                const n = writeSync(fd, Buffer.from('XYZ'), 0, 3, 0);
                expect(n).toBe(3);
                closeSync(fd);
                expect(readFileSync(f, 'utf8').slice(0, 3)).toBe('XYZ');
            } finally {
                unlinkSync(f);
            }
        });

        await it('readv reads into multiple buffers', async () => {
            const f = tmpFile('readv', 'abcdef');
            const fd = openSync(f, 'r');
            try {
                const b1 = Buffer.alloc(2);
                const b2 = Buffer.alloc(3);
                await new Promise<void>((resolve, reject) => {
                    readv(fd, [b1, b2], 0, (err, bytesRead) => {
                        if (err) return reject(err);
                        expect(bytesRead).toBe(5);
                        expect(b1.toString()).toBe('ab');
                        expect(b2.toString()).toBe('cde');
                        resolve();
                    });
                });
            } finally {
                closeSync(fd);
                unlinkSync(f);
            }
        });

        await it('writev writes multiple buffers', async () => {
            const f = tmpFile('writev', '------');
            const fd = openSync(f, 'r+');
            try {
                const b1 = Buffer.from('AB');
                const b2 = Buffer.from('CDE');
                await new Promise<void>((resolve, reject) => {
                    writev(fd, [b1, b2], 0, (err, bytesWritten) => {
                        if (err) return reject(err);
                        expect(bytesWritten).toBe(5);
                        resolve();
                    });
                });
                closeSync(fd);
                expect(readFileSync(f, 'utf8').slice(0, 5)).toBe('ABCDE');
            } finally {
                unlinkSync(f);
            }
        });

        await it('exists returns true for existing path, false for missing', async () => {
            const f = tmpFile('exists', 'e');
            const existing = await new Promise<boolean>((resolve) => {
                exists(f, (v) => resolve(v));
            });
            expect(existing).toBe(true);
            const missing = await new Promise<boolean>((resolve) => {
                exists(join(TMP, 'gjsify-nonexistent-xyz-123'), (v) => resolve(v));
            });
            expect(missing).toBe(false);
            unlinkSync(f);
        });

        // `exists` is the one entry point in `node:fs` whose callback takes
        // `(exists)` rather than `(err, value)`, and the three rules below were
        // broken together in nine lines. Oracle for every expectation: node
        // v24.19.0.
        await it('exists answers on a later tick, on both branches', async () => {
            // Node reads the answer out of `fs.access`'s async completion, so
            // `exists(p, cb)` RETURNS before `cb` runs. Ours answered in place
            // on both branches: the hit from inside the try, the miss from the
            // catch, which is why both are asserted rather than just the hit.
            const f = tmpFile('exists-tick', 'e');
            try {
                const hit: string[] = [];
                await new Promise<void>((resolve) => {
                    exists(f, (v) => {
                        hit.push(`cb:${v}`);
                        resolve();
                    });
                    hit.push('returned');
                });
                expect(hit).toStrictEqual(['returned', 'cb:true']);

                const miss: string[] = [];
                await new Promise<void>((resolve) => {
                    exists(join(TMP, 'gjsify-nonexistent-xyz-123'), (v) => {
                        miss.push(`cb:${v}`);
                        resolve();
                    });
                    miss.push('returned');
                });
                expect(miss).toStrictEqual(['returned', 'cb:false']);
            } finally {
                unlinkSync(f);
            }
        });

        await it('exists enters a throwing callback once, with the real answer', async () => {
            // The call used to sit INSIDE the try around `statSync`, so a
            // callback that threw was caught and re-entered with `false`: the
            // caller's own exception came back to them as a filesystem answer,
            // and an existing file read as missing. Node lets the throw reach
            // the host instead.
            //
            // Same rule as `fs-semantics.spec.ts` K-19 for `mkdtemp`, and the
            // callback has to be allowed to throw for the count to mean
            // anything — but it cannot be asserted the same way. Measured on
            // node v24.19.0: a throw out of the callback of `exists`, `stat` or
            // `access` reaches the host as `uncaughtException`, while `mkdtemp`
            // is the one entry point whose does NOT escape at all. K-19 needs no
            // absorber because Node swallows its throw; this one does, or the
            // runner charges the escape to the test that armed it.
            //
            // A listener the spec installs itself is exactly the signal
            // `@gjsify/unit` reads as "this escape is deliberate" — it
            // downgrades to a non-gating warning. On GJS nothing emits these
            // events, so there the throw is invisible and `calls` carries the
            // whole rule.
            const f = tmpFile('exists-throw', 'e');
            const absorbed: string[] = [];
            const absorb = (err: unknown) => {
                absorbed.push(String((err as Error)?.message ?? err));
            };
            process.on('uncaughtException', absorb);
            process.on('unhandledRejection', absorb);
            try {
                let calls = 0;
                let answered: boolean | undefined;
                await new Promise<void>((resolve) => {
                    exists(f, (v) => {
                        calls++;
                        answered = v;
                        setTimeout(resolve, 20);
                        throw new Error('from the callback');
                    });
                });
                expect(calls).toBe(1);
                expect(answered).toBe(true);
                // The absorber must not be hiding anything else: a listener that
                // anticipates ONE error is otherwise equally deaf to a real one
                // escaping beside it.
                expect(absorbed.every((m) => m === 'from the callback')).toBe(true);
            } finally {
                process.removeListener('uncaughtException', absorb);
                process.removeListener('unhandledRejection', absorb);
                unlinkSync(f);
            }
        });

        await it('promisify(exists) resolves the boolean instead of rejecting it', async () => {
            // Node defines `util.promisify.custom` on `fs.exists` precisely
            // because the callback is `(exists)`: without it the promisified
            // form reads that lone `true` as an `err` and REJECTS where Node
            // resolves `true` — so `await promisify(fs.exists)(p)` threw for
            // every path that exists.
            const f = tmpFile('exists-promisify', 'e');
            try {
                expect(typeof (exists as unknown as Record<symbol, unknown>)[promisify.custom]).toBe('function');
                const existsAsync = promisify(exists);
                expect(await existsAsync(f)).toBe(true);
                expect(await existsAsync(join(TMP, 'gjsify-nonexistent-xyz-123'))).toBe(false);
            } finally {
                unlinkSync(f);
            }
        });

        await it('openAsBlob returns Blob with correct size', async () => {
            const f = tmpFile('blob', 'blobdata');
            const blob = await openAsBlob(f);
            expect(blob.size).toBe(8);
            expect(blob instanceof Blob).toBe(true);
            unlinkSync(f);
        });

        // Standard descriptors (stdin=0, stdout=1, stderr=2). Regression: a
        // numeric std fd used to be coerced to the relative PATH "0"/"1"/"2"
        // and thrown as ENOENT ("No instance found for fd!"), breaking the Node
        // stdin idiom `readFileSync(0)` every bundled npm package relies on.
        // The read side (fd 0) needs a real pipe → tests/e2e/fs-std-fd; the
        // write side is asserted here on both runtimes (Node's real fs and, via
        // the `node:fs`→`@gjsify/fs` alias, our GJS impl).
        await it('writeSync to a std fd (stderr) returns the byte count', async () => {
            expect(writeSync(2, Buffer.alloc(0))).toBe(0);
            expect(writeSync(2, Buffer.from('gjsify-std-fd\n'))).toBe(14);
        });

        await on('Gjs', async () => {
            const { isStdFd, STDIN_FD, STDOUT_FD, STDERR_FD } = await import('./std-fd.js');

            await it('isStdFd recognises only 0/1/2', async () => {
                expect(isStdFd(STDIN_FD)).toBeTruthy();
                expect(isStdFd(STDOUT_FD)).toBeTruthy();
                expect(isStdFd(STDERR_FD)).toBeTruthy();
                expect(isStdFd(3)).toBeFalsy();
                expect(isStdFd(-1)).toBeFalsy();
            });

            await it('closeSync on a std fd is a no-op — never closes the process stdio', async () => {
                // On Node this would close real stdout and take down the runner,
                // so it is a GJS-only assertion against our impl.
                closeSync(STDOUT_FD);
                expect(writeSync(STDOUT_FD, Buffer.alloc(0))).toBe(0);
            });
        });
    });
};
