// The `mode` argument of open/openSync/mkdir/mkdirSync used to be parsed and then dropped:
// GLib.IOChannel.new_file() and Gio.File.make_directory() take no mode, so everything landed at
// the process default. A caller asking for 0o600 got a world-readable 0644 file with no
// indication the request had been ignored — which is how a consumer ended up writing private
// mail attachments world-readable.
//
// Windows has no POSIX permission bits, so every assertion here is gated on a non-Windows host.

import { describe, it, expect, on } from '@gjsify/unit';
import { isWin32 } from '@gjsify/utils/core';
import {
    chmodSync,
    closeSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readFileSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
    writeSync,
} from 'node:fs';
import { Buffer } from 'node:buffer';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Permission bits of a path. */
function mode(path: string): number {
    return statSync(path).mode & 0o777;
}

function scratch(name: string): string {
    return mkdtempSync(join(tmpdir(), `gjsify-mode-${name}-`));
}

/**
 * What the umask leaves of a base mode, measured rather than assumed — the suite must pass
 * under any umask the developer or CI happens to have.
 *
 * The probe is a DIRECTORY, not a file. A file is created 0666 & ~umask, which carries no
 * execute bits, so a umask masking execute (0111 and friends) is invisible in it — and using
 * that reading to predict a DIRECTORY mode (base 0777) would expect execute bits the kernel
 * actually stripped. A directory probe observes every bit.
 */
function withoutUmask(base: number): number {
    const dir = scratch('umask');
    try {
        const probe = join(dir, 'probe');
        mkdirSync(probe);
        const umask = 0o777 & ~mode(probe);
        return base & ~umask;
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

export default async () => {
    await describe('openSync honours its mode argument', async () => {
        await on(['Gjs', 'Node.js'], async () => {
            if (isWin32()) return;

            await it('creates a file with the requested mode', async () => {
                const dir = scratch('open');
                try {
                    const path = join(dir, 'private.txt');
                    closeSync(openSync(path, 'w', 0o600));
                    expect(mode(path)).toBe(0o600);
                } finally {
                    rmSync(dir, { recursive: true, force: true });
                }
            });

            await it('applies the umask, as open(2) does', async () => {
                // An explicit 0o666 must still come out umask-masked — otherwise "fixing" the
                // dropped mode would start creating world-writable files.
                const dir = scratch('umask-open');
                try {
                    const path = join(dir, 'default.txt');
                    closeSync(openSync(path, 'w', 0o666));
                    expect(mode(path)).toBe(withoutUmask(0o666));
                } finally {
                    rmSync(dir, { recursive: true, force: true });
                }
            });

            await it('leaves the default alone', async () => {
                // No mode passed: the result must be exactly what it always was, so this fix
                // cannot regress any existing caller.
                const dir = scratch('default-open');
                try {
                    const path = join(dir, 'plain.txt');
                    closeSync(openSync(path, 'w'));
                    expect(mode(path)).toBe(withoutUmask(0o666));
                } finally {
                    rmSync(dir, { recursive: true, force: true });
                }
            });

            await it('does NOT change the mode of an existing file', async () => {
                // open(2) ignores `mode` unless it creates the file. Applying it anyway would
                // be a silent permission change on someone else's file.
                const dir = scratch('existing');
                try {
                    const path = join(dir, 'kept.txt');
                    writeFileSync(path, 'x');
                    const before = mode(path);
                    closeSync(openSync(path, 'w', 0o600));
                    expect(mode(path)).toBe(before);
                } finally {
                    rmSync(dir, { recursive: true, force: true });
                }
            });

            await it('honours the mode on an exclusive create', async () => {
                const dir = scratch('wx');
                try {
                    const path = join(dir, 'excl.txt');
                    closeSync(openSync(path, 'wx', 0o600));
                    expect(mode(path)).toBe(0o600);
                } finally {
                    rmSync(dir, { recursive: true, force: true });
                }
            });
        });
    });

    await describe('mkdirSync honours its mode option', async () => {
        await on(['Gjs', 'Node.js'], async () => {
            if (isWin32()) return;

            await it('creates a directory with the requested mode', async () => {
                const dir = scratch('mkdir');
                try {
                    const target = join(dir, 'private');
                    mkdirSync(target, 0o700);
                    expect(mode(target)).toBe(0o700);
                } finally {
                    rmSync(dir, { recursive: true, force: true });
                }
            });

            await it('applies the mode to EVERY level of a recursive create', async () => {
                // The recursive path used to drop `mode` entirely, so an intermediate directory
                // stayed 0755 even when the leaf was meant to be private — and on a path whose
                // leaf holds secrets, a readable parent is the whole exposure.
                const dir = scratch('mkdir-r');
                try {
                    const leaf = join(dir, 'a', 'b', 'c');
                    mkdirSync(leaf, { recursive: true, mode: 0o700 });
                    expect(mode(join(dir, 'a'))).toBe(0o700);
                    expect(mode(join(dir, 'a', 'b'))).toBe(0o700);
                    expect(mode(leaf)).toBe(0o700);
                } finally {
                    rmSync(dir, { recursive: true, force: true });
                }
            });

            await it('applies the umask, as mkdir(2) does', async () => {
                const dir = scratch('mkdir-umask');
                try {
                    const target = join(dir, 'open');
                    mkdirSync(target, 0o777);
                    expect(mode(target)).toBe(withoutUmask(0o777));
                } finally {
                    rmSync(dir, { recursive: true, force: true });
                }
            });

            await it('leaves the default alone', async () => {
                const dir = scratch('mkdir-default');
                try {
                    const target = join(dir, 'plain');
                    mkdirSync(target);
                    expect(mode(target)).toBe(withoutUmask(0o777));
                } finally {
                    rmSync(dir, { recursive: true, force: true });
                }
            });

            await it('does NOT change the mode of a directory that already existed', async () => {
                const dir = scratch('mkdir-existing');
                try {
                    const target = join(dir, 'kept');
                    mkdirSync(target, 0o755);
                    const before = mode(target);
                    // recursive:true is the form that tolerates an existing directory
                    mkdirSync(target, { recursive: true, mode: 0o700 });
                    expect(mode(target)).toBe(before);
                } finally {
                    rmSync(dir, { recursive: true, force: true });
                }
            });
        });
    });

    await describe('mode is applied only where Node applies it', async () => {
        await on(['Gjs', 'Node.js'], async () => {
            if (isWin32()) return;

            await it('parses a STRING mode as octal, as Node does', async () => {
                // Node documents mode as string | integer and parses a string with
                // parseInt(v, 8). Read as a JS number instead, '600' is decimal 600 = 0o1130
                // (sticky + --x-wx---) and the owner cannot read back its own new file.
                const dir = scratch('string-mode');
                try {
                    const path = join(dir, 'octal.txt');
                    closeSync(openSync(path, 'w', '600' as unknown as number));
                    expect(mode(path)).toBe(0o600);
                    expect(readFileSync(path, 'utf8')).toBe('');
                } finally {
                    rmSync(dir, { recursive: true, force: true });
                }
            });

            await it('PRESERVES a setgid bit the kernel inherited', async () => {
                // The standard shared-workspace setup: a 2775 parent hands S_ISGID to every
                // child. A chmod computed from a plain mode strips it, and the group loses
                // access to everything created there afterwards.
                const dir = scratch('setgid');
                try {
                    const parent = join(dir, 'shared');
                    mkdirSync(parent);
                    chmodSync(parent, 0o2775);
                    if ((statSync(parent).mode & 0o2000) === 0) return; // fs refused setgid
                    const child = join(parent, 'child');
                    mkdirSync(child, 0o750);
                    expect(statSync(child).mode & 0o2000).toBe(0o2000);
                    expect(mode(child)).toBe(0o750);
                } finally {
                    rmSync(dir, { recursive: true, force: true });
                }
            });

            await it('does not chmod at all when no mode was passed', async () => {
                // The claim the whole design rests on: an omitted mode must leave the path
                // exactly as the system made it, special bits included.
                const dir = scratch('untouched');
                try {
                    const parent = join(dir, 'shared');
                    mkdirSync(parent);
                    chmodSync(parent, 0o2775);
                    if ((statSync(parent).mode & 0o2000) === 0) return;
                    const child = join(parent, 'plain');
                    mkdirSync(child);
                    expect(statSync(child).mode & 0o2000).toBe(0o2000);
                } finally {
                    rmSync(dir, { recursive: true, force: true });
                }
            });

            await it('keeps a restrictive mode usable for the handle that created it', async () => {
                // open(2) checks permissions once, at open. A 0444 file must still be writable
                // through the fd that created it; only the FINAL mode has to be 0444.
                const dir = scratch('restrictive');
                try {
                    const path = join(dir, 'ro.txt');
                    const fd = openSync(path, 'w', 0o444);
                    writeSync(fd, Buffer.from('written'));
                    closeSync(fd);
                    expect(readFileSync(path, 'utf8')).toBe('written');
                    expect(mode(path)).toBe(0o444);
                } finally {
                    rmSync(dir, { recursive: true, force: true });
                }
            });

            await it('mkdtempSync creates a PRIVATE directory', async () => {
                // mkdtemp(3) and Node create 0700. The old 0o777 was inert while mode was
                // ignored; honouring mode without fixing it would hand out a world-readable
                // scratch dir from the one API whose whole point is privacy.
                const d = mkdtempSync(join(tmpdir(), 'gjsify-mkdtemp-'));
                try {
                    expect(mode(d)).toBe(0o700);
                } finally {
                    rmSync(d, { recursive: true, force: true });
                }
            });
        });
    });

    await describe('exclusive create and symlinks', async () => {
        await on(['Gjs', 'Node.js'], async () => {
            if (isWin32()) return;

            await it('refuses wx on a DANGLING symlink instead of writing through it', async () => {
                // A plain EXISTS test follows the link, reports "free", and the open then
                // creates and writes the link's TARGET — letting whoever planted it choose
                // where the caller's bytes land. Real O_EXCL refuses any symlink.
                const dir = scratch('wx-symlink');
                try {
                    const link = join(dir, 'lock');
                    const target = join(dir, 'victim.txt');
                    symlinkSync(target, link);
                    let code = '';
                    try {
                        closeSync(openSync(link, 'wx'));
                    } catch (err) {
                        code = (err as NodeJS.ErrnoException).code ?? '';
                    }
                    expect(code).toBe('EEXIST');
                    expect(existsSync(target)).toBe(false);
                } finally {
                    rmSync(dir, { recursive: true, force: true });
                }
            });
        });
    });
};
