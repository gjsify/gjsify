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
// `process.umask()` in `@gjsify/process` used to return a hardcoded `0o22`, so
// a test that trusted it would be right only on a 022 machine and would
// silently pass for the wrong reason everywhere else. It reads the live mask
// now — rule U-1 below is what holds it to that — but this file still must not
// USE it: the thing under test and the yardstick cannot be the same
// instrument. There is also no `g_umask` binding, so a test cannot CHANGE the
// mask from inside GJS.
//
// Both problems go away by measuring the live mask from an ordinary directory
// create — a DIRECTORY, because a file probe's 0o666 base cannot observe a
// mask over the execute bits, which is exactly how the first patch round
// under-masked every requested directory mode.

import { describe, it, expect } from '@gjsify/unit';
import {
    appendFileSync,
    closeSync,
    createReadStream,
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
    writeFile,
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
    CAN_FD_TRUNCATE_ANY_MODE,
    NO_FD_TRUNCATE_REASON,
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
 * A plain descriptor NUMBER.
 *
 * Node's `openSync` returns one; gjsify's returns a `FileHandle` (a
 * pre-existing divergence this ledger records rather than hides). Tests that
 * need the number — to close it behind the object's back, or to prove an
 * fd-number call site behaves — go through here so they read the same on both
 * legs.
 */
function fdOf(handle: unknown): number {
    return typeof handle === 'number' ? handle : (handle as { fd: number }).fd;
}

/** The error `fn` threw, or `undefined`. */
function caught(fn: () => unknown): NodeJS.ErrnoException | undefined {
    try {
        fn();
        return undefined;
    } catch (err: unknown) {
        return err as NodeJS.ErrnoException;
    }
}

/**
 * Assert the `code` and not the message.
 *
 * `toThrow(/EACCES/)` passes for a raw `Gio.IOErrorEnum` whose localized text
 * happens to contain the word, and fails on a correct error raised in another
 * locale. The `code` is the contract every caller actually branches on.
 */
function expectCode(fn: () => unknown, code: string): void {
    expect(caught(fn)?.code).toBe(code);
}

async function expectRejectedCode(fn: () => Promise<unknown>, code: string): Promise<void> {
    let err: NodeJS.ErrnoException | undefined;
    try {
        await fn();
    } catch (thrown: unknown) {
        err = thrown as NodeJS.ErrnoException;
    }
    expect(err?.code).toBe(code);
}

type CallbackWriteOptions = { encoding?: string; mode?: number; flag?: string };

function callbackWriteFile(path: string, data: string, options: CallbackWriteOptions): Promise<void> {
    return new Promise((resolve, reject) => {
        writeFile(path, data, options as never, (err) => (err ? reject(err) : resolve()));
    });
}

function callbackWriteError(
    path: string,
    data: string,
    options: CallbackWriteOptions,
): Promise<NodeJS.ErrnoException | null> {
    return new Promise((resolve) => {
        writeFile(path, data, options as never, resolve);
    });
}

/** Names in the CWD that only a descriptor-stringified-into-a-path can create. */
function strayDescriptorFiles(): string[] {
    return readdirSync('.').filter((name) => /^\d+$/.test(name) || name.includes('[object'));
}

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

    // ─── 7. the codes and cursors an fd-first rewrite newly exposes ──────────
    //
    // Every rule below was demonstrated against a GREEN suite. The redesign
    // landed, both legs passed, and three adversarial reads still produced a
    // concrete failing sequence apiece — so each of these was written to FAIL
    // on the tree that had just been declared correct.

    await describe('fs — mode is parsed the way Node parses it', async () => {
        await it('M-1 a string mode that parses NEGATIVE is refused', async () => {
            // `parseInt('-1', 8)` is -1, not NaN, so a NaN-only guard handed it
            // to open(2), where the kernel read the gint as unsigned and masked
            // it to 0o7777 — the file came out SETUID + SETGID + STICKY.
            const dir = scratch('m1');
            try {
                const f = join(dir, 'neg');
                expect(() => openSync(f, 'w', '-1' as unknown as number)).toThrow();
                expect(existsSync(f)).toBe(false);

                const d = join(dir, 'negdir');
                expect(() => mkdirSync(d, '-1' as unknown as number)).toThrow();
                expect(existsSync(d)).toBe(false);
            } finally {
                drop(dir);
            }
        });

        await it('M-2 a string mode wider than uint32 is refused', async () => {
            // Well-formed octal, so a digit check alone lets it through:
            // 0o77777777777 is 8_589_934_591, which does not fit the guint32
            // the syscall takes, and it arrived truncated as 0o7755.
            const dir = scratch('m2');
            try {
                const f = join(dir, 'huge');
                expect(() => openSync(f, 'w', '77777777777' as unknown as number)).toThrow();
                expect(existsSync(f)).toBe(false);
            } finally {
                drop(dir);
            }
        });

        await it('M-3 a numeric mode out of range is refused; 0 and octal strings are not', async () => {
            const dir = scratch('m3');
            try {
                expect(() => openSync(join(dir, 'a'), 'w', -1)).toThrow();
                expect(() => openSync(join(dir, 'b'), 'w', 0.5)).toThrow();
                expect(() => openSync(join(dir, 'c'), 'w', 2 ** 32)).toThrow();

                // The two the guard must NOT reject. `'700'` is the documented
                // octal-string form, and 0 is a valid mode that an earlier
                // `||= 0o666` silently replaced with a readable file.
                const umask = measureUmask(dir);
                const ok = join(dir, 'ok');
                closeSync(fdOf(openSync(ok, 'w', '700' as unknown as number)));
                expect(modeOf(ok)).toBe(fileModeFor(0o700, umask));

                const zero = join(dir, 'zero');
                closeSync(fdOf(openSync(zero, 'w', 0)));
                expect(modeOf(zero)).toBe(0);
            } finally {
                drop(dir);
            }
        });
    });

    await describe('fs — open() names the reason it failed', async () => {
        await it.failing(
            'C-1 a symlink cycle is ELOOP, not EACCES',
            async () => {
                // The classifier ended in a bare `EACCES` for anything it could
                // not explain, and a NOFOLLOW lookup SUCCEEDS on a link, so
                // every chain failure landed there. A retry loop keyed on ELOOP
                // took the give-up branch instead.
                const dir = scratch('c1');
                try {
                    const a = join(dir, 'a');
                    const b = join(dir, 'b');
                    symlinkSync(b, a);
                    symlinkSync(a, b);
                    expectCode(() => openSync(a, 'r'), 'ELOOP');
                } finally {
                    drop(dir);
                }
            },
            NO_SYMLINK_REASON,
            { when: !CAN_SYMLINK },
        );

        await it.failing(
            'C-2 a dangling symlink is ENOENT to read and EEXIST to create exclusively',
            async () => {
                // Two different answers about one name, and neither is EACCES:
                // `lstat` says the name is taken, so `wx` must refuse; `open`
                // says nothing is there, so `r` must be ENOENT.
                const dir = scratch('c2');
                try {
                    const link = join(dir, 'dangling');
                    symlinkSync(join(dir, 'absent'), link);
                    expectCode(() => openSync(link, 'r'), 'ENOENT');
                    expectCode(() => openSync(link, 'wx'), 'EEXIST');

                    // ...and a plain create still writes THROUGH it, as open(2)
                    // does: the TARGET appears and the link stays a link.
                    closeSync(fdOf(openSync(link, 'w')));
                    expect(existsSync(join(dir, 'absent'))).toBe(true);
                    expect(lstatSync(link).isSymbolicLink()).toBe(true);
                } finally {
                    drop(dir);
                }
            },
            NO_SYMLINK_REASON,
            { when: !CAN_SYMLINK },
        );

        await it('C-3 an over-long name is ENAMETOOLONG, not EACCES', async () => {
            const dir = scratch('c3');
            try {
                expectCode(() => openSync(join(dir, 'x'.repeat(500)), 'w'), 'ENAMETOOLONG');
            } finally {
                drop(dir);
            }
        });

        await it('C-4 the codes that were already right stay right', async () => {
            // The regression guard for the classifier rewrite: widening it must
            // not move ENOTDIR / ENOENT / EACCES off their own cases.
            const dir = scratch('c4');
            try {
                const file = join(dir, 'plain');
                writeFileSync(file, 'x');
                expectCode(() => openSync(join(file, 'child'), 'w'), 'ENOTDIR');
                expectCode(() => openSync(join(dir, 'absent'), 'r'), 'ENOENT');

                const locked = join(dir, 'locked');
                mkdirSync(locked, { mode: 0o500 });
                try {
                    let opened: unknown;
                    try {
                        opened = openSync(join(locked, 'nope'), 'w');
                    } catch (err: unknown) {
                        expect((err as NodeJS.ErrnoException).code).toBe('EACCES');
                    }
                    // A process with CAP_DAC_OVERRIDE (root in a container) is
                    // not bound by the mode, so there is nothing to assert —
                    // but the descriptor it just got still has to be released.
                    if (opened !== undefined) closeSync(fdOf(opened));
                } finally {
                    chmodSync(locked, 0o700);
                }
            } finally {
                drop(dir);
            }
        });
    });

    await describe('fs — ftruncate obeys the descriptor', async () => {
        await it('F-1 a READ-ONLY handle cannot truncate', async () => {
            // ftruncate(2) checks the access mode and nothing else, so this is
            // EINVAL. The re-open that truncation has to use asks the kernel for
            // its own fresh permission and is GRANTED it, so without an explicit
            // gate a handle opened 'r' silently destroyed the file.
            // `_readCore`/`_writeCore` have carried the same gate since this
            // redesign began; truncate was the one byte-mover left outside it.
            const dir = scratch('f1');
            try {
                const f = join(dir, 'victim');
                writeFileSync(f, '0123456789');

                const fd = fdOf(openSync(f, 'r'));
                try {
                    expectCode(() => ftruncateSync(fd, 4), 'EINVAL');
                    expect(readFileSync(f, 'utf8')).toBe('0123456789');
                } finally {
                    closeSync(fd);
                }

                const handle = await fsPromises.open(f, 'r');
                try {
                    await expectRejectedCode(() => handle.truncate(4), 'EINVAL');
                    expect(readFileSync(f, 'utf8')).toBe('0123456789');
                } finally {
                    await handle.close();
                }
            } finally {
                drop(dir);
            }
        });

        await it('F-2 a WRITE-ONLY file truncates through the handle that made it', async () => {
            // Mode 0o200 grants write and nothing else. Truncation used to
            // re-open O_RDWR, which that mode refuses, so the creating handle
            // could write the file but not shorten it. O_WRONLY is the least
            // privilege that can truncate, and it is what ftruncate(2) needs.
            const dir = scratch('f2');
            try {
                const fd = fdOf(openSync(join(dir, 'wonly'), 'w', 0o200));
                try {
                    writeSync(fd, B('AAAABBBB'));
                    ftruncateSync(fd, 4);
                    expect(fstatSync(fd).size).toBe(4);
                } finally {
                    closeSync(fd);
                }
            } finally {
                drop(dir);
            }
        });

        await it('F-3 a refused truncate is a Node error, never a bare GError', async () => {
            // The SHAPE rule, asserted separately from the outcome on purpose.
            // When this failed it threw a raw `Gio.IOErrorEnum` whose `code` was
            // the NUMBER 14 and which was not an Error at all, so
            // `catch (e) { if (e.code === 'EACCES') }` could not see it. Where
            // the host can truncate through the fd nothing is thrown and there
            // is nothing to check: the rule is about the failure, not about
            // whether one happens.
            const dir = scratch('f3');
            try {
                const fd = fdOf(openSync(join(dir, 'ro'), 'w', 0o444));
                try {
                    writeSync(fd, B('AAAABBBB'));
                    try {
                        ftruncateSync(fd, 4);
                    } catch (err: unknown) {
                        expect(err instanceof Error).toBe(true);
                        expect(typeof (err as NodeJS.ErrnoException).code).toBe('string');
                        expect(typeof (err as NodeJS.ErrnoException).syscall).toBe('string');
                    }
                } finally {
                    closeSync(fd);
                }
            } finally {
                drop(dir);
            }
        });

        await it.failing(
            'F-4 ftruncate ignores the FILE mode, only the access mode',
            async () => {
                const dir = scratch('f4');
                try {
                    const fd = fdOf(openSync(join(dir, 'ro'), 'w', 0o444));
                    try {
                        writeSync(fd, B('AAAABBBB'));
                        ftruncateSync(fd, 4);
                        expect(fstatSync(fd).size).toBe(4);
                    } finally {
                        closeSync(fd);
                    }
                } finally {
                    drop(dir);
                }
            },
            NO_FD_TRUNCATE_REASON,
            { when: !CAN_FD_TRUNCATE_ANY_MODE },
        );
    });

    await describe('fs — a descriptor is a descriptor, not a filename', async () => {
        await it('D-1 the whole-file writers accept an fd and write at its cursor', async () => {
            // `normalizePath(8)` is the string '8' and `normalizePath(handle)`
            // is '[object Object]', so these wrote the payload to a file of
            // that NAME in the process CWD, left the intended file untouched,
            // and reported success. The read twin `readFileSync(fd)` had
            // already been fixed, so the two halves of one API disagreed.
            const dir = scratch('d1');
            try {
                const f = join(dir, 'log');
                const handle = await fsPromises.open(f, 'w');
                try {
                    writeSync(handle.fd, B('HEAD'));
                    writeFileSync(handle.fd, 'BODY');
                    appendFileSync(handle.fd, 'TAIL');
                } finally {
                    await handle.close();
                }
                expect(readFileSync(f, 'utf8')).toBe('HEADBODYTAIL');
                // A mis-route is not only a lost write: it is a stray file
                // somewhere nobody thinks to look.
                expect(strayDescriptorFiles()).toEqualArray([]);
            } finally {
                drop(dir);
            }
        });

        await it('D-2 fsPromises.writeFile / readFile accept a FileHandle', async () => {
            const dir = scratch('d2');
            try {
                const f = join(dir, 'handle');

                const writer = await fsPromises.open(f, 'w');
                try {
                    await fsPromises.writeFile(writer, 'DATA');
                } finally {
                    await writer.close();
                }
                expect(readFileSync(f, 'utf8')).toBe('DATA');

                // readFile(handle) reads from the CURRENT position to EOF, so
                // after two bytes have been consumed it returns only the rest.
                const reader = await fsPromises.open(f, 'r');
                try {
                    await reader.read(Buffer.alloc(2), 0, 2, null);
                    expect(await fsPromises.readFile(reader, 'utf8')).toBe('TA');
                } finally {
                    await reader.close();
                }
                expect(strayDescriptorFiles()).toEqualArray([]);
            } finally {
                drop(dir);
            }
        });

        await it('D-3 readFileSync accepts what openSync returned, unwrapped or not', async () => {
            // Deliberately NOT `fdOf(...)`: the value under test is the one
            // `openSync` HANDS BACK. On gjsify that is a FileHandle rather than
            // Node's number, and the object fell past the numeric branch into
            // `normalizePath`, which read `'[object Object]'` from the CWD.
            const dir = scratch('d3');
            try {
                const f = join(dir, 'r');
                writeFileSync(f, 'CONTENT');
                const opened = openSync(f, 'r');
                try {
                    expect(readFileSync(opened as unknown as number, 'utf8')).toBe('CONTENT');
                } finally {
                    closeSync(fdOf(opened));
                }
                expect(strayDescriptorFiles()).toEqualArray([]);
            } finally {
                drop(dir);
            }
        });
    });

    await describe('fs — a closed descriptor is EBADF', async () => {
        await it('B-1 every fd operation on a closed fd reports EBADF', async () => {
            // `_teardown()` deletes the registry entry, so the lookup missed
            // before the `_closed` guard could run and threw
            // `Error('No instance found for fd!')` — no `code` at all. That
            // made the guard dead for every fd-NUMBER call site, which is all
            // of them except a caller still holding the FileHandle.
            const dir = scratch('b1');
            try {
                const fd = fdOf(openSync(join(dir, 'gone'), 'w+'));
                closeSync(fd);

                expectCode(() => writeSync(fd, B('x')), 'EBADF');
                expectCode(() => readSync(fd, Buffer.alloc(4), 0, 4, null), 'EBADF');
                expectCode(() => fstatSync(fd), 'EBADF');
                expectCode(() => ftruncateSync(fd, 0), 'EBADF');
                expectCode(() => closeSync(fd), 'EBADF');
            } finally {
                drop(dir);
            }
        });

        await it('B-2 a closed FileHandle reports EBADF too', async () => {
            const dir = scratch('b2');
            try {
                const handle = await fsPromises.open(join(dir, 'gone'), 'w+');
                await handle.close();
                // `stat()` resolves the fd through /proc/self/fd/N, which stops
                // existing along with the descriptor — so without an explicit
                // guard the caller got a NOT_FOUND about a procfs path it never
                // named.
                await expectRejectedCode(() => handle.stat(), 'EBADF');
                await expectRejectedCode(() => handle.truncate(0), 'EBADF');
                await expectRejectedCode(() => handle.write(Buffer.from('x'), 0, 1, null), 'EBADF');
            } finally {
                drop(dir);
            }
        });
    });

    await describe('fs — the read window is the buffer the caller passed', async () => {
        await it('W-1 length defaults to what fits AFTER the offset', async () => {
            // Both spellings defaulted `length` to the WHOLE buffer, ignoring
            // the offset, so the documented options form threw RangeError where
            // Node reads `byteLength - offset` bytes.
            const dir = scratch('w1');
            try {
                const f = join(dir, 'abc');
                writeFileSync(f, 'abcdefgh');

                const handle = await fsPromises.open(f, 'r');
                try {
                    const result = await handle.read({ buffer: Buffer.alloc(8), offset: 4 });
                    expect(result.bytesRead).toBe(4);
                    expect((result.buffer as Buffer).toString('utf8', 4, 8)).toBe('abcd');
                } finally {
                    await handle.close();
                }

                const fd = fdOf(openSync(f, 'r'));
                try {
                    expect(readSync(fd, Buffer.alloc(8), { offset: 4 })).toBe(4);
                } finally {
                    closeSync(fd);
                }
            } finally {
                drop(dir);
            }
        });

        await it('W-2 a length past the end of the view is refused', async () => {
            // The transfer was bounded by the ArrayBuffer rather than by the
            // caller's VIEW. On a runtime whose Buffer pools its allocations —
            // Node's does — that is a silent overrun into the NEIGHBOURING
            // buffer instead of an error, which is why the bound is checked
            // rather than relied upon.
            const dir = scratch('w2');
            try {
                const f = join(dir, 'abc');
                writeFileSync(f, 'abcdefgh');
                const fd = fdOf(openSync(f, 'r'));
                try {
                    // The CODE, not just "it threw": the unchecked transfer
                    // also ended in a RangeError, but a bare one with no `code`
                    // — raised by `.set()` after the bytes had already been
                    // consumed from the kernel, and only because this runtime's
                    // Buffer happens not to pool.
                    expectCode(() => readSync(fd, Buffer.alloc(8), 4, 8, null), 'ERR_OUT_OF_RANGE');
                } finally {
                    closeSync(fd);
                }
            } finally {
                drop(dir);
            }
        });
    });

    await describe('fs — positional I/O needs a descriptor that can seek', async () => {
        await it('S-1 a character device still takes positional reads', async () => {
            // The regression guard for the seekability check itself. "Seekable
            // means S_IFREG or S_IFBLK" is the obvious rule and it is WRONG:
            // most character devices seek fine, and Node reads /dev/zero at an
            // explicit position without complaint. Refusing them would trade a
            // stray GLib-CRITICAL for an ESPIPE that Node never raises — a
            // strictly worse bug than the one being fixed.
            //
            // The FIFO half of this rule (a pipe MUST report ESPIPE, and
            // sequential I/O on one must emit no CRITICAL) needs `mkfifo(3)`,
            // which neither `node:fs` nor GLib exposes, so it is verified by
            // the out-of-suite reproduction instead of here.
            if (!existsSync('/dev/zero')) return;
            const fd = fdOf(openSync('/dev/zero', 'r'));
            try {
                expect(readSync(fd, Buffer.alloc(4), 0, 4, 0)).toBe(4);
            } finally {
                closeSync(fd);
            }
        });
    });

    await describe('fs — streams ride the descriptor they were given', async () => {
        await it('R-1 a handle read stream resumes at the handle cursor', async () => {
            // It opened the PATH afresh at offset 0 — a second read cursor that
            // neither consulted nor advanced the handle's. The write half had
            // already been moved onto the descriptor, so the "one cursor"
            // invariant held for writes only.
            const dir = scratch('r1');
            try {
                const f = join(dir, 'stream');
                writeFileSync(f, 'HEADBODY');
                const handle = await fsPromises.open(f, 'r');
                await handle.read(Buffer.alloc(4), 0, 4, null);

                let seen = '';
                for await (const chunk of handle.createReadStream()) seen += String(chunk);
                expect(seen).toBe('BODY');

                // ...and Node closes the handle when that stream ends.
                await expectRejectedCode(() => handle.read(Buffer.alloc(1), 0, 1, null), 'EBADF');
            } finally {
                drop(dir);
            }
        });

        await it('R-2 createReadStream({fd}) reads through the descriptor', async () => {
            const dir = scratch('r2');
            try {
                const f = join(dir, 'stream');
                writeFileSync(f, 'HEADBODY');
                const handle = await fsPromises.open(f, 'r');
                try {
                    await handle.read(Buffer.alloc(4), 0, 4, null);
                    let seen = '';
                    for await (const chunk of createReadStream(f, { fd: handle.fd, autoClose: false })) {
                        seen += String(chunk);
                    }
                    expect(seen).toBe('BODY');
                } finally {
                    await handle.close();
                }
            } finally {
                drop(dir);
            }
        });

        await it('R-3 a handle read stream with `start` leaves the cursor alone', async () => {
            const dir = scratch('r3');
            try {
                const f = join(dir, 'ranged');
                writeFileSync(f, 'ABCDEFGH');
                const handle = await fsPromises.open(f, 'r');
                try {
                    let seen = '';
                    for await (const chunk of handle.createReadStream({ start: 2, end: 3, autoClose: false })) {
                        seen += String(chunk);
                    }
                    expect(seen).toBe('CD');

                    // An explicit start is pread, so the handle's own cursor
                    // never moved and the next read still starts at zero.
                    const after = await handle.read(Buffer.alloc(2), 0, 2, null);
                    expect((after.buffer as Buffer).toString('utf8', 0, after.bytesRead)).toBe('AB');
                } finally {
                    await handle.close();
                }
            } finally {
                drop(dir);
            }
        });

        await it('R-4 a handle write stream honours autoClose', async () => {
            // `autoClose: false` was hardcoded AFTER the caller's options were
            // spread in, so an explicit `true` was silently discarded — and
            // Node's default for a handle-derived stream is to close.
            const dir = scratch('r4');
            try {
                const f = join(dir, 'ws');
                const handle = await fsPromises.open(f, 'w+');
                const stream = handle.createWriteStream({ autoClose: true });
                await new Promise<void>((resolve) => {
                    stream.on('close', () => resolve());
                    stream.end('DATA');
                });
                await expectRejectedCode(() => handle.stat(), 'EBADF');
                expect(readFileSync(f, 'utf8')).toBe('DATA');
            } finally {
                drop(dir);
            }
        });

        await it.failing(
            'R-5 a write stream releases its descriptor',
            async () => {
                // One fd leaked PER STREAM: `close()` is reachable only from
                // `_destroy()`, and a finished Writable emitted 'close' without
                // ever destroying, so nothing ran. At the 1024 soft limit that
                // is EMFILE after about a thousand files — on precisely the
                // workload this redesign exists for.
                const dir = scratch('r5');
                try {
                    const before = readdirSync('/proc/self/fd').length;
                    for (let i = 0; i < 32; i++) {
                        const stream = createWriteStream(join(dir, `f${i}`));
                        await new Promise<void>((resolve) => {
                            stream.on('close', () => resolve());
                            stream.end('x');
                        });
                    }
                    // Not `=== before`: the loop may legitimately move the count
                    // by a descriptor or two. A LEAK is linear in the iteration
                    // count, and 32 streams used to cost 32 descriptors.
                    expect(readdirSync('/proc/self/fd').length - before < 8).toBe(true);
                } finally {
                    drop(dir);
                }
            },
            NO_PROC_FD_REASON,
            { when: !CAN_PROC_FD },
        );
    });

    await describe('fs — the surfaces that answered without doing anything', async () => {
        await it('U-1 process.umask() reports the mask the kernel actually applies', async () => {
            // It returned a hardcoded 0o22, which is right only on a 022
            // machine and wrong in the PERMISSIVE direction everywhere else: on
            // a 002 host a caller computing `0o666 & ~process.umask()` believes
            // it produced 0644 while the file is group-writable 0664. Measured
            // against a real `mkdir(2)`, which is the only witness that cannot
            // be wrong — the same instrument section 2 uses, and the reason
            // this ledger never TRUSTS the API it is checking.
            const dir = scratch('u1');
            try {
                expect(process.umask()).toBe(measureUmask(dir));
            } finally {
                drop(dir);
            }
        });

        await it('U-2 lchmod reports that it is not implemented', async () => {
            // The bodies were empty, so a request to RESTRICT permissions
            // returned normally having changed nothing — the quietest member of
            // the silent-non-restriction class this redesign exists to close,
            // since it does not even leave a wrong mode on disk to notice.
            // Node has no `fs.lchmodSync` on Linux at all, and its
            // `fsPromises.lchmod` throws; only the promise form can be asked
            // the question on both legs.
            const dir = scratch('u2');
            try {
                const f = join(dir, 'f');
                writeFileSync(f, 'x');
                await expectRejectedCode(() => fsPromises.lchmod(f, 0o600), 'ERR_METHOD_NOT_IMPLEMENTED');
            } finally {
                drop(dir);
            }
        });
    });

    await describe('fs — writeFile(callback) is the same API as writeFileSync', async () => {
        await it('A-1 the callback form honours mode, flag and encoding', async () => {
            // The options bag was located only to find the callback behind it,
            // and then dropped. Before this redesign all four spellings lost
            // `mode`, so they were at least uniformly wrong; fixing the other
            // three is what turned this one into a divergence.
            const dir = scratch('a1');
            try {
                const umask = measureUmask(dir);

                const secret = join(dir, 'secret');
                await callbackWriteFile(secret, 'data', { mode: 0o600 });
                expect(modeOf(secret)).toBe(fileModeFor(0o600, umask));

                const lock = join(dir, 'lock');
                writeFileSync(lock, 'first');
                expect((await callbackWriteError(lock, 'second', { flag: 'wx' }))?.code).toBe('EEXIST');
                expect(readFileSync(lock, 'utf8')).toBe('first');

                const log = join(dir, 'log');
                writeFileSync(log, 'HEAD');
                await callbackWriteFile(log, 'TAIL', { flag: 'a' });
                expect(readFileSync(log, 'utf8')).toBe('HEADTAIL');

                const encoded = join(dir, 'encoded');
                await callbackWriteFile(encoded, 'QUJD', { encoding: 'base64' });
                expect(readFileSync(encoded, 'utf8')).toBe('ABC');
            } finally {
                drop(dir);
            }
        });
    });

    // ─── 8. the registry ─────────────────────────────────────────────────────

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
