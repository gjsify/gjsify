// A terminal property must ANSWER on every host, including one where the
// optional `GjsifyTerminal` prebuild resolved as a typelib and its shared
// library will not `dlopen` — the macOS SIP case, where a `/bin/sh` strips
// every `DYLD_*` variable so the typelib is found and the library is not.
//
// These getters are read at MODULE INIT by anything that touches `cliui` (yargs
// evaluates `stdColumns: process.stdout.columns` in its own body), so a throw
// here is not a wrong answer, it is a dead process: measured on gjs 1.88.1 /
// arm64, the whole `gjsify` CLI died at import with "Unsupported type void,
// deriving from fundamental void" and nothing naming the missing
// `libgjsifyterminal.dylib`.
//
// The contract these rows pin is therefore SHAPE, not value: a number, a
// boolean, always. Which number is the host's business — a pipe, a terminal and
// a CI runner legitimately differ, and a test asserting 80 would be asserting
// the absence of the fix.
//
// GJS-only: that state cannot exist on Node, where `node:process` is the
// working Node implementation and `@gjsify/terminal-native` reports no module at
// all. Both legs build the same `src/test.mts`, so `on('Gjs')` is what keeps
// these rows out of the node run.

import { describe, it, expect, on } from '@gjsify/unit';
import { ProcessReadStream, ProcessWriteStream } from './streams.js';

export default async () => {
    await on('Gjs', async () => {
        await describe('terminal properties answer even without a loadable native library', async () => {
            await it('stdout.columns is a positive number', async () => {
                const columns = new ProcessWriteStream(1).columns;
                expect(typeof columns).toBe('number');
                expect(columns > 0).toBe(true);
            });

            await it('stdout.rows is a positive number', async () => {
                const rows = new ProcessWriteStream(1).rows;
                expect(typeof rows).toBe('number');
                expect(rows > 0).toBe(true);
            });

            await it('stdout.isTTY is a boolean', async () => {
                expect(typeof new ProcessWriteStream(1).isTTY).toBe('boolean');
            });

            await it('stderr reports the same shape as stdout', async () => {
                const stderr = new ProcessWriteStream(2);
                expect(typeof stderr.columns).toBe('number');
                expect(typeof stderr.rows).toBe('number');
                expect(typeof stderr.isTTY).toBe('boolean');
            });

            await it('stdin.isTTY is a boolean', async () => {
                // fd -1: the constructor opens no Gio stream, and the property is
                // the thing under test — it must not care whether the fd is real.
                expect(typeof new ProcessReadStream(-1).isTTY).toBe('boolean');
            });

            await it('setRawMode updates isRaw without throwing', async () => {
                // fd 1 is a pipe under `gjsify run`, so the native call refuses
                // and the stty fallback runs. Neither path may escape as an
                // exception into a caller that is only restoring a mode.
                const stream = new ProcessReadStream(-1);
                expect(() => stream.setRawMode(true)).not.toThrow();
                expect(stream.isRaw).toBe(true);
            });
        });
    });
};
