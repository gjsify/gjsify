// The `mode` argument of open/openSync/mkdir/mkdirSync used to be parsed and then dropped:
// GLib.IOChannel.new_file() and Gio.File.make_directory() take no mode, so everything landed at
// the process default. A caller asking for 0o600 got a world-readable 0644 file with no
// indication the request had been ignored — which is how a consumer ended up writing private
// mail attachments world-readable.
//
// Windows has no POSIX permission bits, so every assertion here is gated on a non-Windows host.

import { describe, it, expect, on } from '@gjsify/unit';
import { isWin32 } from '@gjsify/utils/core';
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
 */
function withoutUmask(base: number): number {
    const dir = scratch('umask');
    try {
        const probe = join(dir, 'probe');
        writeFileSync(probe, '');
        // A freshly written file is 0666 & ~umask, so the missing bits ARE the umask.
        const umask = 0o666 & ~mode(probe);
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
};
