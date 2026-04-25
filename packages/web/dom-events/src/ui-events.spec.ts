import { describe, it, expect, on } from '@gjsify/unit';

import {
	Event, UIEvent, MouseEvent, PointerEvent,
	KeyboardEvent, WheelEvent, FocusEvent, EventTarget
} from 'dom-events';

export const UIEventsTest = async () => {

	await describe('UIEvent', async () => {

		await it('should create with defaults', async () => {
			const e = new UIEvent('test');
			expect(e.type).toBe('test');
			expect(e.detail).toBe(0);
			expect(e.view).toBeNull();
			expect(e.bubbles).toBe(false);
			expect(e.cancelable).toBe(false);
		});

		await it('should create with init values', async () => {
			const e = new UIEvent('test', { detail: 42, bubbles: true });
			expect(e.detail).toBe(42);
			expect(e.bubbles).toBe(true);
		});

		await it('should have correct Symbol.toStringTag', async () => {
			const e = new UIEvent('test');
			expect(Object.prototype.toString.call(e)).toBe('[object UIEvent]');
		});

		await it('should be instanceof Event', async () => {
			const e = new UIEvent('test');
			expect(e instanceof Event).toBe(true);
			expect(e instanceof UIEvent).toBe(true);
		});
	});

	await describe('MouseEvent', async () => {

		await it('should create with defaults', async () => {
			const e = new MouseEvent('click');
			expect(e.type).toBe('click');
			expect(e.clientX).toBe(0);
			expect(e.clientY).toBe(0);
			expect(e.button).toBe(0);
			expect(e.buttons).toBe(0);
			expect(e.altKey).toBe(false);
			expect(e.ctrlKey).toBe(false);
			expect(e.metaKey).toBe(false);
			expect(e.shiftKey).toBe(false);
			expect(e.movementX).toBe(0);
			expect(e.movementY).toBe(0);
			expect(e.offsetX).toBe(0);
			expect(e.offsetY).toBe(0);
			expect(e.screenX).toBe(0);
			expect(e.screenY).toBe(0);
			expect(e.relatedTarget).toBeNull();
		});

		await it('should create with init values', async () => {
			// Use mousedown: button/buttons are only meaningful on click/down/up events,
			// not mousemove (browsers correctly return button=0 for mousemove per spec).
			const e = new MouseEvent('mousedown', {
				clientX: 100, clientY: 200,
				button: 2, buttons: 4,
				altKey: true, ctrlKey: true,
				movementX: 5, movementY: -3,
				screenX: 300, screenY: 400,
			});
			expect(e.clientX).toBe(100);
			expect(e.clientY).toBe(200);
			expect(e.button).toBe(2);
			expect(e.buttons).toBe(4);
			expect(e.altKey).toBe(true);
			expect(e.ctrlKey).toBe(true);
			expect(e.movementX).toBe(5);
			expect(e.movementY).toBe(-3);
			expect(e.screenX).toBe(300);
			expect(e.screenY).toBe(400);
		});

		// offsetX/offsetY are @gjsify/dom-events extensions — not part of the standard
		// MouseEventInit dictionary, so browsers ignore them in the constructor.
		await on('Gjs', async () => {
			await it('should propagate offsetX/offsetY from init (GJS extension)', async () => {
				const e = new MouseEvent('mousemove', { clientX: 100, offsetX: 10, offsetY: 20 });
				expect(e.offsetX).toBe(10);
				expect(e.offsetY).toBe(20);
			});
		});

		await it('should have legacy aliases', async () => {
			const e = new MouseEvent('click', { clientX: 50, clientY: 75 });
			expect(e.pageX).toBe(50);
			expect(e.pageY).toBe(75);
			expect(e.x).toBe(50);
			expect(e.y).toBe(75);
		});

		await it('should support getModifierState', async () => {
			const e = new MouseEvent('click', { altKey: true, shiftKey: true });
			expect(e.getModifierState('Alt')).toBe(true);
			expect(e.getModifierState('Shift')).toBe(true);
			expect(e.getModifierState('Control')).toBe(false);
			expect(e.getModifierState('Meta')).toBe(false);
			expect(e.getModifierState('CapsLock')).toBe(false);
		});

		await it('should have correct Symbol.toStringTag', async () => {
			const e = new MouseEvent('click');
			expect(Object.prototype.toString.call(e)).toBe('[object MouseEvent]');
		});

		await it('should be instanceof UIEvent and Event', async () => {
			const e = new MouseEvent('click');
			expect(e instanceof UIEvent).toBe(true);
			expect(e instanceof Event).toBe(true);
		});

		await it('should support relatedTarget', async () => {
			const target = new EventTarget();
			const e = new MouseEvent('mouseenter', { relatedTarget: target });
			expect(e.relatedTarget).toBe(target);
		});
	});

	await describe('PointerEvent', async () => {

		await it('should create with defaults', async () => {
			const e = new PointerEvent('pointerdown');
			expect(e.pointerId).toBe(0);
			expect(e.width).toBe(1);
			expect(e.height).toBe(1);
			expect(e.pressure).toBe(0);
			expect(e.tangentialPressure).toBe(0);
			expect(e.tiltX).toBe(0);
			expect(e.tiltY).toBe(0);
			expect(e.twist).toBe(0);
			expect(e.pointerType).toBe('');
			expect(e.isPrimary).toBe(false);
		});

		await it('should create with init values', async () => {
			const e = new PointerEvent('pointermove', {
				pointerId: 1,
				pointerType: 'mouse',
				isPrimary: true,
				pressure: 0.5,
				width: 10, height: 10,
				clientX: 100, clientY: 200,
			});
			expect(e.pointerId).toBe(1);
			expect(e.pointerType).toBe('mouse');
			expect(e.isPrimary).toBe(true);
			expect(e.pressure).toBe(0.5);
			expect(e.width).toBe(10);
			expect(e.height).toBe(10);
			expect(e.clientX).toBe(100);
			expect(e.clientY).toBe(200);
		});

		await it('should return empty arrays from coalesced/predicted events', async () => {
			const e = new PointerEvent('pointermove');
			const coalesced = e.getCoalescedEvents();
			const predicted = e.getPredictedEvents();
			expect(Array.isArray(coalesced)).toBe(true);
			expect(coalesced.length).toBe(0);
			expect(Array.isArray(predicted)).toBe(true);
			expect(predicted.length).toBe(0);
		});

		await it('should have correct Symbol.toStringTag', async () => {
			const e = new PointerEvent('pointerdown');
			expect(Object.prototype.toString.call(e)).toBe('[object PointerEvent]');
		});

		await it('should be instanceof MouseEvent, UIEvent, and Event', async () => {
			const e = new PointerEvent('pointerdown');
			expect(e instanceof MouseEvent).toBe(true);
			expect(e instanceof UIEvent).toBe(true);
			expect(e instanceof Event).toBe(true);
		});

		await it('should inherit MouseEvent properties', async () => {
			const e = new PointerEvent('pointerdown', { button: 1, altKey: true });
			expect(e.button).toBe(1);
			expect(e.altKey).toBe(true);
			expect(e.getModifierState('Alt')).toBe(true);
		});
	});

	await describe('KeyboardEvent', async () => {

		await it('should create with defaults', async () => {
			const e = new KeyboardEvent('keydown');
			expect(e.key).toBe('');
			expect(e.code).toBe('');
			expect(e.location).toBe(0);
			expect(e.altKey).toBe(false);
			expect(e.ctrlKey).toBe(false);
			expect(e.metaKey).toBe(false);
			expect(e.shiftKey).toBe(false);
			expect(e.repeat).toBe(false);
			expect(e.isComposing).toBe(false);
			expect(e.keyCode).toBe(0);
			expect(e.which).toBe(0);
		});

		await it('should create with init values', async () => {
			const e = new KeyboardEvent('keydown', {
				key: 'Enter', code: 'Enter',
				location: KeyboardEvent.DOM_KEY_LOCATION_STANDARD,
				shiftKey: true, ctrlKey: true,
				repeat: true, keyCode: 13, which: 13,
			});
			expect(e.key).toBe('Enter');
			expect(e.code).toBe('Enter');
			expect(e.location).toBe(0);
			expect(e.shiftKey).toBe(true);
			expect(e.ctrlKey).toBe(true);
			expect(e.repeat).toBe(true);
			expect(e.keyCode).toBe(13);
			expect(e.which).toBe(13);
		});

		await it('should have DOM_KEY_LOCATION constants', async () => {
			expect(KeyboardEvent.DOM_KEY_LOCATION_STANDARD).toBe(0);
			expect(KeyboardEvent.DOM_KEY_LOCATION_LEFT).toBe(1);
			expect(KeyboardEvent.DOM_KEY_LOCATION_RIGHT).toBe(2);
			expect(KeyboardEvent.DOM_KEY_LOCATION_NUMPAD).toBe(3);
		});

		await it('should support getModifierState', async () => {
			const e = new KeyboardEvent('keydown', { ctrlKey: true, metaKey: true });
			expect(e.getModifierState('Control')).toBe(true);
			expect(e.getModifierState('Meta')).toBe(true);
			expect(e.getModifierState('Alt')).toBe(false);
			expect(e.getModifierState('Shift')).toBe(false);
		});

		await it('should have correct Symbol.toStringTag', async () => {
			const e = new KeyboardEvent('keydown');
			expect(Object.prototype.toString.call(e)).toBe('[object KeyboardEvent]');
		});

		await it('should be instanceof UIEvent and Event', async () => {
			const e = new KeyboardEvent('keydown');
			expect(e instanceof UIEvent).toBe(true);
			expect(e instanceof Event).toBe(true);
		});
	});

	await describe('WheelEvent', async () => {

		await it('should create with defaults', async () => {
			const e = new WheelEvent('wheel');
			expect(e.deltaX).toBe(0);
			expect(e.deltaY).toBe(0);
			expect(e.deltaZ).toBe(0);
			expect(e.deltaMode).toBe(0);
		});

		await it('should create with init values', async () => {
			const e = new WheelEvent('wheel', {
				deltaX: 10, deltaY: -20, deltaZ: 5,
				deltaMode: WheelEvent.DOM_DELTA_LINE,
				clientX: 100, clientY: 200,
			});
			expect(e.deltaX).toBe(10);
			expect(e.deltaY).toBe(-20);
			expect(e.deltaZ).toBe(5);
			expect(e.deltaMode).toBe(1);
			expect(e.clientX).toBe(100);
			expect(e.clientY).toBe(200);
		});

		await it('should have DOM_DELTA constants', async () => {
			expect(WheelEvent.DOM_DELTA_PIXEL).toBe(0);
			expect(WheelEvent.DOM_DELTA_LINE).toBe(1);
			expect(WheelEvent.DOM_DELTA_PAGE).toBe(2);
		});

		await it('should have correct Symbol.toStringTag', async () => {
			const e = new WheelEvent('wheel');
			expect(Object.prototype.toString.call(e)).toBe('[object WheelEvent]');
		});

		await it('should be instanceof MouseEvent, UIEvent, and Event', async () => {
			const e = new WheelEvent('wheel');
			expect(e instanceof MouseEvent).toBe(true);
			expect(e instanceof UIEvent).toBe(true);
			expect(e instanceof Event).toBe(true);
		});
	});

	await describe('FocusEvent', async () => {

		await it('should create with defaults', async () => {
			const e = new FocusEvent('focus');
			expect(e.relatedTarget).toBeNull();
		});

		await it('should create with relatedTarget', async () => {
			const target = new EventTarget();
			const e = new FocusEvent('blur', { relatedTarget: target });
			expect(e.relatedTarget).toBe(target);
		});

		await it('should have correct Symbol.toStringTag', async () => {
			const e = new FocusEvent('focus');
			expect(Object.prototype.toString.call(e)).toBe('[object FocusEvent]');
		});

		await it('should be instanceof UIEvent and Event', async () => {
			const e = new FocusEvent('focus');
			expect(e instanceof UIEvent).toBe(true);
			expect(e instanceof Event).toBe(true);
		});
	});
};
