// `beforeEach`/`afterEach` have a SCOPE, and this is the coverage for it (#1554).
//
// The runner used to keep one slot per hook per module, which failed in two
// directions at once and both were measured in `@gjsify/react-native`:
//
//   * a second registration REPLACED the first, silently, so a block that
//     installed its own pair switched off whatever gate was already there — the
//     diagnostics gate ran for 12 of 49 cases, and a test named "…with no
//     diagnostic" was green with two `GLib-GObject-CRITICAL`s printed inside it;
//   * `describe` nulled both slots on RETURN, so hooks registered around several
//     sibling describes stopped applying after the first — a GTK critical
//     injected into describe #15 surfaced twelve tests later, on a neighbour.
//
// Every case below is written as a LEDGER of what ran, because the failure mode
// is silence: a hook that does not fire looks exactly like a hook that fired and
// had nothing to say, and only the order and the count separate them.
//
// Imported through the PACKAGE specifier for `axis-ledger.spec.ts`'s reason: a
// relative `./index.js` is a second module instance with its own frame stack.
import { afterEach, beforeEach, describe, expect, it } from '@gjsify/unit';

export default async () => {
    await describe('hook scoping', async () => {
        const log: string[] = [];

        await describe('two registrations in ONE scope', async () => {
            beforeEach(() => {
                log.push('outer-before-1');
            });
            beforeEach(() => {
                log.push('outer-before-2');
            });
            afterEach(() => {
                log.push('outer-after-1');
            });
            afterEach(() => {
                log.push('outer-after-2');
            });

            await it('runs BOTH, in registration order, rather than the last one only', async () => {
                expect(log).toStrictEqual(['outer-before-1', 'outer-before-2']);
            });

            await it('unwinds the afterEach pair in REVERSE, like a nested finally', async () => {
                // The previous test's teardown is what this reads: an `afterEach`
                // cannot observe its own run.
                expect(log).toStrictEqual([
                    'outer-before-1',
                    'outer-before-2',
                    'outer-after-2',
                    'outer-after-1',
                    'outer-before-1',
                    'outer-before-2',
                ]);
            });
        });

        await describe('a nested describe', async () => {
            const seen: string[] = [];
            beforeEach(() => {
                seen.push('parent');
            });

            await describe('inherits its parent, and cannot unhook it', async () => {
                beforeEach(() => {
                    seen.push('child');
                });

                await it('runs the parent hook first, then its own', async () => {
                    expect(seen).toStrictEqual(['parent', 'child']);
                });
            });

            await it('still has its own hook after the child described and returned', async () => {
                // THE SIBLING HALF. `describe` used to null the slots on return, so
                // this hook had been switched off by a block that only meant to add
                // one of its own — and the case that noticed was twelve tests away.
                expect(seen).toStrictEqual(['parent', 'child', 'parent']);
            });
        });

        await describe('a sibling scope', async () => {
            const seen: string[] = [];

            await describe('registers a hook of its own', async () => {
                beforeEach(() => {
                    seen.push('sibling');
                });
                await it('which runs for its own cases', async () => {
                    expect(seen).toStrictEqual(['sibling']);
                });
            });

            await it('and NOT for a case outside it', async () => {
                // The frame is popped when the describe returns, so scoping is a
                // real boundary in both directions and not merely inheritance.
                expect(seen).toStrictEqual(['sibling']);
            });
        });

        await describe('teardown when the body fails', async () => {
            const seen: string[] = [];

            await describe('an expected failure still tears down', async () => {
                afterEach(() => {
                    seen.push('after');
                });
                // `it.failing` throwing IS its contract, so before the teardown
                // moved into a `finally` this hook ran for NO expected failure at
                // all — and an `it()` that threw skipped it too, which is the same
                // silence one level over: a gate that asserts in `afterEach` stops
                // asserting for exactly the cases that had something to say.
                await it.failing(
                    'throws, as declared',
                    async () => {
                        throw new Error('the fixture');
                    },
                    'the fixture for the teardown-on-failure case',
                );
            });

            await it('ran the afterEach of the failing case', async () => {
                expect(seen).toStrictEqual(['after']);
            });
        });

        await describe('a describe whose body throws', async () => {
            const seen: string[] = [];

            try {
                await describe('leaves no hook behind', async () => {
                    beforeEach(() => {
                        seen.push('doomed');
                    });
                    throw new Error('the fixture: a suite body that gives up after registering a hook');
                });
            } catch {
                // KEPT AND EMPTY ON PURPOSE: `describe` rethrows anything that is not
                // a timeout, and that throw IS the fixture. Letting it escape would
                // fail this suite instead of testing it.
            }

            await it('so a later case runs none of it', async () => {
                expect(seen).toStrictEqual([]);
            });
        });
    });
};
