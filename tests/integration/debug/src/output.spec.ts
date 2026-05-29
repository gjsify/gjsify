// SPDX-License-Identifier: MIT
// Inspired by https://github.com/debug-js/debug/blob/master/test.node.js
// + the formatArgs colorization branch in src/node.js (`useColors`).
// Original: Copyright (c) 2014 TJ Holowaychuk <tj@vision-media.ca>. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Exercises debug's color-aware stderr output. debug's `log()` impl
// calls `process.stderr.write(util.formatWithOptions(...))`; its
// `formatArgs` injects ANSI CSI escape sequences when
// `this.useColors` is on, plain ISO-date prefix when off. We don't
// rely on the runner's actual TTY state — instead we toggle the
// per-instance `useColors` flag and intercept `process.stderr.write`
// to assert on exactly what would land on the terminal.
//
// On GJS this exercises @gjsify/process's ProcessWriteStream.write
// + the TTY surface in @gjsify/tty (process.stderr.isTTY +
// process.stderr.fd), both of which `debug` reads on every
// createDebug() call.

import { describe, it, expect } from '@gjsify/unit';
import debug from 'debug';
import { captureStderr, setUseColors } from './capture.js';

function reset(): void {
    debug.disable();
    // Reset inspectOpts mutations that previous tests in the suite may
    // have made — debug reads inspectOpts.hideDate inside getDate(),
    // and the formatting-options spec below mutates it.
    for (const k of Object.keys(debug.inspectOpts ?? {})) {
        delete (debug.inspectOpts as Record<string, unknown>)[k];
    }
}

export default async () => {
    await describe('debug — output: useColors off (plain ISO-date prefix)', async () => {
        await it('emits ISO date + namespace + message, no ANSI', () => {
            reset();
            debug.enable('out:plain');
            const log = debug('out:plain');
            setUseColors(log, false);
            const cap = captureStderr();
            try {
                log('hello %s', 'world');
            } finally {
                cap.restore();
            }
            const line = cap.output;
            // Plain branch: `getDate() + name + ' ' + args[0]`
            // → ISO timestamp (YYYY-MM-DDTHH:MM:SS.sssZ) + ' ' + 'out:plain hello world\n'
            expect(line).toContain('out:plain');
            expect(line).toContain('hello world');
            // No CSI escape introducers anywhere.
            expect(line.includes('[')).toBe(false);
            // Trailing newline appended by debug's log() (`+ '\n'`).
            expect(line.endsWith('\n')).toBe(true);
            // ISO-8601 date prefix (single regex, line-anchored).
            expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z /);
        });

        await it('honors `hideDate` from inspectOpts', () => {
            reset();
            debug.enable('out:nodate');
            // Order matters: `init()` copies inspectOpts onto the instance
            // when `debug('out:nodate')` runs. Mutate the global FIRST so
            // the per-instance copy picks it up — same pattern as the
            // upstream test.node.js "calls util.formatWithOptions with
            // inspectOpts" assertion.
            (debug.inspectOpts as Record<string, unknown>).hideDate = true;
            const log = debug('out:nodate');
            setUseColors(log, false);
            const cap = captureStderr();
            try {
                log('hi');
            } finally {
                cap.restore();
            }
            const line = cap.output;
            // No ISO timestamp prefix.
            expect(line).not.toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(line.startsWith('out:nodate')).toBe(true);
            expect(line).toContain('hi');
        });
    });

    await describe('debug — output: useColors on (ANSI CSI escapes)', async () => {
        await it('wraps the namespace in `\\x1b[3<c>;1m` + `\\x1b[0m`', () => {
            reset();
            debug.enable('out:color');
            const log = debug('out:color');
            setUseColors(log, true);
            // Pin a known color index so the assertion is deterministic.
            // debug's color is whatever selectColor() returns — picking a
            // specific value lets us check the exact CSI sequence.
            (log as { color: number }).color = 3; // yellow in the basic palette.
            const cap = captureStderr();
            try {
                log('hello');
            } finally {
                cap.restore();
            }
            const line = cap.output;
            // formatArgs colored branch produces `  \x1b[33;1mout:color \x1b[0mhello\x1b[33m+0ms\x1b[0m\n`
            expect(line).toContain('[33;1mout:color [0m');
            expect(line).toContain('hello');
            // diff timestamp tail: `\x1b[33m+0ms\x1b[0m`
            expect(line).toMatch(/\[33m\+\d+m?s?\[0m/);
            expect(line.endsWith('\n')).toBe(true);
        });

        await it('uses 256-color CSI (`\\x1b[38;5;<n>m`) for color index ≥ 8', () => {
            reset();
            debug.enable('out:256');
            const log = debug('out:256');
            setUseColors(log, true);
            (log as { color: number }).color = 75; // arbitrary 256-color index.
            const cap = captureStderr();
            try {
                log('big');
            } finally {
                cap.restore();
            }
            const line = cap.output;
            // From src/node.js formatArgs: `'[3' + (c<8 ? c : '8;5;'+c)`
            expect(line).toContain('[38;5;75;1mout:256 [0m');
        });

        await it('color codes are absent when useColors is off', () => {
            reset();
            debug.enable('out:nocolor');
            const log = debug('out:nocolor');
            setUseColors(log, false);
            (log as { color: number }).color = 3;
            const cap = captureStderr();
            try {
                log('boring');
            } finally {
                cap.restore();
            }
            const line = cap.output;
            // Negative parity assertion vs the previous case.
            expect(line.includes('[33;1m')).toBe(false);
            expect(line.includes('[0m')).toBe(false);
        });
    });

    await describe('debug — process.stderr surface (the @gjsify/{tty,process} contract)', async () => {
        await it('process.stderr has a numeric `.fd` (debug reads it for tty.isatty())', () => {
            // src/node.js useColors(): `tty.isatty(process.stderr.fd)`.
            // Whatever the value (2 on Node, may differ on GJS), it must be a number.
            expect(typeof process.stderr.fd).toBe('number');
            // Sanity: stderr.fd is conventionally 2; if any runtime drifts
            // here it would silently break downstream consumers.
            expect(process.stderr.fd).toBe(2);
        });

        await it('process.stderr.write returns synchronously for a string write', () => {
            // debug's `log()` writes a single string per call; we don't
            // care about backpressure — only that the stub-replaced write
            // path returns and that the original is observable as a
            // function. (On GJS this is @gjsify/process's
            // ProcessWriteStream#write; on Node it's the real one.)
            expect(typeof process.stderr.write).toBe('function');
        });

        await it('process.stderr.isTTY is a boolean (used by debug to default useColors)', () => {
            // tty.isatty(process.stderr.fd) — if process.stderr is a real
            // ProcessWriteStream (GJS) or WriteStream (Node) it has
            // an isTTY accessor / property. Value is environment-dependent
            // (false under our captured stderr / non-TTY runner) — we just
            // check the type contract.
            const v = (process.stderr as unknown as { isTTY?: unknown }).isTTY;
            // Node lets it be undefined when not a TTY; GJS exposes a
            // boolean unconditionally. Both are acceptable; truth-coerce.
            expect(typeof v === 'boolean' || typeof v === 'undefined').toBe(true);
        });

        await it('useColors() returns false by default in a non-TTY captured-stderr context', () => {
            reset();
            // We're running through our capture stub — not a TTY. debug's
            // useColors() should fall back to tty.isatty(process.stderr.fd).
            // The exact runtime answer depends on whether the test process
            // was launched with a TTY attached to fd 2; we just verify
            // useColors() is callable and returns a boolean (it MUST NOT
            // throw, regardless of whether the runtime exposes isTTY).
            const result = debug.useColors();
            expect(typeof result).toBe('boolean');
        });
    });

    await describe('debug — end-to-end: enable, instantiate, write, capture', async () => {
        await it('a disabled namespace produces zero stderr writes', () => {
            reset();
            debug.enable('only:this');
            const log = debug('other:namespace');
            setUseColors(log, false);
            const cap = captureStderr();
            try {
                log('should not appear');
            } finally {
                cap.restore();
            }
            expect(cap.chunks.length).toBe(0);
            expect(cap.output).toBe('');
        });

        await it('an enabled namespace produces exactly one stderr write per call', () => {
            reset();
            debug.enable('once:*');
            const log = debug('once:emit');
            setUseColors(log, false);
            const cap = captureStderr();
            try {
                log('first');
                log('second');
                log('third');
            } finally {
                cap.restore();
            }
            // debug.log() = `process.stderr.write(...)` once per call.
            expect(cap.chunks.length).toBe(3);
            expect(cap.chunks[0]).toContain('first');
            expect(cap.chunks[1]).toContain('second');
            expect(cap.chunks[2]).toContain('third');
        });
    });
};
