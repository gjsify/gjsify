// SPDX-License-Identifier: MIT
// Browser test entry for @gjsify/console.
//
// Uses the browser-native `console` global directly — never imports the GJS
// `@gjsify/console` implementation (which wraps Node streams via `gi://`
// bindings that have no browser equivalent). Per the workspace browser-test
// convention, browser tests verify that the native platform behaves the way
// our GJS polyfill claims. The Node-only `Console` class with stdout/stderr
// stream constructors is intentionally out of scope here — a browser has no
// Node stream model — so this entry exercises only the globally-available
// `console` surface.

import { run, describe, it, expect } from '@gjsify/unit';

run({
    async ConsoleTest() {
        await describe('console: global object', async () => {
            await it('console is an object', async () => {
                expect(console instanceof Object).toBeTruthy();
            });

            await it('has the standard logging methods', async () => {
                expect(typeof console.log).toBe('function');
                expect(typeof console.warn).toBe('function');
                expect(typeof console.error).toBe('function');
                expect(typeof console.info).toBe('function');
                expect(typeof console.debug).toBe('function');
            });

            await it('has the grouping / counting / timing methods', async () => {
                expect(typeof console.group).toBe('function');
                expect(typeof console.groupEnd).toBe('function');
                expect(typeof console.groupCollapsed).toBe('function');
                expect(typeof console.count).toBe('function');
                expect(typeof console.countReset).toBe('function');
                expect(typeof console.time).toBe('function');
                expect(typeof console.timeEnd).toBe('function');
                expect(typeof console.timeLog).toBe('function');
            });

            await it('has the inspection / assertion methods', async () => {
                expect(typeof console.dir).toBe('function');
                expect(typeof console.table).toBe('function');
                expect(typeof console.trace).toBe('function');
                expect(typeof console.assert).toBe('function');
                expect(typeof console.clear).toBe('function');
            });
        });

        await describe('console: logging does not throw', async () => {
            await it('log handles various argument types', async () => {
                expect(() => console.log('string')).not.toThrow();
                expect(() => console.log(42)).not.toThrow();
                expect(() => console.log({ key: 'value' })).not.toThrow();
                expect(() => console.log(null)).not.toThrow();
                expect(() => console.log(undefined)).not.toThrow();
                expect(() => console.log([1, 2, 3])).not.toThrow();
            });

            await it('log handles multiple arguments and format specifiers', async () => {
                expect(() => console.log('a', 'b', 'c')).not.toThrow();
                expect(() => console.log('hello %s', 'world')).not.toThrow();
                expect(() => console.log('number: %d', 42)).not.toThrow();
            });

            await it('warn / error / info / debug do not throw', async () => {
                expect(() => console.warn('warning')).not.toThrow();
                expect(() => console.error('error')).not.toThrow();
                expect(() => console.info('info')).not.toThrow();
                expect(() => console.debug('debug')).not.toThrow();
            });
        });

        await describe('console: assert behavior', async () => {
            await it('does not throw on truthy assertion', async () => {
                expect(() => console.assert(true)).not.toThrow();
                expect(() => console.assert('non-empty')).not.toThrow();
            });

            await it('does not throw on false assertion', async () => {
                expect(() => console.assert(false)).not.toThrow();
                expect(() => console.assert(false, 'message', 42)).not.toThrow();
            });
        });

        await describe('console: count / countReset behavior', async () => {
            await it('count and countReset do not throw', async () => {
                expect(() => console.count('test-label')).not.toThrow();
                expect(() => console.count('test-label')).not.toThrow();
                expect(() => console.countReset('test-label')).not.toThrow();
                expect(() => console.count()).not.toThrow();
                expect(() => console.countReset()).not.toThrow();
            });
        });

        await describe('console: time / timeEnd behavior', async () => {
            await it('time, timeLog and timeEnd do not throw', async () => {
                expect(() => console.time('test-timer')).not.toThrow();
                expect(() => console.timeLog('test-timer')).not.toThrow();
                expect(() => console.timeEnd('test-timer')).not.toThrow();
            });

            await it('timeEnd without a matching time does not throw', async () => {
                expect(() => console.timeEnd('nonexistent-timer')).not.toThrow();
            });
        });

        await describe('console: group / groupEnd behavior', async () => {
            await it('group and groupEnd do not throw', async () => {
                expect(() => console.group('test-group')).not.toThrow();
                expect(() => console.groupEnd()).not.toThrow();
            });

            await it('nested groups and groupCollapsed do not throw', async () => {
                expect(() => {
                    console.group('outer');
                    console.groupCollapsed('inner');
                    console.groupEnd();
                    console.groupEnd();
                }).not.toThrow();
            });
        });

        await describe('console: dir / table / trace / clear behavior', async () => {
            await it('dir does not throw', async () => {
                expect(() => console.dir({ key: 'value' })).not.toThrow();
            });

            await it('table does not throw', async () => {
                expect(() =>
                    console.table([
                        { a: 1, b: 2 },
                        { a: 3, b: 4 },
                    ]),
                ).not.toThrow();
            });

            await it('trace does not throw', async () => {
                expect(() => console.trace()).not.toThrow();
                expect(() => console.trace('trace message')).not.toThrow();
            });

            await it('clear does not throw', async () => {
                expect(() => console.clear()).not.toThrow();
            });
        });
    },
});
