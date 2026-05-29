// SPDX-License-Identifier: MIT
// Inspired by https://github.com/debug-js/debug/blob/master/test.node.js
// + the format-specifier surface documented in debug's README
// ("Formatters").
// Original: Copyright (c) 2014 TJ Holowaychuk <tj@vision-media.ca>. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Exercises debug's format specifier surface end-to-end. Specifiers
// `%s`, `%d`, `%j`, `%o`, `%O` are wired into `util.formatWithOptions`
// (which runs through `@gjsify/util` on GJS); `%h` is a custom
// formatter registered by the consumer and must round-trip.
// `%%` must remain a literal `%`.

import { describe, it, expect } from '@gjsify/unit';
import debug from 'debug';
import { captureStderr, setUseColors } from './capture.js';

function reset(): void {
    debug.disable();
}

export default async () => {
    await describe('debug — built-in format specifiers (%s %d %j %o %O %%)', async () => {
        await it('`%s` substitutes a string argument', () => {
            reset();
            debug.enable('fmt:*');
            const log = debug('fmt:s');
            setUseColors(log, false);
            const cap = captureStderr();
            try {
                log('hello %s', 'world');
            } finally {
                cap.restore();
            }
            expect(cap.output).toContain('fmt:s');
            expect(cap.output).toContain('hello world');
        });

        await it('`%d` substitutes a numeric argument', () => {
            reset();
            debug.enable('fmt:*');
            const log = debug('fmt:d');
            setUseColors(log, false);
            const cap = captureStderr();
            try {
                log('count=%d', 42);
            } finally {
                cap.restore();
            }
            expect(cap.output).toContain('count=42');
        });

        await it('`%j` substitutes a JSON-serialised argument', () => {
            reset();
            debug.enable('fmt:*');
            const log = debug('fmt:j');
            setUseColors(log, false);
            const cap = captureStderr();
            try {
                log('payload=%j', { a: 1, b: 'two' });
            } finally {
                cap.restore();
            }
            expect(cap.output).toContain('payload={"a":1,"b":"two"}');
        });

        await it('`%o` inlines util.inspect on a single line', () => {
            reset();
            debug.enable('fmt:*');
            const log = debug('fmt:o');
            setUseColors(log, false);
            const cap = captureStderr();
            try {
                log('%o', { x: 1, y: 2 });
            } finally {
                cap.restore();
            }
            // %o joins the inspect output with spaces, so no embedded \n
            // between the braces and properties.
            const body = cap.output;
            expect(body).toContain('x: 1');
            expect(body).toContain('y: 2');
            // The %o-formatted segment itself contains no newline.
            const inspected = body.split('fmt:o')[1] ?? '';
            expect(inspected.includes('\n{\n')).toBe(false);
        });

        await it('`%O` runs util.inspect with default multi-line layout', () => {
            reset();
            debug.enable('fmt:*');
            const log = debug('fmt:O');
            setUseColors(log, false);
            const cap = captureStderr();
            try {
                log('%O', { x: 1, y: 2 });
            } finally {
                cap.restore();
            }
            expect(cap.output).toContain('x: 1');
            expect(cap.output).toContain('y: 2');
        });

        await it('`%%` is preserved as a literal `%`', () => {
            reset();
            debug.enable('fmt:*');
            const log = debug('fmt:pct');
            setUseColors(log, false);
            const cap = captureStderr();
            try {
                log('progress 50%% done');
            } finally {
                cap.restore();
            }
            // Single literal `%` (not the `%%` escape, not consumed by a specifier).
            expect(cap.output).toContain('progress 50% done');
            expect(cap.output).not.toContain('50%%');
        });

        await it('first non-string argument is auto-wrapped with `%O`', () => {
            reset();
            debug.enable('fmt:*');
            const log = debug('fmt:obj');
            setUseColors(log, false);
            const cap = captureStderr();
            try {
                // Per common.js: if typeof args[0] !== 'string', `%O` is unshifted.
                log({ greeting: 'hi' });
            } finally {
                cap.restore();
            }
            expect(cap.output).toContain('greeting');
            expect(cap.output).toContain("'hi'");
        });

        await it('coerces Error arguments via .stack || .message', () => {
            reset();
            debug.enable('fmt:*');
            const log = debug('fmt:err');
            setUseColors(log, false);
            const cap = captureStderr();
            try {
                log(new Error('boom'));
            } finally {
                cap.restore();
            }
            // coerce() returns err.stack ?? err.message → "Error: boom\n  at …"
            expect(cap.output).toContain('Error: boom');
        });
    });

    await describe('debug — custom formatters', async () => {
        await it('honors a user-registered `%h` formatter', () => {
            reset();
            // Custom hex formatter for numbers.
            (debug.formatters as Record<string, (v: unknown) => string>).h = (v) =>
                '0x' + (v as number).toString(16);
            debug.enable('fmt:custom');
            const log = debug('fmt:custom');
            setUseColors(log, false);
            const cap = captureStderr();
            try {
                log('addr=%h', 255);
            } finally {
                cap.restore();
            }
            expect(cap.output).toContain('addr=0xff');
        });

        await it('an unknown specifier is left as-is', () => {
            reset();
            // Make sure nothing else has registered `%q` from a previous test.
            delete (debug.formatters as Record<string, unknown>).q;
            debug.enable('fmt:unknown');
            const log = debug('fmt:unknown');
            setUseColors(log, false);
            const cap = captureStderr();
            try {
                log('val=%q', 'ignored');
            } finally {
                cap.restore();
            }
            // common.js replace() leaves the original `%q` token in place
            // because the formatter is missing; the extra `'ignored'`
            // argument is appended through util.formatWithOptions.
            expect(cap.output).toContain('val=%q');
            expect(cap.output).toContain('ignored');
        });

        await it('custom formatter receives `this` bound to the debug instance', () => {
            reset();
            let capturedNamespace: string | null = null;
            (debug.formatters as Record<string, (this: { namespace: string }, v: unknown) => string>).N = function (
                v,
            ) {
                capturedNamespace = this.namespace;
                return String(v);
            };
            debug.enable('fmt:this');
            const log = debug('fmt:this');
            setUseColors(log, false);
            const cap = captureStderr();
            try {
                log('ns=%N', 'ok');
            } finally {
                cap.restore();
            }
            expect(capturedNamespace).toBe('fmt:this');
            expect(cap.output).toContain('ns=ok');
        });
    });
};
