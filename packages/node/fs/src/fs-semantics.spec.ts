// The fd-offset and permission contract of `node:fs`, asserted against the
// reference implementation.
//
// WHY THIS FILE EXISTS
//
// `@gjsify/fs` shipped three defects that a consumer streaming mail
// attachments to disk hit all at once: `writeSync` never advanced the fd
// position (a chunked writer kept only its LAST chunk), `'wx'` truncated an
// existing file instead of throwing `EEXIST`, and `mode` was parsed and
// dropped (private attachments landed world-readable). Two patch rounds fixed
// them and introduced thirty regressions between them, because nothing in the
// package measured what `open(2)`/`mkdir(2)` actually promise: of the ~50
// observable rules below, exactly two had a test.
//
// A patch with no ledger cannot be judged. This file is the ledger. It runs
// unmodified under `test.node.mjs` AND `test.gjs.mjs`, so the expected values
// are not transcribed constants an author believed — Node re-derives them on
// every run, and any divergence is a diff between the two legs.
//
// WHY THE UMASK IS MEASURED HERE AND NEVER READ
//
// `process.umask()` in `@gjsify/process` returns a hardcoded `0o22` and ignores
// its setter, so a test that trusted it would be right only on a 022 machine
// and would silently pass for the wrong reason everywhere else. There is also
// no `g_umask` binding, so a test cannot CHANGE the umask from inside GJS.
// Both problems go away by measuring the live mask from an ordinary directory
// create — a DIRECTORY, because a file probe's 0o666 base cannot observe a
// mask over the execute bits, which is exactly how the first patch round
// under-masked every requested directory mode.

import { describe, it, expect } from '@gjsify/unit';
import {
    appendFileSync,
    closeSync,
    createWriteStream,
    existsSync,
    ftruncateSync,
    fstatSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    promises as fsPromises,
    readdirSync,
    readFileSync,
    readSync,
    rmSync,
    statSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
    writeSync,
    writevSync,
    chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Buffer } from 'node:buffer';

import {
    CAN_SYMLINK,
    NO_SYMLINK_REASON,
    CAN_SETGID,
    NO_SETGID_REASON,
    CAN_PROC_FD,
    NO_PROC_FD_REASON,
} from './capabilities.spec.js';

// ─── fixtures ────────────────────────────────────────────────────────────────

/** A fresh scratch directory; every test cleans up its own. */
function scratch(name: string): string {
    return mkdtempSync(join(tmpdir(), `gjsify-fs-sem-${name}-`));
}

function drop(dir: string): void {
    try {
        rmSync(dir, { recursive: true, force: true });
    } catch {
        // Cleanup must never decide the verdict of the test it follows.
    }
}

/** Permission + special bits actually on disk, without following a symlink. */
function modeOf(path: string): number {
    return lstatSync(path).mode & 0o7777;
}

const B = (s: string) => Buffer.from(s);

/**
 * The live file-creation mask, measured from a directory create.
 *
 * `mkdir(2)` applies `mode & ~umask`, so a directory requested at 0o777 reports
 * the complement of the mask in all nine bits. A file probe would be blind to
 * the execute bits and is the wrong instrument (see the header).
 */
function measureUmask(dir: string): number {
    const probe = join(dir, '.umask-probe');
    mkdirSync(probe, { mode: 0o777 });
    const observed = modeOf(probe) & 0o777;
    rmSync(probe, { recursive: true, force: true });
    return 0o777 & ~observed;
}

/** What `open(2)` leaves on disk for `requested`: the umask masks the low nine bits only. */
function fileModeFor(requested: number, umask: number): number {
    return (requested & 0o7000) | (requested & 0o777 & ~umask);
}

/**
 * What `mkdir(2)` leaves on disk for `requested`.
 *
 * Asymmetric with {@link fileModeFor} on purpose, and the asymmetry is the
 * contract: Linux's `vfs_mkdir()` masks the requested mode to
 * `S_IRWXUGO | S_ISVTX`, so a requested setuid/setgid is DROPPED while sticky
 * survives — but a setgid INHERITED from the parent directory is kept by the
 * kernel and must never be rewritten away.
 */
function dirModeFor(requested: number, umask: number): number {
    return (requested & 0o1000) | (requested & 0o777 & ~umask);
}

export default async () => {
    // ─── 1. fd offset semantics ──────────────────────────────────────────────
    //
    // One cursor per open file description, owned by the kernel, shared by
    // reads and writes. `position: null` uses it and advances it; a numeric
    // `position` is pread/pwrite and leaves it alone.

    await describe('fs — fd offset semantics', async () => {
        await it('O-1 writeSync with no position advances the cursor', async () => {
            // THE original bug: every writeSync re-opened the file at offset 0,
            // so a chunked writer kept only its last chunk.
            const dir = scratch('o1');
            try {
                const f = join(dir, 'chunked');
                const fd = openSync(f, 'w');
                writeSync(fd, B('AAA'));
                writeSync(fd, B('BBB'));
                writeSync(fd, B('CCC'));
                closeSync(fd);
                expect(readFileSync(f, 'utf8')).toBe('AAABBBCCC');
            } finally {
                drop(dir);
            }
        });

        await it('O-2 an explicit position does not move the cursor', async () => {
            const dir = scratch('o2');
            try {
                const f = join(dir, 'pwrite');
                const fd = openSync(f, 'w');
                writeSync(fd, B('0123456789'));
                writeSync(fd, B('xx'), 0, 2, 2);
                writeSync(fd, B('E'));
                closeSync(fd);
                // 'E' lands at 10 (the cursor), not at 4 (after the pwrite).
                expect(readFileSync(f, 'utf8')).toBe('01xx456789E');
            } finally {
                drop(dir);
            }
        });

        await it('O-3 reads and writes share ONE cursor', async () => {
            const dir = scratch('o3');
            try {
                const f = join(dir, 'shared');
                writeFileSync(f, 'abcdefghij');
                const fd = openSync(f, 'r+');
                readSync(fd, Buffer.alloc(3), 0, 3, null);
                writeSync(fd, B('ZZ'));
                closeSync(fd);
                expect(readFileSync(f, 'utf8')).toBe('abcZZfghij');
            } finally {
                drop(dir);
            }
        });

        await it('O-4 a positional write on an append fd still appends', async () => {
            // Under O_APPEND the kernel ignores `position` entirely. A fix that
            // "honoured" it instead destroyed the head of the log — and gjsify's
            // own WriteStream always passed position 0, so an append stream
            // could only ever clobber. Strictly worse than the bug it replaced.
            const dir = scratch('o4');
            try {
                const f = join(dir, 'log');
                writeFileSync(f, 'HEAD');
                const fd = openSync(f, 'a');
                writeSync(fd, B('tail'), 0, 4, 0);
                closeSync(fd);
                expect(readFileSync(f, 'utf8')).toBe('HEADtail');
            } finally {
                drop(dir);
            }
        });

        await it("O-4b an append fd's reads still start at 0", async () => {
            const dir = scratch('o4b');
            try {
                const f = join(dir, 'aplus');
                writeFileSync(f, 'abc');
                const fd = openSync(f, 'a+');
                const buf = Buffer.alloc(3);
                const n = readSync(fd, buf, 0, 3, null);
                closeSync(fd);
                expect(buf.slice(0, n).toString()).toBe('abc');
            } finally {
                drop(dir);
            }
        });

        await it('O-5 an async read loop consults the cursor and terminates', async () => {
            const dir = scratch('o5');
            try {
                const f = join(dir, 'seq');
                writeFileSync(f, 'abcdefghij');
                const fh = await fsPromises.open(f, 'r');
                let out = '';
                let guard = 0;
                try {
                    const buf = Buffer.alloc(4);
                    let res = await fh.read(buf, 0, 4, null);
                    while (res.bytesRead > 0) {
                        out += buf.slice(0, res.bytesRead).toString();
                        if (++guard > 50) throw new Error('async read(position:null) did not terminate');
                        res = await fh.read(buf, 0, 4, null);
                    }
                } finally {
                    await fh.close();
                }
                expect(out).toBe('abcdefghij');
            } finally {
                drop(dir);
            }
        });

        await it('O-6 writeFile on a handle continues at the cursor', async () => {
            const dir = scratch('o6');
            try {
                const f = join(dir, 'handle-writefile');
                const fh = await fsPromises.open(f, 'w+');
                await fh.write(B('HEAD'));
                await fh.writeFile('BODY');
                await fh.close();
                expect(readFileSync(f, 'utf8')).toBe('HEADBODY');
            } finally {
                drop(dir);
            }
        });

        await it('O-6b concurrent handle writes lose nothing', async () => {
            // The cursor's read-modify-write must be indivisible. When it
            // straddled the serialization boundary both writers captured the
            // same offset and the second overwrote the first.
            const dir = scratch('o6b');
            try {
                const f = join(dir, 'concurrent');
                const fh = await fsPromises.open(f, 'w+');
                await Promise.all([fh.write(B('AAAA')), fh.write(B('BBBB'))]);
                await fh.close();
                const content = readFileSync(f, 'utf8');
                // Order is unspecified (Node calls un-awaited concurrent writes
                // unsafe); losing a payload is not.
                expect(content.length).toBe(8);
                expect(content.includes('AAAA')).toBe(true);
                expect(content.includes('BBBB')).toBe(true);
            } finally {
                drop(dir);
            }
        });

        await it('readFile on a handle reads from the cursor and consumes it', async () => {
            const dir = scratch('rfd');
            try {
                const f = join(dir, 'consume');
                writeFileSync(f, 'abcdef');
                const fh = await fsPromises.open(f, 'r');
                await fh.read(Buffer.alloc(2), 0, 2, null);
                const rest = await fh.readFile('utf8');
                await fh.close();
                expect(rest).toBe('cdef');
            } finally {
                drop(dir);
            }
        });

        await it('writevSync with position null writes the buffers back to back', async () => {
            const dir = scratch('wv');
            try {
                const f = join(dir, 'vec');
                const fd = openSync(f, 'w');
                const n = writevSync(fd, [B('AA'), B('BB'), B('CC')], null);
                closeSync(fd);
                expect(n).toBe(6);
                expect(readFileSync(f, 'utf8')).toBe('AABBCC');
            } finally {
                drop(dir);
            }
        });

        await it('a positional write past EOF leaves a hole', async () => {
            const dir = scratch('sparse');
            try {
                const f = join(dir, 'hole');
                const fd = openSync(f, 'w');
                writeSync(fd, B('Z'), 0, 1, 5);
                closeSync(fd);
                expect(Array.from(readFileSync(f))).toEqualArray([0, 0, 0, 0, 0, 90]);
            } finally {
                drop(dir);
            }
        });

        await it('a positional read past EOF returns 0 and leaves the cursor', async () => {
            const dir = scratch('pastEof');
            try {
                const f = join(dir, 'short');
                writeFileSync(f, 'abc');
                const fd = openSync(f, 'r');
                const buf = Buffer.alloc(4);
                const n1 = readSync(fd, buf, 0, 4, 100);
                const n2 = readSync(fd, buf, 0, 4, null);
                closeSync(fd);
                expect(n1).toBe(0);
                expect(buf.slice(0, n2).toString()).toBe('abc');
            } finally {
                drop(dir);
            }
        });

        await it('two fds on one path have independent cursors', async () => {
            const dir = scratch('twofd');
            try {
                const f = join(dir, 'shared');
                writeFileSync(f, 'abcdef');
                const a = openSync(f, 'r');
                const b = openSync(f, 'r');
                readSync(a, Buffer.alloc(3), 0, 3, null);
                const buf = Buffer.alloc(3);
                const n = readSync(b, buf, 0, 3, null);
                closeSync(a);
                closeSync(b);
                expect(buf.slice(0, n).toString()).toBe('abc');
            } finally {
                drop(dir);
            }
        });

        await it('wrong-direction I/O throws EBADF', async () => {
            const dir = scratch('ebadf');
            try {
                const f = join(dir, 'ro');
                writeFileSync(f, 'abc');
                const ro = openSync(f, 'r');
                let writeCode: string | undefined;
                try {
                    writeSync(ro, B('x'));
                } catch (err) {
                    writeCode = (err as NodeJS.ErrnoException).code;
                }
                closeSync(ro);

                const wo = openSync(join(dir, 'wo'), 'w');
                let readCode: string | undefined;
                try {
                    readSync(wo, Buffer.alloc(4), 0, 4, null);
                } catch (err) {
                    readCode = (err as NodeJS.ErrnoException).code;
                }
                closeSync(wo);

                expect(writeCode).toBe('EBADF');
                expect(readCode).toBe('EBADF');
            } finally {
                drop(dir);
            }
        });

        await it.failing(
            'T4 an open fd follows the inode, not the name',
            async () => {
                // The structural regression guard for "positional I/O uses the
                // fd". Any implementation that re-opens by path fails this:
                // after the unlink there is no path left to re-open, and after
                // an impostor takes the name the bytes would land in the wrong
                // file.
                const dir = scratch('t4');
                try {
                    const f = join(dir, 'victim');
                    writeFileSync(f, 'ORIGINAL');
                    const fd = openSync(f, 'r+');
                    try {
                        unlinkSync(f);
                        writeFileSync(f, 'IMPOSTOR');

                        writeSync(fd, B('XX'), 0, 2, 0);
                        const buf = Buffer.alloc(8);
                        const n = readSync(fd, buf, 0, 8, 0);

                        expect(buf.slice(0, n).toString()).toBe('XXIGINAL');
                        expect(fstatSync(fd).size).toBe(8);
                        expect(readFileSync(f, 'utf8')).toBe('IMPOSTOR');
                    } finally {
                        closeSync(fd);
                    }
                } finally {
                    drop(dir);
                }
            },
            NO_PROC_FD_REASON,
            { when: !CAN_PROC_FD },
        );

        await it('ftruncate keeps the inode and does not move the cursor', async () => {
            const dir = scratch('ftrunc');
            try {
                const f = join(dir, 'trunc');
                writeFileSync(f, '0123456789');
                const inoBefore = statSync(f).ino;
                const fd = openSync(f, 'r+');
                readSync(fd, Buffer.alloc(7), 0, 7, null);
                ftruncateSync(fd, 4);
                writeSync(fd, B('X'));
                closeSync(fd);
                expect(statSync(f).ino).toBe(inoBefore);
                expect(Array.from(readFileSync(f))).toEqualArray([48, 49, 50, 51, 0, 0, 0, 88]);
            } finally {
                drop(dir);
            }
        });
    });

    // ─── 2. open() mode ──────────────────────────────────────────────────────

    await describe('fs — open() applies mode at creation', async () => {
        await it('honours an explicit mode on the created file', async () => {
            const dir = scratch('mode');
            try {
                const umask = measureUmask(dir);
                const f = join(dir, 'secret');
                closeSync(openSync(f, 'w', 0o600));
                expect(modeOf(f)).toBe(fileModeFor(0o600, umask));
            } finally {
                drop(dir);
            }
        });

        await it('masks the default 0o666 with the live umask', async () => {
            const dir = scratch('modedef');
            try {
                const umask = measureUmask(dir);
                const f = join(dir, 'plain');
                closeSync(openSync(f, 'w'));
                expect(modeOf(f)).toBe(fileModeFor(0o666, umask));
            } finally {
                drop(dir);
            }
        });

        await it('ignores mode when the file already exists', async () => {
            const dir = scratch('modeexist');
            try {
                const umask = measureUmask(dir);
                const f = join(dir, 'existing');
                writeFileSync(f, 'x');
                const before = modeOf(f);
                closeSync(openSync(f, 'w', 0o600));
                expect(modeOf(f)).toBe(before);
                expect(before).toBe(fileModeFor(0o666, umask));
            } finally {
                drop(dir);
            }
        });

        await it('accepts mode 0 — a falsy mode is still a mode', async () => {
            const dir = scratch('mode0');
            try {
                const f = join(dir, 'zero');
                closeSync(openSync(f, 'w', 0));
                expect(modeOf(f)).toBe(0);
            } finally {
                drop(dir);
            }
        });

        await it('parses a string mode as OCTAL', async () => {
            const dir = scratch('modestr');
            try {
                const f = join(dir, 'octal');
                closeSync(openSync(f, 'w', '600' as unknown as number));
                // A JS numeric cast would give decimal 600 = 0o1130: sticky plus
                // --x-wx---, so the caller could not read back its own new file.
                expect(modeOf(f)).toBe(0o600);
            } finally {
                drop(dir);
            }
        });

        await it('keeps setuid/setgid requested on a FILE', async () => {
            const dir = scratch('modesu');
            try {
                const umask = measureUmask(dir);
                const f = join(dir, 'suid');
                closeSync(openSync(f, 'w', 0o4755));
                expect(modeOf(f)).toBe(fileModeFor(0o4755, umask));
            } finally {
                drop(dir);
            }
        });

        await it('an intervening chmod survives close', async () => {
            // Applying the mode at CLOSE reverts this, and loses the mode
            // entirely if the process dies first.
            const dir = scratch('modechmod');
            try {
                const f = join(dir, 'chmodded');
                const fd = openSync(f, 'w', 0o600);
                chmodSync(f, 0o640);
                closeSync(fd);
                expect(modeOf(f)).toBe(0o640);
            } finally {
                drop(dir);
            }
        });

        await it('the creating handle can write a mode-0444 file', async () => {
            // open(2) checks permissions once, at open. An implementation that
            // re-opens the path per write cannot honour this, and the workaround
            // for it (widen at create, narrow at close) produced six regressions.
            const dir = scratch('mode444');
            try {
                const f = join(dir, 'readonly');
                const fd = openSync(f, 'w', 0o444);
                writeSync(fd, B('AAA'));
                writeSync(fd, B('BBB'));
                closeSync(fd);
                expect(readFileSync(f, 'utf8')).toBe('AAABBB');
                expect(modeOf(f)).toBe(0o444);
            } finally {
                drop(dir);
            }
        });

        await it('writeFileSync honours { mode } on a new file', async () => {
            const dir = scratch('wfmode');
            try {
                const f = join(dir, 'secret');
                writeFileSync(f, 'x', { mode: 0o600 });
                expect(modeOf(f)).toBe(0o600);
            } finally {
                drop(dir);
            }
        });

        await it('writeFileSync honours { flag: "wx" }', async () => {
            const dir = scratch('wfflag');
            try {
                const f = join(dir, 'claim');
                writeFileSync(f, 'first', { flag: 'wx' });
                expect(() => writeFileSync(f, 'second', { flag: 'wx' })).toThrow(/EEXIST/);
                expect(readFileSync(f, 'utf8')).toBe('first');
            } finally {
                drop(dir);
            }
        });

        await it('appendFileSync honours { mode } on a new file', async () => {
            const dir = scratch('afmode');
            try {
                const f = join(dir, 'secret-log');
                appendFileSync(f, 'x', { mode: 0o600 });
                appendFileSync(f, 'y', { mode: 0o600 });
                expect(modeOf(f)).toBe(0o600);
                expect(readFileSync(f, 'utf8')).toBe('xy');
            } finally {
                drop(dir);
            }
        });

        await it('promises.writeFile does not widen an existing file', async () => {
            // `replace_async(REPLACE_DESTINATION)` explicitly discards the old
            // permissions, so a 0600 file silently came back 0644.
            const dir = scratch('pwf');
            try {
                const f = join(dir, 'secret');
                writeFileSync(f, 'x', { mode: 0o600 });
                await fsPromises.writeFile(f, 'y');
                expect(modeOf(f)).toBe(0o600);
                expect(readFileSync(f, 'utf8')).toBe('y');
            } finally {
                drop(dir);
            }
        });
    });

    // ─── 3. mkdir mode + special bits ────────────────────────────────────────

    await describe('fs — mkdir mode and special bits', async () => {
        await it('honours { mode }', async () => {
            const dir = scratch('mkmode');
            try {
                const umask = measureUmask(dir);
                const d = join(dir, 'private');
                mkdirSync(d, { mode: 0o700 });
                expect(modeOf(d)).toBe(dirModeFor(0o700, umask));
            } finally {
                drop(dir);
            }
        });

        await it('honours the legacy positional mode', async () => {
            const dir = scratch('mkpos');
            try {
                const umask = measureUmask(dir);
                const d = join(dir, 'private');
                mkdirSync(d, 0o700);
                expect(modeOf(d)).toBe(dirModeFor(0o700, umask));
            } finally {
                drop(dir);
            }
        });

        await it('defaults to 0o777 masked by the umask', async () => {
            const dir = scratch('mkdef');
            try {
                const umask = measureUmask(dir);
                const d = join(dir, 'plain');
                mkdirSync(d);
                expect(modeOf(d)).toBe(dirModeFor(0o777, umask));
            } finally {
                drop(dir);
            }
        });

        await it('applies the mode to EVERY level it creates recursively', async () => {
            const dir = scratch('mkrec');
            try {
                const umask = measureUmask(dir);
                const leaf = join(dir, 'a', 'b', 'c');
                mkdirSync(leaf, { recursive: true, mode: 0o700 });
                const want = dirModeFor(0o700, umask);
                expect(modeOf(join(dir, 'a'))).toBe(want);
                expect(modeOf(join(dir, 'a', 'b'))).toBe(want);
                expect(modeOf(leaf)).toBe(want);
            } finally {
                drop(dir);
            }
        });

        await it('promises.mkdir honours { mode }, recursive and not', async () => {
            const dir = scratch('pmk');
            try {
                const umask = measureUmask(dir);
                const want = dirModeFor(0o700, umask);
                const flat = join(dir, 'flat');
                await fsPromises.mkdir(flat, { mode: 0o700 });
                expect(modeOf(flat)).toBe(want);

                // The direct-create success path, not just the parent retry:
                // the parent already exists, so this is the common case that a
                // retry-only fix silently skipped.
                const deep = join(dir, 'deep');
                await fsPromises.mkdir(deep, { recursive: true, mode: 0o700 });
                expect(modeOf(deep)).toBe(want);

                const nested = join(dir, 'p', 'q');
                await fsPromises.mkdir(nested, { recursive: true, mode: 0o700 });
                expect(modeOf(join(dir, 'p'))).toBe(want);
                expect(modeOf(nested)).toBe(want);
            } finally {
                drop(dir);
            }
        });

        await it('DROPS a setgid requested in mode — the kernel does', async () => {
            // `vfs_mkdir()` masks to S_IRWXUGO|S_ISVTX. Node reproduces it, and
            // so must we: "honouring" an explicit setgid would hand out setgid
            // directories Node would never create.
            const dir = scratch('mksg');
            try {
                const umask = measureUmask(dir);
                const d = join(dir, 'sgid-request');
                mkdirSync(d, { mode: 0o2770 });
                expect(modeOf(d)).toBe(dirModeFor(0o2770, umask));
                expect(modeOf(d) & 0o2000).toBe(0);
            } finally {
                drop(dir);
            }
        });

        await it('KEEPS a sticky bit requested in mode', async () => {
            const dir = scratch('mkst');
            try {
                const umask = measureUmask(dir);
                const d = join(dir, 'sticky');
                mkdirSync(d, { mode: 0o1777 });
                expect(modeOf(d)).toBe(dirModeFor(0o1777, umask));
                expect(modeOf(d) & 0o1000).toBe(0o1000);
            } finally {
                drop(dir);
            }
        });

        await it.failing(
            'preserves a setgid INHERITED from the parent',
            async () => {
                // The kernel hands S_ISGID down; a post-create chmod computed
                // from a plain `mode` rewrites all twelve bits and silently
                // breaks group access for everyone else in a shared tree.
                const dir = scratch('mkinh');
                try {
                    const parent = join(dir, 'shared');
                    mkdirSync(parent, { mode: 0o775 });
                    chmodSync(parent, 0o2775);

                    const child = join(parent, 'child');
                    mkdirSync(child, { mode: 0o775 });
                    expect(modeOf(child) & 0o2000).toBe(0o2000);

                    const deep = join(parent, 'r1', 'r2');
                    mkdirSync(deep, { recursive: true, mode: 0o770 });
                    expect(modeOf(join(parent, 'r1')) & 0o2000).toBe(0o2000);
                    expect(modeOf(deep) & 0o2000).toBe(0o2000);
                } finally {
                    drop(dir);
                }
            },
            NO_SETGID_REASON,
            { when: !CAN_SETGID },
        );

        await it('does not re-apply the mode to directories that already exist', async () => {
            const dir = scratch('mkexist');
            try {
                const d = join(dir, 'a');
                mkdirSync(d, { mode: 0o755 });
                const before = modeOf(d);
                const result = mkdirSync(d, { recursive: true, mode: 0o700 });
                expect(modeOf(d)).toBe(before);
                expect(result).toBeUndefined();
            } finally {
                drop(dir);
            }
        });

        await it('reports EEXIST / ENOENT with Node error shape', async () => {
            const dir = scratch('mkerr');
            try {
                const d = join(dir, 'a');
                mkdirSync(d);
                let exists: NodeJS.ErrnoException | undefined;
                try {
                    mkdirSync(d);
                } catch (err) {
                    exists = err as NodeJS.ErrnoException;
                }
                expect(exists?.code).toBe('EEXIST');
                expect(exists?.syscall).toBe('mkdir');
                expect(exists?.path).toBe(d);

                let missing: NodeJS.ErrnoException | undefined;
                try {
                    mkdirSync(join(dir, 'nope', 'deep'));
                } catch (err) {
                    missing = err as NodeJS.ErrnoException;
                }
                expect(missing?.code).toBe('ENOENT');
            } finally {
                drop(dir);
            }
        });
    });

    // ─── 4. mkdtemp permissions ──────────────────────────────────────────────

    await describe('fs — mkdtemp is a PRIVATE scratch directory', async () => {
        await it('never grants group or other any access', async () => {
            // The one-line regression guard. `mkdtempSync` asked for 0o777 —
            // inert while mode was ignored, world-readable the moment it worked.
            const dir = scratch('mkdt');
            try {
                const t = mkdtempSync(join(dir, 't-'));
                expect(modeOf(t) & 0o077).toBe(0);
            } finally {
                drop(dir);
            }
        });

        await it('creates the directory 0700, whatever the umask', async () => {
            const dir = scratch('mkdt700');
            try {
                // mkdtemp(3) is `mkdir(path, S_IRWXU)`; the umask can only make
                // it tighter, never looser, so 0o700 is the ceiling on any host.
                expect(modeOf(mkdtempSync(join(dir, 't-'))) & ~0o700).toBe(0);
                expect(modeOf(mkdtempSync(join(dir, 'u-'))) & 0o700).toBe(0o700);
            } finally {
                drop(dir);
            }
        });

        await it('promises.mkdtemp agrees with the sync half', async () => {
            const dir = scratch('pmkdt');
            try {
                const t = await fsPromises.mkdtemp(join(dir, 't-'));
                expect(modeOf(t as string) & 0o077).toBe(0);
            } finally {
                drop(dir);
            }
        });

        await it('appends exactly six characters to the prefix', async () => {
            const dir = scratch('mkdtname');
            try {
                const prefix = join(dir, 'pre-');
                const made = mkdtempSync(prefix);
                expect(basename(made).length - basename(prefix).length).toBe(6);
                expect(existsSync(made)).toBe(true);
            } finally {
                drop(dir);
            }
        });

        await it('fails with ENOENT when the parent is missing', async () => {
            const dir = scratch('mkdterr');
            try {
                let code: string | undefined;
                try {
                    mkdtempSync(join(dir, 'nope', 't-'));
                } catch (err) {
                    code = (err as NodeJS.ErrnoException).code;
                }
                expect(code).toBe('ENOENT');
            } finally {
                drop(dir);
            }
        });
    });

    // ─── 5. exclusive create ─────────────────────────────────────────────────

    await describe('fs — exclusive create (wx / ax)', async () => {
        await it('refuses an existing file WITHOUT truncating it', async () => {
            const dir = scratch('wx');
            try {
                const f = join(dir, 'claimed');
                writeFileSync(f, 'ORIGINAL CONTENT');
                let err: NodeJS.ErrnoException | undefined;
                try {
                    openSync(f, 'wx');
                } catch (e) {
                    err = e as NodeJS.ErrnoException;
                }
                expect(err?.code).toBe('EEXIST');
                expect(err?.syscall).toBe('open');
                expect(err?.path).toBe(f);
                expect(err?.errno).toBe(-17);
                expect(readFileSync(f, 'utf8')).toBe('ORIGINAL CONTENT');
            } finally {
                drop(dir);
            }
        });

        await it.failing(
            'refuses a DANGLING symlink and does not create its target',
            async () => {
                // THE security test. `file_test(EXISTS)` follows symlinks, so a
                // dangling link read as "free" and the open created and wrote
                // THROUGH it — letting whoever planted the link choose where the
                // caller's bytes land. Real O_EXCL refuses any symlink.
                const dir = scratch('wxlink');
                try {
                    const target = join(dir, 'attacker-chosen');
                    const link = join(dir, 'link');
                    symlinkSync(target, link);
                    let code: string | undefined;
                    try {
                        openSync(link, 'wx');
                    } catch (err) {
                        code = (err as NodeJS.ErrnoException).code;
                    }
                    expect(code).toBe('EEXIST');
                    expect(existsSync(target)).toBe(false);
                } finally {
                    drop(dir);
                }
            },
            NO_SYMLINK_REASON,
            { when: !CAN_SYMLINK },
        );

        await it.failing(
            'refuses a live symlink and leaves its target untouched',
            async () => {
                const dir = scratch('wxlive');
                try {
                    const target = join(dir, 'target');
                    const link = join(dir, 'link');
                    writeFileSync(target, 'KEEP');
                    symlinkSync(target, link);
                    expect(() => openSync(link, 'wx')).toThrow(/EEXIST/);
                    expect(readFileSync(target, 'utf8')).toBe('KEEP');
                } finally {
                    drop(dir);
                }
            },
            NO_SYMLINK_REASON,
            { when: !CAN_SYMLINK },
        );

        await it('refuses an existing DIRECTORY with EEXIST, not EISDIR', async () => {
            const dir = scratch('wxdir');
            try {
                const d = join(dir, 'adir');
                mkdirSync(d);
                let code: string | undefined;
                try {
                    openSync(d, 'wx');
                } catch (err) {
                    code = (err as NodeJS.ErrnoException).code;
                }
                expect(code).toBe('EEXIST');
            } finally {
                drop(dir);
            }
        });

        await it('reports EISDIR for a non-exclusive write open of a directory', async () => {
            const dir = scratch('wdir');
            try {
                const d = join(dir, 'adir');
                mkdirSync(d);
                let code: string | undefined;
                try {
                    openSync(d, 'w');
                } catch (err) {
                    code = (err as NodeJS.ErrnoException).code;
                }
                expect(code).toBe('EISDIR');
            } finally {
                drop(dir);
            }
        });

        await it('reports EACCES, not EEXIST, for an unwritable existing file', async () => {
            // The failure classifier must gate EEXIST on O_EXCL. Reporting
            // "file already exists" for a permission error is a silently wrong
            // answer from the very mechanism added to remove silent wrongness.
            const dir = scratch('wacc');
            try {
                const f = join(dir, 'locked');
                writeFileSync(f, 'x');
                chmodSync(f, 0o444);
                let code: string | undefined;
                try {
                    closeSync(openSync(f, 'w'));
                } catch (err) {
                    code = (err as NodeJS.ErrnoException).code;
                }
                expect(code).toBe('EACCES');
            } finally {
                drop(dir);
            }
        });

        await it('creates a free path and honours the mode', async () => {
            const dir = scratch('wxfresh');
            try {
                const f = join(dir, 'fresh');
                const fd = openSync(f, 'wx', 0o600);
                writeSync(fd, B('fresh'));
                closeSync(fd);
                expect(readFileSync(f, 'utf8')).toBe('fresh');
                expect(modeOf(f)).toBe(0o600);
            } finally {
                drop(dir);
            }
        });

        await it('applies to wx+, ax and ax+ alike', async () => {
            const dir = scratch('wxall');
            try {
                for (const flag of ['wx+', 'ax', 'ax+'] as const) {
                    const f = join(dir, `f-${flag.replace('+', 'p')}`);
                    writeFileSync(f, 'ORIGINAL');
                    expect(() => openSync(f, flag)).toThrow(/EEXIST/);
                    expect(readFileSync(f, 'utf8')).toBe('ORIGINAL');
                }
            } finally {
                drop(dir);
            }
        });

        await it('applies to numeric O_CREAT|O_EXCL', async () => {
            const dir = scratch('wxnum');
            try {
                const O_WRONLY = 1;
                const O_CREAT = 64;
                const O_EXCL = 128;
                const f = join(dir, 'numeric');
                closeSync(openSync(f, O_WRONLY | O_CREAT | O_EXCL, 0o600));
                expect(modeOf(f)).toBe(0o600);
                let code: string | undefined;
                try {
                    openSync(f, O_WRONLY | O_CREAT | O_EXCL, 0o600);
                } catch (err) {
                    code = (err as NodeJS.ErrnoException).code;
                }
                expect(code).toBe('EEXIST');
            } finally {
                drop(dir);
            }
        });

        await it('does NOT treat numeric O_EXCL without O_CREAT as exclusive', async () => {
            // POSIX leaves the combination undefined and Node simply opens the
            // file; throwing EEXIST would break a passed-through flag set that
            // opens fine today.
            const dir = scratch('wxbare');
            try {
                const O_WRONLY = 1;
                const O_EXCL = 128;
                const f = join(dir, 'bare');
                writeFileSync(f, 'x');
                closeSync(openSync(f, O_WRONLY | O_EXCL));
            } finally {
                drop(dir);
            }
        });

        await it('keeps append semantics for "as" and numeric O_RDWR|O_APPEND', async () => {
            // Both spellings used to be flattened to 'r+', which silently lost
            // the append and clobbered the log they were opened to extend.
            const dir = scratch('append-alias');
            try {
                const O_RDWR = 2;
                const O_APPEND = 1024;

                const a = join(dir, 'as');
                writeFileSync(a, 'HEAD');
                let fd = openSync(a, 'as');
                writeSync(fd, B('tail'));
                closeSync(fd);
                expect(readFileSync(a, 'utf8')).toBe('HEADtail');

                const b = join(dir, 'numeric');
                writeFileSync(b, 'HEAD');
                fd = openSync(b, O_RDWR | O_APPEND);
                writeSync(fd, B('tail'));
                closeSync(fd);
                expect(readFileSync(b, 'utf8')).toBe('HEADtail');
            } finally {
                drop(dir);
            }
        });
    });

    // ─── 6. streams ──────────────────────────────────────────────────────────

    await describe('fs — write streams ride the fd cursor', async () => {
        await it('appends with { flags: "a" }', async () => {
            const dir = scratch('wsapp');
            try {
                const f = join(dir, 'log');
                writeFileSync(f, 'HEAD');
                await new Promise<void>((resolve, reject) => {
                    const s = createWriteStream(f, { flags: 'a' });
                    s.on('error', reject);
                    s.end('tail', () => resolve());
                });
                expect(readFileSync(f, 'utf8')).toBe('HEADtail');
            } finally {
                drop(dir);
            }
        });

        await it('honours { start }', async () => {
            const dir = scratch('wsstart');
            try {
                const f = join(dir, 'patch');
                writeFileSync(f, '0123456789');
                await new Promise<void>((resolve, reject) => {
                    const s = createWriteStream(f, { flags: 'r+', start: 3 });
                    s.on('error', reject);
                    s.end('XX', () => resolve());
                });
                expect(readFileSync(f, 'utf8')).toBe('012XX56789');
            } finally {
                drop(dir);
            }
        });

        await it('honours { mode }', async () => {
            const dir = scratch('wsmode');
            try {
                const f = join(dir, 'secret');
                await new Promise<void>((resolve, reject) => {
                    const s = createWriteStream(f, { mode: 0o600 });
                    s.on('error', reject);
                    s.end('x', () => resolve());
                });
                expect(modeOf(f)).toBe(0o600);
            } finally {
                drop(dir);
            }
        });

        await it('a handle-derived stream writes THROUGH the handle', async () => {
            // `fh.createWriteStream()` used to re-open the path with the class
            // default flags `'w'`, so it TRUNCATED the file its own handle had
            // open — and bound a different inode if the name had been replaced
            // since. It must share the descriptor and its cursor instead.
            const dir = scratch('fhws');
            try {
                const f = join(dir, 'through');
                const fh = await fsPromises.open(f, 'w+');
                try {
                    await fh.write(B('HEAD'));
                    await new Promise<void>((resolve, reject) => {
                        const s = fh.createWriteStream();
                        s.on('error', reject);
                        s.end('tail', () => resolve());
                    });
                } finally {
                    await fh.close();
                }
                expect(readFileSync(f, 'utf8')).toBe('HEADtail');
            } finally {
                drop(dir);
            }
        });

        await it('still concatenates chunked writes', async () => {
            // Passes today only because WriteStream keeps its own `pos`. After
            // the cursor redesign it must pass for the right reason, so this is
            // the canary for making `pos` undefined-unless-`start`.
            const dir = scratch('wschunk');
            try {
                const f = join(dir, 'chunks');
                await new Promise<void>((resolve, reject) => {
                    const s = createWriteStream(f);
                    s.on('error', reject);
                    s.write('AAA');
                    s.write('BBB');
                    s.end('CCC', () => resolve());
                });
                expect(readFileSync(f, 'utf8')).toBe('AAABBBCCC');
            } finally {
                drop(dir);
            }
        });
    });

    // ─── 7. the registry ─────────────────────────────────────────────────────

    await describe('fs — every suite is registered', async () => {
        await it('test.mts imports every spec that exports one', async () => {
            // A patch round replaced `test.mts` with a copy from a diverged
            // branch and silently de-registered two suites: they simply never
            // ran again, with no failure to notice. A convention ("review the
            // diff") does not catch that; a test does.
            const srcDir = ['src', join('packages', 'node', 'fs', 'src')].find((candidate) => {
                try {
                    return existsSync(join(candidate, 'test.mts'));
                } catch {
                    return false;
                }
            });
            if (!srcDir) {
                throw new Error(
                    'Cannot locate the @gjsify/fs src directory from cwd — this guard must be able to read ' +
                        'test.mts, otherwise a de-registered suite goes unnoticed again.',
                );
            }

            const registry = readFileSync(join(srcDir, 'test.mts'), 'utf8');
            const unregistered = readdirSync(srcDir)
                .filter((name) => name.endsWith('.spec.ts'))
                // A spec file without a default export is a shared fixture
                // (`capabilities.spec.ts`), not a suite — nothing to register.
                .filter((name) => readFileSync(join(srcDir, name), 'utf8').includes('export default'))
                .filter((name) => !registry.includes(`./${name.replace(/\.ts$/, '.js')}`));

            expect(unregistered).toEqualArray([]);
        });
    });
};
