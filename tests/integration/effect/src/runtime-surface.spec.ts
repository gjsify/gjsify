// SPDX-License-Identifier: MIT
//
// Preflight, not a port: the platform surface Effect's fiber runtime reaches for
// before any Effect test can mean anything. Authored here rather than ported,
// because upstream has no such file — on Node and in a browser every one of these
// is simply present, so nobody wrote a test asking.
//
// It exists because the answer on bare GJS is not "present". Measured against
// `gjs -m` with no bundle (SpiderMonkey 140 / GJS 1.88):
//
//   WeakRef, FinalizationRegistry   native (ES2021, SpiderMonkey ships them)
//   structuredClone, MessageChannel undefined — HTML APIs, Gecko-side in Firefox
//   AbortController, queueMicrotask undefined — same
//   performance, setImmediate       undefined
//   Symbol.dispose/asyncDispose     undefined
//   process                         undefined
//
// So every row below except the first two is `@gjsify/*` output, and the whole
// suite's Node leg is the control: it must pass there for the same reasons it is
// expected to pass here.

import { describe, expect, it } from '@gjsify/unit';

export default async () => {
    await describe('runtime surface Effect relies on', async () => {
        await describe('object lifetime (SpiderMonkey native)', async () => {
            await it('WeakRef holds and derefs', async () => {
                const target = { tag: 'held' };
                const ref = new WeakRef(target);
                expect(ref.deref()).toBe(target);
            });

            await it('FinalizationRegistry constructs and accepts a registration', async () => {
                // Effect 4 registers cleanups for HttpClient responses and reactivity
                // Atoms. Whether the callback ever RUNS is GC-timing, which no test can
                // demand; that it can be built and registered is the contract consumers
                // depend on at import time.
                const registry = new FinalizationRegistry<string>(() => {});
                const target = {};
                registry.register(target, 'token');
                registry.unregister(target);
                expect(typeof registry.register).toBe('function');
            });
        });

        await describe('scheduling (the fiber runtime yields through these)', async () => {
            await it('queueMicrotask runs before a zero timer', async () => {
                const order: string[] = [];
                await new Promise<void>((resolve) => {
                    setTimeout(() => {
                        order.push('timeout');
                        resolve();
                    }, 0);
                    queueMicrotask(() => order.push('microtask'));
                });
                expect(order).toStrictEqual(['microtask', 'timeout']);
            });

            await it('setTimeout returns a handle clearTimeout accepts', async () => {
                let fired = false;
                const handle = setTimeout(() => {
                    fired = true;
                }, 0);
                clearTimeout(handle);
                await new Promise((resolve) => setTimeout(resolve, 20));
                expect(fired).toBe(false);
            });

            await it('performance.now is monotonic across an awaited timer', async () => {
                // Effect's default Clock reads `performance.now()` for its monotonic
                // source and falls back to Date only where it is missing.
                const before = performance.now();
                await new Promise((resolve) => setTimeout(resolve, 5));
                expect(performance.now()).toBeGreaterThanOrEqual(before);
            });
        });

        await describe('cancellation (fiber interruption maps onto these)', async () => {
            await it('an AbortController aborts its signal with a reason', async () => {
                const controller = new AbortController();
                let seen: unknown;
                controller.signal.addEventListener('abort', () => {
                    seen = controller.signal.reason;
                });
                controller.abort('interrupted');
                expect(controller.signal.aborted).toBe(true);
                expect(seen).toBe('interrupted');
            });
        });

        await describe('explicit resource management', async () => {
            await it('Symbol.dispose and Symbol.asyncDispose are symbols', async () => {
                // Effect 4 gives Scope, Fiber and Semaphore `[Symbol.dispose]`, so a
                // missing well-known symbol is not a missing nicety — it is a class of
                // consumer code that throws `Object not disposable` at the `using`.
                expect(typeof Symbol.dispose).toBe('symbol');
                expect(typeof Symbol.asyncDispose).toBe('symbol');
            });
        });

        await describe('host facts Effect reads at import', async () => {
            await it('process.env is readable and writable', async () => {
                // ConfigProvider.fromEnv() reads it; the GJS Proxy round-trips through
                // GLib.{get,set,unset}env.
                process.env.GJSIFY_EFFECT_PROBE = 'yes';
                expect(process.env.GJSIFY_EFFECT_PROBE).toBe('yes');
                delete process.env.GJSIFY_EFFECT_PROBE;
                expect(process.env.GJSIFY_EFFECT_PROBE).toBe(undefined);
            });

            await it('process.hrtime.bigint advances', async () => {
                // Effect's Clock prefers it over performance.now where present.
                const before = process.hrtime.bigint();
                await new Promise((resolve) => setTimeout(resolve, 5));
                expect(process.hrtime.bigint() > before).toBe(true);
            });
        });

        await describe('present but unused by the Effect core — measured, not assumed', async () => {
            await it('structuredClone deep-copies', async () => {
                // Not on Effect 4's core path (only inside a vendored Scalar/Swagger
                // string blob), but @effect/platform's worker transferables use it and
                // it is the API most likely to be reached for next. Held here so the
                // day something imports it, the gap is already named.
                const source = { nested: { list: [1, 2, 3] } };
                const copy = structuredClone(source);
                expect(copy).toStrictEqual(source);
                expect(copy.nested).not.toBe(source.nested);
            });

            await it('a MessageChannel delivers a posted message', async () => {
                const channel = new MessageChannel();
                const received = await new Promise<unknown>((resolve) => {
                    channel.port2.onmessage = (event: MessageEvent) => resolve(event.data);
                    channel.port1.postMessage('ping');
                    channel.port2.start?.();
                });
                expect(received).toBe('ping');
                channel.port1.close();
                channel.port2.close();
            });
        });
    });
};
