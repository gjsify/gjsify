// SPDX-License-Identifier: MIT
//
// The `GError` → `SystemError` mapping, including the two ways it can be wrong.
//
// A mapping that only ever gets asked about `NotFound` is not a mapping, it is a
// special case with a table around it. So the cases that matter here are the ones
// where a naive implementation agrees with a correct one for the wrong reason: a
// same-numbered code from another domain, and a GIO code Effect has no tag for.

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import { describe, expect, it } from '@gjsify/unit';

import { isIoError, reasonOf, toPlatformError } from './errors.js';

// `number` and not `Gio.IOErrorEnum`: `GLib.Error.new_literal` is typed to take a
// plain code, and the enum members widen to `number` on the way in.
const ioError = (code: number, message: string) => GLib.Error.new_literal(Gio.io_error_quark(), code, message);

export default async () => {
    await describe('GError → Effect SystemError', async () => {
        await it('maps the GIO codes Effect has tags for', async () => {
            expect(reasonOf(ioError(Gio.IOErrorEnum.NOT_FOUND, 'gone'))).toBe('NotFound');
            expect(reasonOf(ioError(Gio.IOErrorEnum.EXISTS, 'there'))).toBe('AlreadyExists');
            expect(reasonOf(ioError(Gio.IOErrorEnum.PERMISSION_DENIED, 'no'))).toBe('PermissionDenied');
            expect(reasonOf(ioError(Gio.IOErrorEnum.BUSY, 'busy'))).toBe('Busy');
            expect(reasonOf(ioError(Gio.IOErrorEnum.TIMED_OUT, 'slow'))).toBe('TimedOut');
            expect(reasonOf(ioError(Gio.IOErrorEnum.INVALID_DATA, 'junk'))).toBe('InvalidData');
        });

        await it('refuses a same-numbered code from another domain', async () => {
            // Measured, and NOT the pair one would guess: `GLib.FileError.EXIST` is
            // 0. The code that actually collides with `Gio.IOErrorEnum.NOT_FOUND` is
            // `GLib.FileError.ISDIR`, so a mapping that reads the code without the
            // domain reports "is a directory" as "not found". The two `toBe(1)` lines
            // are here so this case fails loudly if a future GLib renumbers them and
            // the collision it is built on stops existing.
            expect(Gio.IOErrorEnum.NOT_FOUND).toBe(1);
            expect(GLib.FileError.ISDIR).toBe(1);
            const foreign = GLib.Error.new_literal(GLib.file_error_quark(), GLib.FileError.ISDIR, 'other domain');
            expect(reasonOf(foreign)).toBe('Unknown');
            expect(isIoError(foreign)).toBe(false);
        });

        await it('does not invent a near-miss tag for a GIO code Effect lacks', async () => {
            // `IS_DIRECTORY` is real and specific; Effect's vocabulary has no tag for
            // it. `Unknown` plus the message is honest, `InvalidData` would not be.
            expect(reasonOf(ioError(Gio.IOErrorEnum.IS_DIRECTORY, 'is a directory'))).toBe('Unknown');
            expect(reasonOf(ioError(Gio.IOErrorEnum.NOT_EMPTY, 'not empty'))).toBe('Unknown');
        });

        await it('treats a plain JS error as Unknown rather than guessing', async () => {
            expect(reasonOf(new TypeError('not a GError'))).toBe('Unknown');
            expect(reasonOf('a string')).toBe('Unknown');
            expect(isIoError(new TypeError('x'))).toBe(false);
        });

        await it('wraps into the PlatformError shape effect/FileSystem declares', async () => {
            const error = toPlatformError({
                method: 'readFile',
                pathOrDescriptor: '/etc/nope',
                error: ioError(Gio.IOErrorEnum.NOT_FOUND, 'No such file or directory'),
            });
            expect(error._tag).toBe('PlatformError');
            expect(error.reason._tag).toBe('NotFound');
            expect(error.reason.module).toBe('FileSystem');
            expect(error.reason.method).toBe('readFile');
            // The module is the Effect SERVICE, not the GIO class, so a consumer
            // cannot tell from the message which layer produced it.
            expect(error.message.startsWith('NotFound: FileSystem.readFile (/etc/nope)')).toBe(true);
        });

        await it('keeps the original error as the cause', async () => {
            const original = ioError(Gio.IOErrorEnum.PERMISSION_DENIED, 'nope');
            const error = toPlatformError({ method: 'stat', pathOrDescriptor: '/root/x', error: original });
            expect(error.reason.cause).toBe(original);
        });

        await it('names the foreign domain in the description', async () => {
            const foreign = GLib.Error.new_literal(GLib.file_error_quark(), GLib.FileError.ACCES, 'denied');
            const error = toPlatformError({ method: 'stat', error: foreign });
            expect(error.reason._tag).toBe('Unknown');
            expect(error.reason.description?.includes('g-file-error-quark')).toBe(true);
        });
    });
};
