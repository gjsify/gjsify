// SPDX-License-Identifier: MIT
// Browser test entry for @gjsify/timers.
//
// Uses the browser-native timer globals directly (`setTimeout`,
// `clearTimeout`, `setInterval`, `clearInterval`, `queueMicrotask`). The
// Node-only surface — the `Timeout` object with `ref()`/`unref()`/`hasRef()`,
// `setImmediate`, and `timers/promises` `scheduler` — has no browser pendant
// and is intentionally out of scope. In the browser `setTimeout` returns a
// numeric handle, so this entry validates only the W3C timer contract our GJS
// polyfill mirrors.

import { run, describe, it, expect } from '@gjsify/unit';

run({
    async TimersTest() {
        await describe('setTimeout', async () => {
            await it('calls the callback after the delay', async () => {
                const result = await new Promise<string>((resolve) => {
                    setTimeout(() => resolve('done'), 10);
                });
                expect(result).toBe('done');
            });

            await it('passes arguments through to the callback', async () => {
                const result = await new Promise<string>((resolve) => {
                    setTimeout((a: string, b: string) => resolve(a + b), 10, 'hello', ' world');
                });
                expect(result).toBe('hello world');
            });

            await it('executes with a zero delay', async () => {
                const result = await new Promise<string>((resolve) => {
                    setTimeout(() => resolve('zero'), 0);
                });
                expect(result).toBe('zero');
            });

            await it('fires roughly in scheduled order', async () => {
                const order: number[] = [];
                await new Promise<void>((resolve) => {
                    setTimeout(() => order.push(1), 10);
                    setTimeout(() => {
                        order.push(2);
                        resolve();
                    }, 30);
                });
                expect(order).toStrictEqual([1, 2]);
            });
        });

        await describe('clearTimeout', async () => {
            await it('cancels a pending timeout', async () => {
                let fired = false;
                const handle = setTimeout(() => {
                    fired = true;
                }, 10);
                clearTimeout(handle);
                await new Promise<void>((resolve) => setTimeout(resolve, 40));
                expect(fired).toBe(false);
            });

            await it('does not throw when clearing an undefined handle', async () => {
                expect(() => clearTimeout(undefined)).not.toThrow();
            });
        });

        await describe('setInterval / clearInterval', async () => {
            await it('fires repeatedly until cleared', async () => {
                let count = 0;
                await new Promise<void>((resolve) => {
                    const handle = setInterval(() => {
                        count++;
                        if (count >= 3) {
                            clearInterval(handle);
                            resolve();
                        }
                    }, 10);
                });
                expect(count).toBe(3);
            });

            await it('clearInterval stops further callbacks', async () => {
                let count = 0;
                const handle = setInterval(() => {
                    count++;
                }, 10);
                clearInterval(handle);
                await new Promise<void>((resolve) => setTimeout(resolve, 50));
                expect(count).toBe(0);
            });
        });

        await describe('queueMicrotask', async () => {
            await it('is a function', async () => {
                expect(typeof queueMicrotask).toBe('function');
            });

            await it('runs before a zero-delay timeout', async () => {
                const order: string[] = [];
                await new Promise<void>((resolve) => {
                    setTimeout(() => {
                        order.push('timeout');
                        resolve();
                    }, 0);
                    queueMicrotask(() => order.push('microtask'));
                });
                expect(order[0]).toBe('microtask');
                expect(order).toContain('timeout');
            });
        });
    },
});
