// `tty`'s terminal properties have the same contract as `@gjsify/process`'s
// and the same cause: the optional `GjsifyTerminal` prebuild can resolve as a
// typelib while its shared library will not `dlopen` (macOS SIP strips every
// `DYLD_*` variable at the `/bin/sh` hop, so the typelib survives and the
// library does not), and a namespace in that state reads fine but raises
// "Unsupported type void, deriving from fundamental void" at the first CALL.
//
// `tty` is where a UI library lands: `isatty` runs during construction and the
// size getters during render, so a throw here takes down an app that has an
// env/GLib fallback sitting right there. Every row below pins SHAPE — the
// fallback is the point, and which number a pipe or a real terminal reports is
// the host's, not the test's.
//
// GJS-only: that state cannot exist on Node, where `node:tty` IS the working
// Node implementation and `@gjsify/terminal-native` reports no module at all.
// Both legs build the same `src/test.mts`, so `on('Gjs')` is what keeps these
// rows out of the node run — and it has to be a gate rather than a shared spec,
// because Node's own `tty` is a different module with a different contract (no
// `columns` on a pipe, `uv_tty_init` EINVAL on a non-tty fd).

import { describe, it, expect, on } from '@gjsify/unit';
import { ReadStream, WriteStream, isatty } from 'node:tty';

export default async () => {
    await on('Gjs', async () => {
        await describe('terminal properties answer even without a loadable native library', async () => {
            await it('WriteStream.columns is a positive number', async () => {
                const columns = new WriteStream(1).columns;
                expect(typeof columns).toBe('number');
                expect(columns > 0).toBe(true);
            });

            await it('WriteStream.rows is a positive number', async () => {
                const rows = new WriteStream(1).rows;
                expect(typeof rows).toBe('number');
                expect(rows > 0).toBe(true);
            });

            await it('WriteStream.isTTY is a boolean', async () => {
                expect(typeof new WriteStream(1).isTTY).toBe('boolean');
            });

            await it('an assigned size stays a number on read back', async () => {
                // The env/GLib fallback seeds `_columns`/`_rows` in the
                // constructor, so the setters are the only deterministic way to
                // reach a known state. A native read may still override them on
                // a real terminal, so the SHAPE is what is pinned — what must
                // never happen is the getter raising.
                const stream = new WriteStream(1);
                stream.columns = 123;
                stream.rows = 45;
                expect(typeof stream.columns).toBe('number');
                expect(typeof stream.rows).toBe('number');
            });

            await it('isatty answers a boolean for a number and for a stream', async () => {
                // `node:tty` is typed by `@types/node` on the node leg and by this
                // package on the gjs leg, and only the NUMBER overload is common
                // to both — so the stream overloads go through a widened
                // signature rather than through the type.
                expect(typeof isatty(1)).toBe('boolean');
                const isattyWide = isatty as (fd: unknown) => boolean;
                expect(typeof isattyWide(new ReadStream(0))).toBe('boolean');
                expect(typeof isattyWide(new WriteStream(1))).toBe('boolean');
            });

            await it('ReadStream.setRawMode flips isRaw without throwing', async () => {
                // `setRawMode` is on `ReadStream` only — Node has no
                // `tty.WriteStream.setRawMode`, so neither leg has one to
                // assert. The contract is that neither the native call nor its
                // absence escapes as an exception into a caller restoring a mode.
                const stream = new ReadStream(0);
                expect(() => stream.setRawMode(true)).not.toThrow();
                expect(stream.isRaw).toBe(true);
            });
        });
    });
};
