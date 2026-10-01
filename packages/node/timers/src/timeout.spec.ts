// Node-compatible Timeout contract — the shape third-party Node libraries bind
// against (`t.unref()`, `t.ref()`, `t.hasRef()`, `t.refresh()`, `+t`,
// `clearTimeout(t)`), and the one GJS cannot deliver by accident.
//
// `unref()` semantics differ BY RUNTIME and these tests pin that difference
// rather than pretending both are Node: on Node it must really release the
// loop; on GJS there is no libuv handle to release, so `hasRef()` reports the
// flag and the timer keeps firing (the GLib main loop is owned by the app).

import { spawnSync } from 'node:child_process';
import { describe, it, expect, on } from '@gjsify/unit';
import { Timeout, Immediate } from './timeout.js';
import { clearTimeout as clearTimeoutNs } from './index.js';

export default async () => {
    await describe('Timeout Node compatibility', async () => {
        await it('is ref/unref/hasRef chainable, returning itself', async () => {
            const t = new Timeout(() => {}, 10_000, [], false);
            expect(t.hasRef()).toBe(true);
            expect(t.unref()).toBe(t);
            expect(t.hasRef()).toBe(false);
            expect(t.ref()).toBe(t);
            expect(t.hasRef()).toBe(true);
            t.close();
        });

        await it('unref() is idempotent and ref() after unref() restores', async () => {
            const t = new Timeout(() => {}, 10_000, [], false);
            t.unref();
            t.unref();
            expect(t.hasRef()).toBe(false);
            t.ref();
            expect(t.hasRef()).toBe(true);
            t.ref();
            expect(t.hasRef()).toBe(true);
            t.close();
        });

        await it('close() returns this, matching @types/node NodeJS.Timeout', async () => {
            const t = new Timeout(() => {}, 10_000, [], false);
            expect(t.close()).toBe(t);
            // Closing twice must not throw (Node allows it).
            expect(t.close()).toBe(t);
        });

        await it('refresh() returns this', async () => {
            const t = new Timeout(() => {}, 10_000, [], false);
            expect(t.refresh()).toBe(t);
            t.close();
        });

        await it('+timeout coerces to a number', async () => {
            const t = new Timeout(() => {}, 10_000, [], false);
            expect(typeof +t).toBe('number');
            t.close();
        });

        await it('Symbol.toPrimitive yields a number that clears via clearTimeout', async () => {
            let called = false;
            const t = new Timeout(
                () => {
                    called = true;
                },
                5,
                [],
                false,
            );
            const id = +t;
            clearTimeoutNs(id);
            await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 40));
            expect(called).toBe(false);
        });

        await it('clearTimeout accepts the Timeout object itself', async () => {
            let called = false;
            const t = new Timeout(
                () => {
                    called = true;
                },
                5,
                [],
                false,
            );
            clearTimeoutNs(t);
            await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 40));
            expect(called).toBe(false);
        });

        await it('Symbol.dispose cancels the timer', async () => {
            let called = false;
            {
                const t = new Timeout(
                    () => {
                        called = true;
                    },
                    5,
                    [],
                    false,
                );
                t[Symbol.dispose]();
            }
            await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 40));
            expect(called).toBe(false);
        });

        await it('carries _onTimeout so Node libraries calling it directly work', async () => {
            let seen: string | undefined;
            const t = new Timeout(
                (arg: string) => {
                    seen = arg;
                },
                5,
                ['payload'],
                false,
            );
            await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 40));
            expect(seen).toBe('payload');
            // The scheduled dispatch already consumed the handle; calling it
            // again is the direct-invocation path libraries fall back to.
            t._onTimeout('direct');
            expect(seen).toBe('direct');
        });

        // The honest-per-runtime contract: `unref()` means "don't require the
        // host loop to stay alive". GJS cannot honour that — `Gtk.Application` /
        // `GLib.MainLoop` own the loop, and a GSource has no ref/unref pair that
        // releases liveness without destroying the source — so the flag is
        // recorded and reported, and the timer keeps firing.
        //
        // Proving the Node side really drains the loop needs a process that is
        // held open ONLY by the timer, which an in-suite test cannot be: the
        // unit runner's own handles keep Node alive either way. That is a
        // `tests/e2e` concern, so what is pinned here is the observable half —
        // the flag, on both runtimes, and GJS's documented divergence.
        await on(['Gjs', 'Node.js'], async () => {
            await it('unref() is recorded, not silently ignored', async () => {
                const t = new Timeout(() => {}, 10_000, [], false);
                t.unref();
                expect(t.hasRef()).toBe(false);
                t.close();
            });
        });

        // The other half of the divergence: on Node, `unref()` REALLY releases the
        // event loop. Proving it needs a process held open by nothing else —
        // the unit runner's own handles would mask that — so it is one spawned
        // `node -e` whose output is the verdict: it exits WITHOUT firing.
        // Node-only, because spawning a second interpreter from the GJS bundle
        // is its own portability problem and buys nothing here.
        await on('Node.js', async () => {
            await it('really releases the event loop, in a process held open by nothing', async () => {
                // `nodeBinary()` lives in the CLI package, which a library spec
                // cannot import. `process.execPath` is the right binary HERE
                // because the whole block is gated on `Node.js`: under GJS the
                // `on('Node.js')` match stands down and this never runs.
                const proc = spawnSync(
                    // oxlint-disable-next-line gjsify/spawn-node-binary -- gated on the Node.js axis by `on('Node.js')`, so process.execPath IS node; the CLI's nodeBinary() is unreachable from a library package
                    process.execPath,
                    ['-e', 'const t = setTimeout(() => process.stdout.write("fired"), 5000); t.unref();'],
                    { timeout: 20_000, encoding: 'utf8' },
                );
                expect(proc.stdout).not.toBe('fired');
                // And the same code WITHOUT unref() does fire — the control that
                // says the assertion above is about unref, not about a timer
                // that never runs.
                const control = spawnSync(
                    // oxlint-disable-next-line gjsify/spawn-node-binary -- same `on('Node.js')` gate as the spawn above
                    process.execPath,
                    ['-e', 'setTimeout(() => process.stdout.write("fired"), 500);'],
                    { timeout: 20_000, encoding: 'utf8' },
                );
                expect(control.stdout).toBe('fired');
            });
        });

        await on('Gjs', async () => {
            await it('unref() still fires: GJS owns the loop, so it cannot release it', async () => {
                let fired = false;
                const t = new Timeout(
                    () => {
                        fired = true;
                    },
                    5,
                    [],
                    false,
                );
                t.unref();
                expect(t.hasRef()).toBe(false);
                await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 60));
                expect(fired).toBe(true);
            });

            // The regression this guard exists for: a delegation guard written
            // as a NEGATIVE test ("the host is not a GLib source") let a real
            // `GLib.Source` through and `.unref()` reached `g_source_unref`,
            // killing the process with
            // `g_source_unref_internal: assertion 'old_ref > 0' failed`.
            //
            // The negative test does not work, and the measurement below is why:
            // on gjs 1.88.1 a native `setTimeout` handle has
            // `'$gtype' in t === false`, `t.constructor.name === 'GLib_Source'`,
            // `ref`/`unref` present, `hasRef`/`refresh` absent. So the only probe
            // that keeps delegation away from it is the POSITIVE one.
            await it('never delegates ref/unref to a GLib.Source-shaped host', async () => {
                // The measured shape, built so the assertion can be about
                // DELEGATION rather than about a GLib warning that arrives
                // asynchronously and would let a broken guard pass.
                const GLib = (await import('gi://GLib?version=2.0' as string)).default as {
                    PRIORITY_DEFAULT: number;
                    timeout_add(priority: number, interval: number, fn: () => boolean): number;
                    Source: { remove(id: number): void };
                    MainContext: { default(): { find_source_by_id(id: number): unknown } };
                };
                const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10_000, () => false);
                const real = GLib.MainContext.default().find_source_by_id(id);
                expect(typeof (real as { unref?: unknown }).unref).toBe('function');
                expect(typeof (real as { hasRef?: unknown }).hasRef).toBe('undefined');
                expect('$gtype' in (real as object)).toBe(false);

                let delegated = 0;
                const gsourceShaped = {
                    ref: () => {
                        ++delegated;
                    },
                    unref: () => {
                        ++delegated;
                    },
                };
                const t = new Timeout(() => {}, 10_000, [], false);
                (t as unknown as { _id: unknown })._id = gsourceShaped;
                t.unref();
                t.ref();
                // Zero is the whole contract: `.unref()` on a GSource is
                // `g_source_unref`, and it destroys the source.
                expect(delegated).toBe(0);
                // The intent is still recorded, so `hasRef()` stays truthful.
                expect(t.hasRef()).toBe(true);
                GLib.Source.remove(id);
            });

            // The counterpart, so the guard is not merely refusing everything:
            // a host that DOES carry the Node members is delegated to, which is
            // what makes `unref()` mean "don't hold the loop open" on Node.
            await it('delegates ref/unref to a Node-shaped host', async () => {
                let unrefs = 0;
                let refs = 0;
                const nodeShaped = {
                    unref: () => {
                        ++unrefs;
                    },
                    ref: () => {
                        ++refs;
                    },
                    hasRef: () => true,
                    refresh: () => nodeShaped,
                };
                const t = new Timeout(() => {}, 10_000, [], false);
                (t as unknown as { _id: unknown })._id = nodeShaped;
                t.unref();
                expect(unrefs).toBe(1);
                expect(t.hasRef()).toBe(false);
                t.ref();
                expect(refs).toBe(1);
                expect(t.hasRef()).toBe(true);
            });

            // `refresh()` re-schedules onto a NEW host handle, which arrives
            // refed. Without re-applying the recorded state, an `unref()`ed timer
            // that is refreshed starts holding the loop open again — on Node the
            // difference between a process that exits and one that hangs.
            await it('refresh() re-applies unref to the handle it creates', async () => {
                const t = new Timeout(() => {}, 10_000, [], false);
                t.unref();
                expect(t.hasRef()).toBe(false);
                const before = (t as unknown as { _id: unknown })._id;
                t.refresh();
                const after = (t as unknown as { _id: unknown })._id as {
                    unref?: () => void;
                    hasRef?: () => boolean;
                };
                // A genuinely new host handle, and it carries the Node members
                // `Timeout` delegates to.
                expect(after).not.toBe(before);
                expect(typeof after.unref).toBe('function');
                expect(typeof after.hasRef).toBe('function');
                // The recorded intent survives the reschedule.
                expect(t.hasRef()).toBe(false);
                // And on Node the new host handle really is unreferenced, which is
                // what `hasRef()` on the HOST reports — the observable half of
                // "refresh() carried the state over".
                expect(after.hasRef?.()).toBe(false);
                t.close();
            });
        });
    });

    await describe('Immediate Node compatibility', async () => {
        await it('has ref/unref/hasRef chainable', async () => {
            const i = new Immediate(() => {}, []);
            expect(i.hasRef()).toBe(true);
            expect(i.unref()).toBe(i);
            expect(i.hasRef()).toBe(false);
            expect(i.ref()).toBe(i);
            expect(i.hasRef()).toBe(true);
        });

        await it('carries _onImmediate and Symbol.dispose', async () => {
            const i = new Immediate(() => {}, []);
            expect(typeof i[Symbol.dispose]).toBe('function');
            i[Symbol.dispose]();
        });
    });
};
