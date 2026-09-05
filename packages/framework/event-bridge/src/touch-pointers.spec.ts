// The touch → PointerEvent state machine, driven with the frame shapes the GTK adapter
// extracts. What GTK actually delivers for a finger is the on-device measurement's claim, not
// this file's: these tests prove the translation of a given raw stream, including the two
// cases that bite on a phone — a press that GTK never releases, and a compositor cancel that
// fans out after the consumer has already seen movement.
//
// Coordinates are thirds on purpose: a real digitizer at scale 3 reports them that way, and a
// path that rounds would only show it against non-integers.

import { describe, it, expect } from '@gjsify/unit';

import { type Event as OurEvent, PointerEvent as OurPointerEvent } from '@gjsify/dom-events';
import { TouchPointerTranslator, type TouchFrame, type TouchPhase } from './touch-pointers.js';

type Recorded = OurEvent & {
    pointerId?: number;
    pointerType?: string;
    isPrimary?: boolean;
    button?: number;
    buttons?: number;
    pressure?: number;
    clientX?: number;
    clientY?: number;
    offsetX?: number;
    movementX?: number;
    movementY?: number;
    detail?: number;
};

function recorder() {
    const events: Recorded[] = [];
    return {
        events,
        types: () => events.map((e) => e.type),
        dispatchEvent(e: OurEvent): boolean {
            events.push(e as Recorded);
            return true;
        },
    };
}

const NO_MODS = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };

function frame(phase: TouchPhase, key: string, x: number, y: number, isPrimary = true): TouchFrame {
    return { ...NO_MODS, phase, key, x, y, isPrimary };
}

/** A translator over a fresh element recorder, with the window target recorded separately. */
function setup() {
    const el = recorder();
    const win = recorder();
    const t = new TouchPointerTranslator(
        () => el,
        () => win,
    );
    return { el, win, t };
}

const TAP_SEQUENCE = [
    'mousemove',
    'pointerover',
    'pointerenter',
    'mouseover',
    'mouseenter',
    'pointerdown',
    'mousedown',
    'pointermove',
    'mousemove',
    'pointerup',
    'mouseup',
    'pointerout',
    'pointerleave',
    'mouseout',
    'mouseleave',
    'click',
];

export default async () => {
    await describe('TouchPointerTranslator — one contact', async () => {
        await it('emits the spec sequence for a primary contact, mouse events interleaved after their pointer event', async () => {
            const { el, t } = setup();
            t.handle(frame('begin', 'a', 49.333333, 293));
            t.handle(frame('update', 'a', 61.333333, 307));
            t.handle(frame('end', 'a', 61.333333, 307));
            expect(el.types()).toStrictEqual(TAP_SEQUENCE);
        });

        await it('carries coordinates through unrounded', async () => {
            const { el, t } = setup();
            t.handle(frame('begin', 'a', 49.333333, 293.666667));
            const down = el.events.find((e) => e.type === 'pointerdown')!;
            expect(down.clientX).toBe(49.333333);
            expect(down.clientY).toBe(293.666667);
            expect(down.offsetX).toBe(49.333333);
        });

        await it('stamps pointerType touch and a pointerId that never collides with the mouse', async () => {
            const { el, t } = setup();
            t.handle(frame('begin', 'a', 1, 1));
            t.handle(frame('update', 'a', 2, 2));
            t.handle(frame('end', 'a', 2, 2));
            const pointer = el.events.filter((e) => e.type.startsWith('pointer'));
            expect(pointer.length).toBe(7);
            for (const e of pointer) {
                expect(e.pointerType).toBe('touch');
                expect(e.pointerId).toBe(2);
                expect(e.isPrimary).toBe(true);
            }
        });

        await it('reports button/buttons/pressure per phase', async () => {
            const { el, t } = setup();
            t.handle(frame('begin', 'a', 1, 1));
            t.handle(frame('update', 'a', 2, 2));
            t.handle(frame('end', 'a', 2, 2));
            const by = (type: string) => el.events.find((e) => e.type === type)!;
            // Nothing is pressed while the contact arrives.
            expect(by('pointerover').buttons).toBe(0);
            expect(by('pointerover').pressure).toBe(0);
            expect(by('pointerdown').button).toBe(0);
            expect(by('pointerdown').buttons).toBe(1);
            expect(by('pointerdown').pressure).toBe(0.5);
            expect(by('pointermove').button).toBe(-1);
            expect(by('pointermove').buttons).toBe(1);
            expect(by('pointerup').buttons).toBe(0);
            expect(by('pointerup').pressure).toBe(0);
            // Nothing changed between pointerup and the boundary events.
            expect(by('pointerout').button).toBe(-1);
            expect(by('pointerleave').button).toBe(-1);
            expect(by('mousedown').detail).toBe(1);
            expect(by('click').detail).toBe(1);
        });

        await it('click is a PointerEvent carrying the contact, with button/buttons in the mouse model', async () => {
            const { el, t } = setup();
            t.handle(frame('begin', 'a', 1, 1));
            t.handle(frame('end', 'a', 5, 5));
            const click = el.events.find((e) => e.type === 'click')!;
            expect(click).toBeInstanceOf(OurPointerEvent);
            expect(click.pointerType).toBe('touch');
            expect(click.pointerId).toBe(2);
            expect(click.isPrimary).toBe(true);
            expect(click.button).toBe(0);
            expect(click.buttons).toBe(0);
            expect(click.clientX).toBe(5);
        });

        await it('tracks movementX/movementY per contact', async () => {
            const { el, t } = setup();
            t.handle(frame('begin', 'a', 10, 20));
            t.handle(frame('update', 'a', 13.5, 25));
            t.handle(frame('update', 'a', 13.5, 21));
            const moves = el.events.filter((e) => e.type === 'pointermove');
            expect(moves[0].movementX).toBe(3.5);
            expect(moves[0].movementY).toBe(5);
            expect(moves[1].movementX).toBe(0);
            expect(moves[1].movementY).toBe(-4);
        });

        await it('does not reuse a pointerId once the contact lifted', async () => {
            const { el, t } = setup();
            t.handle(frame('begin', 'a', 1, 1));
            t.handle(frame('end', 'a', 1, 1));
            t.handle(frame('begin', 'a', 1, 1));
            const downs = el.events.filter((e) => e.type === 'pointerdown');
            expect(downs[0].pointerId).toBe(2);
            expect(downs[1].pointerId).toBe(3);
        });
    });

    await describe('TouchPointerTranslator — two contacts', async () => {
        await it('gives each contact its own pointerId and routes interleaved updates by key', async () => {
            const { el, t } = setup();
            t.handle(frame('begin', 'a', 100, 300));
            t.handle(frame('begin', 'b', 300, 300, false));
            t.handle(frame('update', 'a', 100, 312));
            t.handle(frame('update', 'b', 300, 312, false));
            t.handle(frame('update', 'a', 100, 324));
            const downs = el.events.filter((e) => e.type === 'pointerdown');
            expect(downs.length).toBe(2);
            expect(downs[0].pointerId).not.toBe(downs[1].pointerId);
            const moves = el.events.filter((e) => e.type === 'pointermove');
            expect(moves.map((e) => e.pointerId)).toStrictEqual([
                downs[0].pointerId,
                downs[1].pointerId,
                downs[0].pointerId,
            ]);
            expect(moves.map((e) => e.clientX)).toStrictEqual([100, 300, 100]);
            expect(t.activeCount).toBe(2);
        });

        await it('only the primary contact produces compatibility mouse events', async () => {
            const { el, t } = setup();
            t.handle(frame('begin', 'a', 1, 1));
            t.handle(frame('begin', 'b', 2, 2, false));
            t.handle(frame('update', 'b', 3, 3, false));
            t.handle(frame('end', 'b', 3, 3, false));
            const mouse = el.events.filter((e) => !e.type.startsWith('pointer'));
            // Exactly the primary's arrival: mousemove, mouseover, mouseenter, mousedown.
            expect(mouse.map((e) => e.type)).toStrictEqual(['mousemove', 'mouseover', 'mouseenter', 'mousedown']);
            const secondary = el.events.filter((e) => e.pointerId === 3);
            expect(secondary.map((e) => e.type)).toStrictEqual([
                'pointerover',
                'pointerenter',
                'pointerdown',
                'pointermove',
                'pointerup',
                'pointerout',
                'pointerleave',
            ]);
            expect(secondary[0].isPrimary).toBe(false);
        });

        await it('lifting one contact leaves the other active', async () => {
            const { el, t } = setup();
            t.handle(frame('begin', 'a', 1, 1));
            t.handle(frame('begin', 'b', 2, 2, false));
            t.handle(frame('end', 'a', 1, 1));
            expect(t.activeCount).toBe(1);
            t.handle(frame('update', 'b', 5, 5, false));
            const last = el.events[el.events.length - 1];
            expect(last.type).toBe('pointermove');
            expect(last.pointerId).toBe(3);
        });
    });

    await describe('TouchPointerTranslator — no contact stays pressed', async () => {
        await it('an end, update or cancel for a contact that is not active emits nothing', async () => {
            // GestureClick's late `released` and GTK's post-cancel `drag-end` are both this shape.
            const { el, t } = setup();
            t.handle(frame('end', 'ghost', 1, 1));
            t.handle(frame('update', 'ghost', 1, 1));
            t.handle(frame('cancel', 'ghost', 1, 1));
            expect(el.events.length).toBe(0);
        });

        await it('a repeated end for the same contact is a no-op', async () => {
            const { el, t } = setup();
            t.handle(frame('begin', 'a', 1, 1));
            t.handle(frame('end', 'a', 1, 1));
            const n = el.events.length;
            t.handle(frame('end', 'a', 1, 1));
            expect(el.events.length).toBe(n);
            expect(t.activeCount).toBe(0);
        });

        await it('a begin for a contact still active cancels the stale one first', async () => {
            // The lost-TOUCH_END case: the slot key comes back without ever having ended.
            const { el, t } = setup();
            t.handle(frame('begin', 'a', 1, 1));
            t.handle(frame('begin', 'a', 50, 50));
            const types = el.types();
            const cancelAt = types.indexOf('pointercancel');
            const secondDown = types.lastIndexOf('pointerdown');
            expect(cancelAt).toBeGreaterThan(-1);
            expect(cancelAt).toBeLessThan(secondDown);
            expect(el.events.filter((e) => e.type === 'pointerup').length).toBe(0);
            expect(t.activeCount).toBe(1);
            expect(el.events[secondDown].pointerId).toBe(3);
            // The stale contact is cancelled where it last was, not where the new one begins.
            expect(el.events[cancelAt].pointerId).toBe(2);
            expect(el.events[cancelAt].clientX).toBe(1);
            expect(el.events[secondDown].clientX).toBe(50);
        });

        await it('a stale key that comes back while the element is away does not hand its stream to the returning element', async () => {
            let el: ReturnType<typeof recorder> | null = recorder();
            const t = new TouchPointerTranslator(
                () => el,
                () => undefined,
            );
            t.handle(frame('begin', 'a', 1, 1));
            const first = el;
            el = null;
            t.handle(frame('begin', 'a', 2, 2));
            expect(t.activeCount).toBe(0);
            el = recorder();
            t.handle(frame('update', 'a', 3, 3));
            t.handle(frame('end', 'a', 3, 3));
            expect(el.events.length).toBe(0);
            // The first element saw the contact arrive and nothing after; there was nowhere to cancel it.
            expect(first.types()[first.types().length - 1]).toBe('mousedown');
        });

        await it('interleaved contacts closing out of order leave nothing pressed, and the fan-out after them is inert', async () => {
            const { el, win, t } = setup();
            t.handle(frame('begin', 'a', 1, 1));
            t.handle(frame('begin', 'b', 2, 2, false));
            t.handle(frame('cancel', 'a', 1, 1));
            expect(t.activeCount).toBe(1);
            t.handle(frame('end', 'b', 2, 2, false));
            expect(t.activeCount).toBe(0);
            const n = el.events.length;
            t.handle(frame('end', 'a', 1, 1));
            t.handle(frame('cancel', 'b', 2, 2, false));
            t.handle(frame('update', 'a', 9, 9));
            expect(el.events.length).toBe(n);
            expect(el.events.filter((e) => e.type === 'pointercancel').map((e) => e.pointerId)).toStrictEqual([2]);
            expect(el.events.filter((e) => e.type === 'pointerup').map((e) => e.pointerId)).toStrictEqual([3]);
            expect(el.events.filter((e) => e.type === 'mousedown').length).toBe(1);
            expect(win.types()).toStrictEqual(['mouseup']);
        });

        await it('holds its invariants over every frame order a digitizer or a lost frame can produce', async () => {
            // A seeded xorshift stream of random frames over three keys, the first of which emulates
            // the pointer; the model beside it is the set of keys with an unclosed begin. Violations
            // are collected rather than asserted one by one so a failure names its seed and frame.
            const phases: TouchPhase[] = ['begin', 'update', 'end', 'cancel'];
            const violations: string[] = [];
            let framesRun = 0;
            for (let seed = 1; seed <= 1500; seed++) {
                let x = (seed * 2654435761) >>> 0;
                const rnd = () => {
                    x ^= x << 13;
                    x >>>= 0;
                    x ^= x >>> 17;
                    x ^= x << 5;
                    x >>>= 0;
                    return x;
                };
                const { el, win, t } = setup();
                const open = new Set<string>();
                const steps = 4 + (rnd() % 28);
                for (let i = 0; i < steps; i++) {
                    const key = 'abc'[rnd() % 3];
                    const phase = phases[rnd() % 4];
                    const before = el.events.length;
                    t.handle(frame(phase, key, (rnd() % 1200) / 3, (rnd() % 2400) / 3, key === 'a'));
                    framesRun++;
                    const wasOpen = open.has(key);
                    if (phase === 'begin') open.add(key);
                    else if (!wasOpen && el.events.length !== before)
                        violations.push(`${seed}:${i} ${phase} on inactive ${key} emitted`);
                    else if (phase === 'end' || phase === 'cancel') open.delete(key);
                    if (t.activeCount !== open.size)
                        violations.push(`${seed}:${i} activeCount ${t.activeCount} != ${open.size}`);
                }
                const openIds = new Set<number>();
                for (const e of el.events) if (e.type === 'pointerdown') openIds.add(e.pointerId!);
                const byId = new Map<number, string[]>();
                for (const e of el.events) {
                    if (e.pointerId === undefined || e.type === 'click') continue;
                    let list = byId.get(e.pointerId);
                    if (!list) byId.set(e.pointerId, (list = []));
                    list.push(e.type);
                }
                for (const [id, types] of byId) {
                    if (types.slice(0, 3).join() !== 'pointerover,pointerenter,pointerdown')
                        violations.push(`${seed} id ${id} opens ${types.slice(0, 3)}`);
                    if (types.filter((v) => v === 'pointerdown').length !== 1)
                        violations.push(
                            `${seed} id ${id} pointerdown x${types.filter((v) => v === 'pointerdown').length}`,
                        );
                    const closeAt = types.findIndex((v) => v === 'pointerup' || v === 'pointercancel');
                    if (closeAt !== -1 && types.slice(closeAt + 1).join() !== 'pointerout,pointerleave')
                        violations.push(`${seed} id ${id} after close: ${types.slice(closeAt + 1)}`);
                    if (types.filter((v) => v === 'pointerup' || v === 'pointercancel').length > 1)
                        violations.push(`${seed} id ${id} closed twice`);
                }
                // Every contact that is still open must be exactly the ones without a close.
                const unclosed = [...byId].filter(
                    ([, types]) => !types.some((v) => v === 'pointerup' || v === 'pointercancel'),
                ).length;
                if (unclosed !== open.size)
                    violations.push(`${seed} ${unclosed} unclosed streams for ${open.size} open keys`);
                // Compatibility mouse buttons balance, with the primary's mouseup at the window on cancel.
                const downs = el.events.filter((e) => e.type === 'mousedown').length;
                const ups =
                    el.events.filter((e) => e.type === 'mouseup').length +
                    win.events.filter((e) => e.type === 'mouseup').length;
                if (downs - ups !== (open.has('a') ? 1 : 0))
                    violations.push(
                        `${seed} mousedown ${downs} vs mouseup ${ups} with primary ${open.has('a') ? 'open' : 'closed'}`,
                    );
                if (el.events.some((e) => e.type === 'click' && e.pointerId !== undefined && !e.isPrimary))
                    violations.push(`${seed} click from a non-primary contact`);
                t.cancelAll(NO_MODS);
                if (t.activeCount !== 0) violations.push(`${seed} cancelAll left ${t.activeCount}`);
            }
            expect(framesRun).toBeGreaterThan(20000);
            expect(violations).toStrictEqual([]);
        });
    });

    await describe('TouchPointerTranslator — cancel', async () => {
        await it('a compositor cancel after movement ends the contact with pointercancel, never pointerup or click', async () => {
            // The edge-swipe shape: begin, ten updates, then TOUCH_CANCEL when the shell claims it.
            const { el, win, t } = setup();
            t.handle(frame('begin', 'a', 194.333333, 774));
            for (let i = 1; i <= 10; i++) t.handle(frame('update', 'a', 194.333333 - i * 0.233333, 774 - i * 2.966667));
            t.handle(frame('cancel', 'a', 192, 744.333333));
            const types = el.types();
            expect(types.filter((x) => x === 'pointermove').length).toBe(10);
            expect(types.slice(-5)).toStrictEqual([
                'pointercancel',
                'pointerout',
                'pointerleave',
                'mouseout',
                'mouseleave',
            ]);
            expect(types.includes('pointerup')).toBe(false);
            expect(types.includes('click')).toBe(false);
            expect(types.includes('mouseup')).toBe(false);
            // The spec sends the compatibility mouseup "at the window".
            expect(win.types()).toStrictEqual(['mouseup']);
            expect(t.activeCount).toBe(0);
            const cancel = el.events.find((e) => e.type === 'pointercancel')!;
            expect(cancel.button).toBe(-1);
            expect(cancel.buttons).toBe(0);
            expect(cancel.cancelable).toBe(false);
            // PE § pointercancel: the coordinates are the last dispatched pointer event's, not the frame's.
            expect(cancel.clientX).toBe(194.333333 - 10 * 0.233333);
            expect(cancel.clientY).toBe(774 - 10 * 2.966667);
            expect(el.events.find((e) => e.type === 'pointerout')!.clientX).toBe(cancel.clientX);
            expect(win.events[0].clientX).toBe(cancel.clientX);
        });

        await it('the gesture fan-out that follows a cancel emits nothing more', async () => {
            const { el, t } = setup();
            t.handle(frame('begin', 'a', 1, 1));
            t.handle(frame('cancel', 'a', 1, 1));
            const n = el.events.length;
            // GTK follows TOUCH_CANCEL with drag-end + cancel on every gesture; the adapter
            // forwards nothing for touch-sourced gesture signals, and even a repeat here is inert.
            t.handle(frame('end', 'a', 1, 1));
            t.handle(frame('cancel', 'a', 1, 1));
            expect(el.events.length).toBe(n);
        });

        await it('cancelAll cancels every active contact once', async () => {
            const { el, win, t } = setup();
            t.handle(frame('begin', 'a', 1, 1));
            t.handle(frame('begin', 'b', 2, 2, false));
            t.cancelAll(NO_MODS);
            expect(el.events.filter((e) => e.type === 'pointercancel').map((e) => e.pointerId)).toStrictEqual([2, 3]);
            expect(win.types()).toStrictEqual(['mouseup']);
            expect(t.activeCount).toBe(0);
            const n = el.events.length;
            t.cancelAll(NO_MODS);
            expect(el.events.length).toBe(n);
        });
    });

    await describe('TouchPointerTranslator — PREVENT MOUSE EVENT flag', async () => {
        await it('a cancelled primary pointerdown suppresses mousedown/mousemove/mouseup but not the transitions or click', async () => {
            const el = recorder();
            const preventing = {
                dispatchEvent(e: OurEvent): boolean {
                    if (e.type === 'pointerdown') e.preventDefault();
                    return el.dispatchEvent(e);
                },
            };
            const t = new TouchPointerTranslator(
                () => preventing,
                () => undefined,
            );
            t.handle(frame('begin', 'a', 1, 1));
            t.handle(frame('update', 'a', 2, 2));
            t.handle(frame('end', 'a', 2, 2));
            expect(el.types()).toStrictEqual([
                'mousemove',
                'pointerover',
                'pointerenter',
                'mouseover',
                'mouseenter',
                'pointerdown',
                'pointermove',
                'pointerup',
                'pointerout',
                'pointerleave',
                'mouseout',
                'mouseleave',
                'click',
            ]);
        });

        await it('the flag clears with the contact', async () => {
            const el = recorder();
            let prevent = true;
            const t = new TouchPointerTranslator(
                () => ({
                    dispatchEvent(e: OurEvent): boolean {
                        if (prevent && e.type === 'pointerdown') e.preventDefault();
                        return el.dispatchEvent(e);
                    },
                }),
                () => undefined,
            );
            t.handle(frame('begin', 'a', 1, 1));
            t.handle(frame('end', 'a', 1, 1));
            prevent = false;
            el.events.length = 0;
            t.handle(frame('begin', 'a', 1, 1));
            t.handle(frame('end', 'a', 1, 1));
            expect(el.types().includes('mousedown')).toBe(true);
        });
    });

    await describe('TouchPointerTranslator — element lifecycle', async () => {
        await it('a contact that begins before the element exists is not tracked', async () => {
            let el: ReturnType<typeof recorder> | null = null;
            const t = new TouchPointerTranslator(
                () => el,
                () => undefined,
            );
            t.handle(frame('begin', 'a', 1, 1));
            expect(t.activeCount).toBe(0);
            el = recorder();
            t.handle(frame('update', 'a', 2, 2));
            t.handle(frame('end', 'a', 2, 2));
            expect(el.events.length).toBe(0);
        });
    });
};
