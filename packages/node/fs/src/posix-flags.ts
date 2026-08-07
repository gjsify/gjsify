// Node open-flag strings and `mode` values, translated for `open(2)`.
//
// WHY THIS REPLACED `resolveIOMode()`
//
// The old path converted the caller's flags to an fopen(3) mode string for
// `GLib.IOChannel.new_file()`, and fopen(3) is a strictly smaller vocabulary
// than open(2): it has no exclusive mode and no way to say "append AND
// read/write AND synchronous". So the conversion was LOSSY by construction —
// `wx` collapsed to `w` (the exclusivity vanished and the file was TRUNCATED,
// which is the opposite of what the flag promises) and `as` collapsed to `r+`
// (the append vanished, so writes clobbered the log they were opened to
// extend). A lossy enum in the middle of the flag path is a defect generator,
// not a defect; the replacement loses nothing because it hands the caller's
// bits straight to the kernel.
//
// WHY THE `O_*` TABLE IS KEYED ON THE HOST
//
// These values used to be read only by JS, so a wrong one was inert. They are
// now arguments to `open(2)`, and the numbers are NOT portable: on darwin
// `O_CREAT` is `0x200`, which is Linux's `O_TRUNC`. A single hardcoded table
// would therefore silently truncate files on macOS — the same shape as
// `mkdtempSync`'s dormant `0o777`, which was harmless until the day `mode`
// started working. The OS decision goes through `@gjsify/utils`' one detector
// (ADR 0018), never through a local `process.platform` read.

import { isDarwin, isWin32 } from '@gjsify/utils/core';

import type { Mode } from 'node:fs';
import type { OpenFlags } from './types/index.js';

/** The `O_*` bits `open(2)` understands on one host. */
export interface PosixOpenFlags {
    O_RDONLY: number;
    O_WRONLY: number;
    O_RDWR: number;
    O_CREAT: number;
    O_EXCL: number;
    O_NOCTTY: number;
    O_TRUNC: number;
    O_APPEND: number;
    O_NONBLOCK: number;
    O_DSYNC: number;
    O_SYNC: number;
    O_DIRECTORY: number;
    O_NOFOLLOW: number;
}

const LINUX: PosixOpenFlags = {
    O_RDONLY: 0o0,
    O_WRONLY: 0o1,
    O_RDWR: 0o2,
    O_CREAT: 0o100,
    O_EXCL: 0o200,
    O_NOCTTY: 0o400,
    O_TRUNC: 0o1000,
    O_APPEND: 0o2000,
    O_NONBLOCK: 0o4000,
    O_DSYNC: 0o10000,
    O_SYNC: 0o4010000,
    O_DIRECTORY: 0o200000,
    O_NOFOLLOW: 0o400000,
};

const DARWIN: PosixOpenFlags = {
    O_RDONLY: 0x0,
    O_WRONLY: 0x1,
    O_RDWR: 0x2,
    O_CREAT: 0x200,
    O_EXCL: 0x800,
    O_NOCTTY: 0x20000,
    O_TRUNC: 0x400,
    O_APPEND: 0x8,
    O_NONBLOCK: 0x4,
    O_DSYNC: 0x400000,
    O_SYNC: 0x80,
    O_DIRECTORY: 0x100000,
    O_NOFOLLOW: 0x100,
};

// msvcrt `_O_*`. Windows has no notion of most of the rest; the members that
// do not exist are zero so a flag set that mentions them degrades to "ignored"
// rather than colliding with a bit that means something else.
const WIN32: PosixOpenFlags = {
    O_RDONLY: 0x0,
    O_WRONLY: 0x1,
    O_RDWR: 0x2,
    O_CREAT: 0x100,
    O_EXCL: 0x400,
    O_NOCTTY: 0,
    O_TRUNC: 0x200,
    O_APPEND: 0x8,
    O_NONBLOCK: 0,
    O_DSYNC: 0,
    O_SYNC: 0,
    O_DIRECTORY: 0,
    O_NOFOLLOW: 0,
};

/**
 * The host's `O_*` values.
 *
 * A function and not a module-level constant for the reason `host-os.ts`
 * documents: `process.platform` is a lazy property installed by
 * `@gjsify/process` at register time, so a value frozen during module
 * evaluation can cache the byte-1 stub's answer for the life of the process.
 */
export function openFlagValues(): PosixOpenFlags {
    if (isWin32()) return WIN32;
    if (isDarwin()) return DARWIN;
    return LINUX;
}

/** What the caller asked `open(2)` for, with nothing flattened away. */
export interface OpenSpec {
    /** The exact bit set to hand to `open(2)`. */
    posix: number;
    readable: boolean;
    writable: boolean;
    /** `O_APPEND` — the kernel then ignores every write position. */
    append: boolean;
    /** `O_CREAT` */
    creat: boolean;
    /** `O_CREAT | O_EXCL` — exclusivity needs BOTH, see below. */
    excl: boolean;
    /** `O_TRUNC` */
    trunc: boolean;
    /** `O_NOFOLLOW` — the open refuses a symlink instead of following it. */
    nofollow: boolean;
    /** `O_DIRECTORY` — the open refuses anything that is not a directory. */
    directory: boolean;
}

// Node's `stringToFlags()` table, verbatim. Reference: Node.js
// lib/internal/fs/utils.js.
function stringFlagBits(flags: string, O: PosixOpenFlags): number | undefined {
    switch (flags) {
        case 'r':
            return O.O_RDONLY;
        case 'rs':
        case 'sr':
            return O.O_RDONLY | O.O_SYNC;
        case 'r+':
            return O.O_RDWR;
        case 'rs+':
        case 'sr+':
            return O.O_RDWR | O.O_SYNC;
        case 'w':
            return O.O_TRUNC | O.O_CREAT | O.O_WRONLY;
        case 'wx':
        case 'xw':
            return O.O_TRUNC | O.O_CREAT | O.O_WRONLY | O.O_EXCL;
        case 'w+':
            return O.O_TRUNC | O.O_CREAT | O.O_RDWR;
        case 'wx+':
        case 'xw+':
            return O.O_TRUNC | O.O_CREAT | O.O_RDWR | O.O_EXCL;
        case 'a':
            return O.O_APPEND | O.O_CREAT | O.O_WRONLY;
        case 'ax':
        case 'xa':
            return O.O_APPEND | O.O_CREAT | O.O_WRONLY | O.O_EXCL;
        case 'as':
        case 'sa':
            return O.O_APPEND | O.O_CREAT | O.O_WRONLY | O.O_SYNC;
        case 'a+':
            return O.O_APPEND | O.O_CREAT | O.O_RDWR;
        case 'ax+':
        case 'xa+':
            return O.O_APPEND | O.O_CREAT | O.O_RDWR | O.O_EXCL;
        case 'as+':
        case 'sa+':
            return O.O_APPEND | O.O_CREAT | O.O_RDWR | O.O_SYNC;
        default:
            return undefined;
    }
}

/** Translate Node open flags into the exact `open(2)` argument. */
export function parseOpenFlags(flags: OpenFlags | number | string | undefined | null): OpenSpec {
    const O = openFlagValues();
    let posix: number;
    if (flags === undefined || flags === null) {
        posix = O.O_RDONLY;
    } else if (typeof flags === 'number') {
        posix = flags;
    } else {
        const bits = stringFlagBits(flags, O);
        if (bits === undefined) {
            const err = new TypeError(`Unknown file open flag: ${flags}`) as NodeJS.ErrnoException;
            err.code = 'ERR_INVALID_ARG_VALUE';
            throw err;
        }
        posix = bits;
    }

    const accessMode = posix & (O.O_RDONLY | O.O_WRONLY | O.O_RDWR);
    return {
        posix,
        readable: accessMode === O.O_RDONLY || accessMode === O.O_RDWR,
        writable: accessMode === O.O_WRONLY || accessMode === O.O_RDWR,
        append: (posix & O.O_APPEND) !== 0,
        creat: (posix & O.O_CREAT) !== 0,
        // POSIX leaves `O_EXCL` without `O_CREAT` undefined and Node simply
        // opens the file. Treating the bit alone as exclusive would make a
        // passed-through flag set start throwing EEXIST on a path that opens
        // fine today, so exclusivity demands both bits.
        excl: (posix & O.O_CREAT) !== 0 && (posix & O.O_EXCL) !== 0,
        trunc: (posix & O.O_TRUNC) !== 0,
        nofollow: O.O_NOFOLLOW !== 0 && (posix & O.O_NOFOLLOW) !== 0,
        directory: O.O_DIRECTORY !== 0 && (posix & O.O_DIRECTORY) !== 0,
    };
}

/**
 * Node's `mode` argument as a number.
 *
 * Node documents `mode` as `string | integer` and parses a string as OCTAL —
 * a plain numeric cast turns `'600'` into decimal 600 = `0o1130` (sticky plus
 * `--x-wx---`), so the caller cannot read back the file it just created. One
 * parser, shared by open / mkdir / mkdtemp / writeFile / appendFile / chmod,
 * because the two that disagreed were the two that drifted.
 *
 * `fallback` is used only when `mode` is absent, and it is OPTIONAL because not
 * every caller has one: Node's `open`/`mkdir`/`writeFile` document a default,
 * and `chmod` does NOT — its `mode` is required, and Node rejects a missing one
 * with `ERR_INVALID_ARG_TYPE`. Handing `chmod` a 0o666 default here made
 * `fs.chmodSync(p, cfg.mode)` with an absent `cfg.mode` silently WIDEN a 0600
 * secret to world-writable, from the shared parser this redesign introduced to
 * stop the two spellings drifting. `0` is a VALID mode and must survive: the
 * old `options.mode ||= 0o666` silently replaced it.
 */
export function normalizeMode(mode: Mode | undefined | null, fallback?: number): number {
    // Node's `parseFileMode`, in its own order: `value ??= def` first, so an
    // absent mode with no default falls into the type check below rather than
    // being invented.
    const requested = mode ?? fallback;

    let value: unknown = requested;
    if (typeof requested === 'string') {
        // Node's `octalReg`, verbatim: `/^[0-7]+$/`, tested BEFORE the parse and
        // matching the WHOLE string — because `parseInt` is lenient in exactly
        // the two directions that matter. It accepts a sign, so
        // `parseInt('-1', 8)` is `-1` and not `NaN`; a NaN-only guard therefore
        // passed a negative mode to `open(2)`, where the kernel read the gint
        // as unsigned and masked it to 0o7777 — `openSync(p, 'w', '-1')`
        // created a SETUID + SETGID + STICKY file, and `mkdirSync(d, '-1')` a
        // sticky directory. It also stops at the first invalid digit rather
        // than rejecting the value.
        if (!/^[0-7]+$/.test(requested)) throw invalidMode(requested);
        value = parseInt(requested, 8);
    }

    // Node's `validateUint32`, applied to BOTH branches and in ITS OWN ORDER.
    // The type check is `validateUint32`'s FIRST, and dropping it is what made
    // `openSync(p,'w',true)` and `openSync(p,'w',{})` throw a RangeError
    // (`ERR_OUT_OF_RANGE`) where Node — and the code this replaced — throw a
    // TypeError, so the universal `catch (e) { if (e instanceof TypeError) }`
    // stopped matching. The range checks after it are what the string branch
    // needs just as much: `'77777777777'` is well-formed octal and parses to
    // 8589934591, which does not fit the `guint32` the syscall takes — it
    // reached `open(2)` truncated, and produced 0o7755 as well.
    if (typeof value !== 'number') throw modeNotANumber(value);
    if (!Number.isInteger(value)) throw modeOutOfRange('an integer', value);
    if (value < 0 || value > 4294967295) throw modeOutOfRange('>= 0 && <= 4294967295', value);
    return value;
}

function invalidMode(mode: string): NodeJS.ErrnoException {
    const err = new TypeError(
        `The argument 'mode' must be a 32-bit unsigned integer or an octal string. Received '${mode}'`,
    ) as NodeJS.ErrnoException;
    err.code = 'ERR_INVALID_ARG_VALUE';
    return err;
}

/** Node's `ERR_INVALID_ARG_TYPE` for `mode` — a TypeError, never a RangeError. */
function modeNotANumber(value: unknown): NodeJS.ErrnoException {
    const received =
        value === null || value === undefined ? String(value) : `type ${typeof value} (${describeValue(value)})`;
    const err = new TypeError(
        `The "mode" argument must be of type number. Received ${received}`,
    ) as NodeJS.ErrnoException;
    err.code = 'ERR_INVALID_ARG_TYPE';
    return err;
}

/** A short, throw-free rendering of a rejected value for the message above. */
function describeValue(value: unknown): string {
    try {
        return typeof value === 'object' ? Object.prototype.toString.call(value) : String(value);
    } catch {
        // A `Symbol` has no implicit string conversion and an exotic object can
        // throw from `toString`; the message must never replace the error.
        return '<unprintable>';
    }
}

function modeOutOfRange(expected: string, value: number): NodeJS.ErrnoException {
    const err = new RangeError(
        `The value of "mode" is out of range. It must be ${expected}. Received ${value}`,
    ) as NodeJS.ErrnoException;
    err.code = 'ERR_OUT_OF_RANGE';
    return err;
}
