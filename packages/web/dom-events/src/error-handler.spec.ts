import { describe, it, expect, assert, spy, on } from '@gjsify/unit';

import { Event, EventTarget } from 'dom-events';
import process from 'node:process';

export const ErrorHandlerTest = async () => {
    await describe('The default error handler', async () => {
        // TODO: FIXME
        await on([], async () => {
            await it('should dispatch an ErrorEvent if a listener threw an error', async () => {
                const _originalConsoleError = console.error;
                const f = spy((_message, _source, _lineno, _colno, _error) => {});
                const consoleError = spy((..._: unknown[]) => {});
                const target = new EventTarget();
                const error = new Error('test error');
                target.addEventListener('foo', () => {
                    throw error;
                });

                window.onerror = f;

                try {
                    target.dispatchEvent(new Event('foo'));
                } finally {
                    window.onerror = null;
                }

                assert.strictEqual(f.calls.length, 1, 'f should be called.');
                // TODO: fails on Deno
                // assert.strictEqual(f.calls[0].arguments[0], error.message)
                // assert.strictEqual(f.calls[0].arguments[4], error)
                assert.strictEqual(consoleError.calls.length, 1, 'console.error should be called.');
                assert.strictEqual(consoleError.calls[0].arguments[0], error);
            });
        });

        // TODO: FIXME
        await on([], async () => {
            await it('should emit an uncaughtException event if a listener threw an error', async () => {
                const onUncaughtException = spy((_event) => {});
                const target = new EventTarget();
                const error = new Error('test error');
                target.addEventListener('foo', () => {
                    throw error;
                });

                process.on('uncaughtException', onUncaughtException);
                target.dispatchEvent(new Event('foo'));
                process.removeListener('uncaughtException', onUncaughtException);

                assert.strictEqual(onUncaughtException.calls.length, 1, 'onUncaughtException should be called.');

                // TODO: this are currently not the same objects, see https://gitlab.gnome.org/GNOME/gjs/-/issues/523
                // assert.strictEqual(onUncaughtException.calls[0].arguments[0], error)
                expect(onUncaughtException.calls[0].arguments[0].message).toBe(error.message);
                expect(onUncaughtException.calls[0].arguments[0].stack?.trim()).toBe(error.stack?.trim());
            });
        });

        // The two specs above are gated to `on([])` because they
        // exercise full W3C error-reporting machinery (window.onerror
        // / process.uncaughtException dispatch) that we haven't yet
        // implemented. The two specs below pin the bits we DO ship:
        // delegate-via-`globalThis.reportError` and the safe-format
        // fallback. Together they are the regression markers for the
        // 2026-05-31 "`{}`-instead-of-error" diagnostic disaster.
        await describe('listener exception reporting (active behaviour)', async () => {
            await it('delegates to globalThis.reportError when available', async () => {
                const g = globalThis as { reportError?: (err: unknown) => void };
                const original = g.reportError;
                const seen: unknown[] = [];
                g.reportError = (err) => seen.push(err);
                try {
                    const target = new EventTarget();
                    const error = new Error('listener threw');
                    target.addEventListener('boom', () => {
                        throw error;
                    });
                    target.dispatchEvent(new Event('boom'));
                    expect(seen.length).toBe(1);
                    expect(seen[0]).toBe(error);
                } finally {
                    if (original === undefined) delete g.reportError;
                    else g.reportError = original;
                }
            });

            await it('REGRESSION (2026-05-31 {}-instead-of-error): fallback prints stack, not bare Error', async () => {
                // Pre-fix: `console.error(err)` on an Error rendered as
                // `{}` under `@gjsify/console`'s `_formatArgs`
                // JSON.stringify path. Post-fix: when no
                // `globalThis.reportError` is wired, we extract
                // `err.stack` (which always carries name + message +
                // frames) so the log line is actually actionable.
                const g = globalThis as { reportError?: (err: unknown) => void };
                const originalReport = g.reportError;
                const originalConsoleError = console.error;
                delete g.reportError;
                const logged: unknown[] = [];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (console as any).error = (...args: unknown[]) => logged.push(args);
                try {
                    const target = new EventTarget();
                    const error = new Error('listener threw safely');
                    target.addEventListener('safe', () => {
                        throw error;
                    });
                    target.dispatchEvent(new Event('safe'));
                    expect(logged.length).toBe(1);
                    const printed = (logged[0] as unknown[])[0];
                    // CRITICAL: printed value must be a string (not the raw
                    // Error object) AND must contain the message so
                    // `@gjsify/console`'s JSON.stringify fallback doesn't
                    // reduce it to `{}`.
                    expect(typeof printed).toBe('string');
                    expect(String(printed)).toContain('listener threw safely');
                    expect(String(printed)).not.toBe('{}');
                    expect(String(printed)).not.toBe('[object Object]');
                } finally {
                    if (originalReport !== undefined) g.reportError = originalReport;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (console as any).error = originalConsoleError;
                }
            });

            await it('fallback formats non-Error throws via String()', async () => {
                const g = globalThis as { reportError?: (err: unknown) => void };
                const originalReport = g.reportError;
                const originalConsoleError = console.error;
                delete g.reportError;
                const logged: unknown[] = [];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (console as any).error = (...args: unknown[]) => logged.push(args);
                try {
                    const target = new EventTarget();
                    target.addEventListener('strthrow', () => {
                        throw 'just a string';
                    });
                    target.dispatchEvent(new Event('strthrow'));
                    expect(logged.length).toBe(1);
                    expect((logged[0] as unknown[])[0]).toBe('just a string');
                } finally {
                    if (originalReport !== undefined) g.reportError = originalReport;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (console as any).error = originalConsoleError;
                }
            });
        });

        // WHATWG DOM § 2.7 "dispatch": an exception thrown by a listener is
        // REPORTED and dispatch continues with the remaining listeners — it
        // never propagates out of `dispatchEvent()`. The plain case has been
        // guarded for a while; these pin the paths where the REPORTING step
        // itself throws, which used to re-open the hole completely (dispatch
        // aborted, remaining listeners silently swallowed, the exception
        // surfaced to the `dispatchEvent()` caller AND the event stayed
        // flagged as "currently dispatching" forever).
        await describe('listener exceptions never escape dispatch', async () => {
            await it('keeps invoking later listeners after one throws', async () => {
                const originalConsoleError = console.error;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (console as any).error = () => {};
                try {
                    const target = new EventTarget();
                    const seen: number[] = [];
                    target.addEventListener('multi', () => seen.push(1));
                    target.addEventListener('multi', () => {
                        throw new Error('middle listener exploded');
                    });
                    target.addEventListener('multi', () => seen.push(3));
                    expect(target.dispatchEvent(new Event('multi'))).toBe(true);
                    expect(seen).toStrictEqual([1, 3]);
                } finally {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (console as any).error = originalConsoleError;
                }
            });

            await it('survives a thrown value whose accessors throw', async () => {
                const g = globalThis as { reportError?: (err: unknown) => void };
                const originalReport = g.reportError;
                const originalConsoleError = console.error;
                delete g.reportError;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (console as any).error = () => {};
                try {
                    const target = new EventTarget();
                    const seen: string[] = [];
                    target.addEventListener('hostile', () => {
                        const hostile = new Error('unreadable');
                        Object.defineProperty(hostile, 'name', {
                            get() {
                                throw new Error('name getter exploded');
                            },
                        });
                        throw hostile;
                    });
                    target.addEventListener('hostile', () => seen.push('after'));
                    // Must not throw, and the later listener must still run.
                    expect(target.dispatchEvent(new Event('hostile'))).toBe(true);
                    expect(seen).toStrictEqual(['after']);
                } finally {
                    if (originalReport !== undefined) g.reportError = originalReport;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (console as any).error = originalConsoleError;
                }
            });

            await it('survives a throwing console.error in the fallback path', async () => {
                const g = globalThis as { reportError?: (err: unknown) => void };
                const originalReport = g.reportError;
                const originalConsoleError = console.error;
                delete g.reportError;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (console as any).error = () => {
                    throw new Error('console.error was monkey-patched badly');
                };
                try {
                    const target = new EventTarget();
                    const seen: string[] = [];
                    target.addEventListener('badconsole', () => {
                        throw new Error('listener threw');
                    });
                    target.addEventListener('badconsole', () => seen.push('after'));
                    expect(target.dispatchEvent(new Event('badconsole'))).toBe(true);
                    expect(seen).toStrictEqual(['after']);
                } finally {
                    if (originalReport !== undefined) g.reportError = originalReport;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (console as any).error = originalConsoleError;
                }
            });

            await it('restores dispatch state so the event can be re-dispatched', async () => {
                const g = globalThis as { reportError?: (err: unknown) => void };
                const originalReport = g.reportError;
                const originalConsoleError = console.error;
                delete g.reportError;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (console as any).error = () => {
                    throw new Error('console.error was monkey-patched badly');
                };
                try {
                    const target = new EventTarget();
                    let calls = 0;
                    target.addEventListener('rewedge', () => {
                        calls++;
                        throw new Error('always throws');
                    });
                    const event = new Event('rewedge');
                    target.dispatchEvent(event);
                    // Pre-fix this threw InvalidStateError because the
                    // `kDispatching` flag was never cleared.
                    target.dispatchEvent(event);
                    expect(calls).toBe(2);
                    expect(event.eventPhase).toBe(0);
                    expect(event.currentTarget).toBeNull();
                } finally {
                    if (originalReport !== undefined) g.reportError = originalReport;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (console as any).error = originalConsoleError;
                }
            });
        });
    });
};
