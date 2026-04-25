import { run, describe, it, expect } from '@gjsify/unit';

run({
    async DomEventsTest() {
        await describe('Event', async () => {
            await it('creates with type', async () => {
                const e = new Event('click');
                expect(e.type).toBe('click');
                expect(e.bubbles).toBe(false);
                expect(e.cancelable).toBe(false);
            });

            await it('bubbles and cancelable init options', async () => {
                const e = new Event('test', { bubbles: true, cancelable: true });
                expect(e.bubbles).toBe(true);
                expect(e.cancelable).toBe(true);
            });

            await it('Symbol.toStringTag is Event', async () => {
                expect(Object.prototype.toString.call(new Event('x'))).toBe('[object Event]');
            });
        });

        await describe('CustomEvent', async () => {
            await it('carries detail', async () => {
                const e = new CustomEvent('custom', { detail: { x: 42 } });
                expect(e.type).toBe('custom');
                expect(e.detail).toStrictEqual({ x: 42 });
            });

            await it('instanceof Event', async () => {
                expect(new CustomEvent('e') instanceof Event).toBe(true);
            });
        });

        await describe('EventTarget', async () => {
            await it('dispatches and receives events', async () => {
                const t = new EventTarget();
                let received = '';
                t.addEventListener('ping', (e) => { received = (e as CustomEvent).detail; });
                t.dispatchEvent(new CustomEvent('ping', { detail: 'hello' }));
                expect(received).toBe('hello');
            });

            await it('removeEventListener stops receiving', async () => {
                const t = new EventTarget();
                let count = 0;
                const handler = () => { count++; };
                t.addEventListener('click', handler);
                t.dispatchEvent(new Event('click'));
                t.removeEventListener('click', handler);
                t.dispatchEvent(new Event('click'));
                expect(count).toBe(1);
            });
        });

        await describe('UIEvent', async () => {
            await it('creates with defaults', async () => {
                const e = new UIEvent('test');
                expect(e.detail).toBe(0);
                expect(e.view).toBeNull();
            });

            await it('instanceof Event', async () => {
                expect(new UIEvent('test') instanceof Event).toBe(true);
            });
        });

        await describe('MouseEvent', async () => {
            await it('creates with init values', async () => {
                const e = new MouseEvent('mousedown', {
                    clientX: 100, clientY: 200, button: 2, buttons: 4,
                    altKey: true, ctrlKey: true,
                });
                expect(e.clientX).toBe(100);
                expect(e.clientY).toBe(200);
                expect(e.button).toBe(2);
                expect(e.altKey).toBe(true);
            });

            await it('button is 0 for mousemove (per spec)', async () => {
                const e = new MouseEvent('mousemove');
                expect(e.button).toBe(0);
            });

            await it('getModifierState works', async () => {
                const e = new MouseEvent('click', { altKey: true });
                expect(e.getModifierState('Alt')).toBe(true);
                expect(e.getModifierState('Control')).toBe(false);
            });

            await it('instanceof UIEvent and Event', async () => {
                const e = new MouseEvent('click');
                expect(e instanceof UIEvent).toBe(true);
                expect(e instanceof Event).toBe(true);
            });
        });

        await describe('KeyboardEvent', async () => {
            await it('creates with key/code', async () => {
                const e = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', shiftKey: true });
                expect(e.key).toBe('Enter');
                expect(e.code).toBe('Enter');
                expect(e.shiftKey).toBe(true);
            });

            await it('DOM_KEY_LOCATION constants', async () => {
                expect(KeyboardEvent.DOM_KEY_LOCATION_STANDARD).toBe(0);
                expect(KeyboardEvent.DOM_KEY_LOCATION_LEFT).toBe(1);
                expect(KeyboardEvent.DOM_KEY_LOCATION_RIGHT).toBe(2);
                expect(KeyboardEvent.DOM_KEY_LOCATION_NUMPAD).toBe(3);
            });
        });

        await describe('WheelEvent', async () => {
            await it('creates with delta values', async () => {
                const e = new WheelEvent('wheel', { deltaX: 10, deltaY: -20, deltaMode: 1 });
                expect(e.deltaX).toBe(10);
                expect(e.deltaY).toBe(-20);
                expect(e.deltaMode).toBe(WheelEvent.DOM_DELTA_LINE);
            });

            await it('DOM_DELTA constants', async () => {
                expect(WheelEvent.DOM_DELTA_PIXEL).toBe(0);
                expect(WheelEvent.DOM_DELTA_LINE).toBe(1);
                expect(WheelEvent.DOM_DELTA_PAGE).toBe(2);
            });
        });

        await describe('FocusEvent', async () => {
            await it('creates with relatedTarget', async () => {
                const target = new EventTarget();
                const e = new FocusEvent('focus', { relatedTarget: target });
                expect(e.relatedTarget).toBe(target);
            });
        });

        await describe('PointerEvent', async () => {
            await it('creates with pointer-specific init', async () => {
                const e = new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', isPrimary: true });
                expect(e.pointerId).toBe(1);
                expect(e.pointerType).toBe('mouse');
                expect(e.isPrimary).toBe(true);
            });

            await it('instanceof MouseEvent, UIEvent, Event', async () => {
                const e = new PointerEvent('pointerdown');
                expect(e instanceof MouseEvent).toBe(true);
                expect(e instanceof UIEvent).toBe(true);
                expect(e instanceof Event).toBe(true);
            });
        });
    },
});
