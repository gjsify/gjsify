// SPDX-License-Identifier: MIT
// Ported from https://github.com/debug-js/debug/blob/master/test.js
// Original: Copyright (c) 2014 TJ Holowaychuk <tj@vision-media.ca>. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Exercises debug's namespace enable/disable + wildcard + exclusion
// matching surface (`debug.enable('foo:*,-foo:bar')` etc). This is the
// part of `debug` that pure code (no I/O) consumers — Express,
// socket.io, eslint — rely on for "should this namespace log at all?".

import { describe, it, expect } from '@gjsify/unit';
import debug from 'debug';

// Each test starts from a clean enable state. We can't rely on a
// beforeEach hook running between every `it` (the @gjsify/unit
// runner is async-sequential), so each block disables explicitly.
function reset(): void {
    debug.disable();
}

export default async () => {
    await describe('debug — sanity', async () => {
        await it('passes a basic sanity check', () => {
            reset();
            const log = debug('test');
            log.enabled = true;
            log.log = () => {};
            // Must not throw — same upstream assert.doesNotThrow.
            expect(() => log('hello world')).not.toThrow();
        });

        await it('allows debug.enable to be called with a non-string value', () => {
            reset();
            // Upstream test: `assert.doesNotThrow(() => debug.enable(true))`.
            expect(() => debug.enable(true as unknown as string)).not.toThrow();
        });

        await it('uses a custom log function', () => {
            reset();
            const log = debug('test');
            log.enabled = true;
            const messages: unknown[][] = [];
            log.log = (...args: unknown[]) => messages.push(args);
            log('using custom log function');
            log('using custom log function again');
            log('%O', 12345);
            expect(messages.length).toBe(3);
        });
    });

    await describe('debug — namespace enable / disable', async () => {
        await it('honors global namespace enable calls', () => {
            reset();
            // Both default to disabled.
            expect(debug('test:12345').enabled).toBe(false);
            expect(debug('test:67890').enabled).toBe(false);

            debug.enable('test:12345');
            expect(debug('test:12345').enabled).toBe(true);
            expect(debug('test:67890').enabled).toBe(false);
        });

        await it('wildcard `foo:*` enables every child namespace', () => {
            reset();
            debug.enable('foo:*');
            expect(debug('foo:bar').enabled).toBe(true);
            expect(debug('foo:baz').enabled).toBe(true);
            expect(debug('foo:nested:deeper').enabled).toBe(true);
            expect(debug('other:thing').enabled).toBe(false);
        });

        await it('exclusion (`-foo:bar`) overrides a positive wildcard', () => {
            reset();
            debug.enable('foo:*,-foo:bar');
            // foo:* matches everything except the excluded foo:bar.
            expect(debug('foo:baz').enabled).toBe(true);
            expect(debug('foo:nested').enabled).toBe(true);
            expect(debug('foo:bar').enabled).toBe(false);
        });

        await it('bare `*` enables everything', () => {
            reset();
            debug.enable('*');
            expect(debug('anything').enabled).toBe(true);
            expect(debug('foo:bar:baz').enabled).toBe(true);
        });

        await it('`-*` disables everything (skip-all)', () => {
            reset();
            debug.enable('-*');
            // names is empty AND every name is skipped.
            expect(debug('foo').enabled).toBe(false);
            expect(debug('bar:baz').enabled).toBe(false);
        });

        await it('comma + whitespace separation parses both', () => {
            reset();
            debug.enable('foo, bar ,baz');
            expect(debug('foo').enabled).toBe(true);
            expect(debug('bar').enabled).toBe(true);
            expect(debug('baz').enabled).toBe(true);
            expect(debug('qux').enabled).toBe(false);
        });
    });

    await describe('debug — disable() rebuilds the namespaces string', async () => {
        await it('round-trips names + skips + wildcards', () => {
            debug.enable('test,abc*,-abc');
            const namespaces = debug.disable();
            expect(namespaces).toBe('test,abc*,-abc');
        });

        await it('empty enable() round-trips to empty', () => {
            debug.enable('');
            const namespaces = debug.disable();
            expect(namespaces).toBe('');
            expect(debug.names).toStrictEqual([]);
            expect(debug.skips).toStrictEqual([]);
        });

        await it('round-trips `*`', () => {
            debug.enable('*');
            expect(debug.disable()).toBe('*');
        });

        await it('round-trips `-*`', () => {
            debug.enable('-*');
            expect(debug.disable()).toBe('-*');
        });

        await it('round-trips through a re-enable cycle (names + skips identical)', () => {
            debug.enable('test,abc*,-abc');
            const oldNames = [...debug.names];
            const oldSkips = [...debug.skips];
            const namespaces = debug.disable();
            expect(namespaces).toBe('test,abc*,-abc');
            debug.enable(namespaces);
            expect(oldNames.map(String)).toStrictEqual(debug.names.map(String));
            expect(oldSkips.map(String)).toStrictEqual(debug.skips.map(String));
        });

        await it('re-enabling existing instances picks up new enable state', () => {
            debug.disable();
            const inst = debug('foo');
            const messages: string[] = [];
            // Strip the timestamp / color prefix that debug prepends so we can
            // assert just on the payload between two `@` markers we inject.
            inst.log = (msg: string) => messages.push(msg.replace(/^[^@]*@([^@]+)@.*$/, '$1'));

            inst('@test@');
            expect(messages).toStrictEqual([]);
            debug.enable('foo');
            // Even after enable, no retroactive emission of past calls.
            expect(messages).toStrictEqual([]);
            inst('@test2@');
            expect(messages).toStrictEqual(['test2']);
            inst('@test3@');
            expect(messages).toStrictEqual(['test2', 'test3']);
            debug.disable();
            inst('@test4@');
            expect(messages).toStrictEqual(['test2', 'test3']);
        });
    });

    await describe('debug — extend()', async () => {
        await it('extends the namespace with the default `:` delimiter', () => {
            reset();
            const log = debug('foo');
            log.enabled = true;
            log.log = () => {};
            const logBar = log.extend('bar');
            expect(logBar.namespace).toBe('foo:bar');
        });

        await it('extends with a custom delimiter', () => {
            reset();
            const log = debug('foo');
            log.enabled = true;
            log.log = () => {};
            const logBar = log.extend('bar', '--');
            expect(logBar.namespace).toBe('foo--bar');
        });

        await it('extends with an empty delimiter', () => {
            reset();
            const log = debug('foo');
            log.enabled = true;
            log.log = () => {};
            const logBar = log.extend('bar', '');
            expect(logBar.namespace).toBe('foobar');
        });

        await it('child instance inherits the parent.log function', () => {
            reset();
            const log = debug('foo');
            const fn = () => {};
            log.log = fn;
            const logBar = log.extend('bar');
            expect(log.log).toBe(logBar.log);
        });
    });
};
