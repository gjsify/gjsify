// Touchscreen contacts → DOM PointerEvents, kept free of GTK so the state machine is testable
// without a digitizer.
//
// Reference: Pointer Events Level 3, § "Mapping for devices that do not support hover"
// (https://w3c.github.io/pointerevents/#mapping-for-devices-that-do-not-support-hover).

import {
    type Event as OurEvent,
    MouseEvent as OurMouseEvent,
    PointerEvent as OurPointerEvent,
} from '@gjsify/dom-events';

export type TouchPhase = 'begin' | 'update' | 'end' | 'cancel';

export interface ModifierKeys {
    shiftKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
}

/** One raw contact frame as the GTK adapter extracted it — widget-local and unrounded. */
export interface TouchFrame extends ModifierKeys {
    phase: TouchPhase;
    /** Equal for every frame of one contact, distinct across concurrent contacts. */
    key: string;
    x: number;
    y: number;
    /** GDK's pointer-emulating contact, which is the spec's primary pointer. */
    isPrimary: boolean;
}

export interface DispatchTarget {
    dispatchEvent(event: OurEvent): boolean;
}

interface ActiveTouch {
    id: number;
    isPrimary: boolean;
    lastX: number;
    lastY: number;
    /** The spec's PREVENT MOUSE EVENT flag: set by a cancelled primary `pointerdown`, cleared on up/cancel. */
    preventMouse: boolean;
}

/** DOM reserves 1 for the mouse pointer (what the mouse path stamps); contacts count on from here. */
const FIRST_TOUCH_POINTER_ID = 2;

/** Hardware that reports no pressure MUST read 0.5 while in contact and 0 otherwise (PE § pressure). */
const CONTACT_PRESSURE = 0.5;

/**
 * Translates a stream of touch frames into the pointer events plus compatibility mouse events the
 * spec prescribes for a device without hover: every pointer event is followed by its mouse
 * counterpart, only the primary contact produces mouse events, and a cancelled primary
 * `pointerdown` suppresses mousedown/mousemove/mouseup — never the transition events, never `click`.
 *
 * Idempotent by construction: a frame for a contact that is not active (a late or repeated end, a
 * cancel already fanned out by GTK) emits nothing, and a `begin` for a contact still active first
 * cancels the stale one — a lost `TOUCH_END` therefore heals on the next contact instead of
 * leaving a pointer pressed for the life of the widget.
 */
export class TouchPointerTranslator {
    private readonly active = new Map<string, ActiveTouch>();
    private nextId = FIRST_TOUCH_POINTER_ID;

    constructor(
        private readonly getElement: () => DispatchTarget | null,
        /** The spec's "at the window" target, where `pointercancel` sends its `mouseup`. */
        private readonly getWindowTarget: () => DispatchTarget | undefined,
    ) {}

    /** Number of contacts currently down. */
    get activeCount(): number {
        return this.active.size;
    }

    handle(frame: TouchFrame): void {
        switch (frame.phase) {
            case 'begin':
                this.begin(frame);
                break;
            case 'update':
                this.update(frame);
                break;
            case 'end':
                this.end(frame);
                break;
            case 'cancel':
                this.cancel(frame);
                break;
        }
    }

    /** Every contact ends in `pointercancel` — for a grab that moved to another surface. */
    cancelAll(modifiers: ModifierKeys): void {
        for (const [key, touch] of this.active) {
            this.cancel({
                ...modifiers,
                phase: 'cancel',
                key,
                x: touch.lastX,
                y: touch.lastY,
                isPrimary: touch.isPrimary,
            });
        }
    }

    private begin(frame: TouchFrame): void {
        const el = this.getElement();
        if (!el) return;
        if (this.active.has(frame.key)) this.cancel(frame);

        const touch: ActiveTouch = {
            id: this.nextId++,
            isPrimary: frame.isPrimary,
            lastX: frame.x,
            lastY: frame.y,
            preventMouse: false,
        };
        this.active.set(frame.key, touch);

        // Nothing is pressed until pointerdown: the transition events report the contact arriving.
        const arriving = this.pointerInit(frame, touch, -1, 0, 0);
        const hover = this.mouseInit(frame, 0, 0);

        // The legacy mouse pointer jumps to the contact before anything else happens.
        if (touch.isPrimary) el.dispatchEvent(new OurMouseEvent('mousemove', hover));
        el.dispatchEvent(new OurPointerEvent('pointerover', arriving));
        el.dispatchEvent(new OurPointerEvent('pointerenter', { ...arriving, bubbles: false, cancelable: false }));
        if (touch.isPrimary) {
            el.dispatchEvent(new OurMouseEvent('mouseover', hover));
            el.dispatchEvent(new OurMouseEvent('mouseenter', { ...hover, bubbles: false, cancelable: false }));
        }
        const down = new OurPointerEvent('pointerdown', this.pointerInit(frame, touch, 0, 1, CONTACT_PRESSURE));
        el.dispatchEvent(down);
        if (!touch.isPrimary) return;
        touch.preventMouse = down.defaultPrevented;
        if (!touch.preventMouse)
            el.dispatchEvent(new OurMouseEvent('mousedown', { ...this.mouseInit(frame, 0, 1), detail: 1 }));
    }

    private update(frame: TouchFrame): void {
        const touch = this.active.get(frame.key);
        if (!touch) return;
        const el = this.getElement();
        if (!el) return;

        const movementX = frame.x - touch.lastX;
        const movementY = frame.y - touch.lastY;
        touch.lastX = frame.x;
        touch.lastY = frame.y;

        // `button` is -1 while nothing about the buttons changed (PE § button).
        el.dispatchEvent(
            new OurPointerEvent('pointermove', {
                ...this.pointerInit(frame, touch, -1, 1, CONTACT_PRESSURE),
                movementX,
                movementY,
            }),
        );
        if (touch.isPrimary && !touch.preventMouse) {
            el.dispatchEvent(new OurMouseEvent('mousemove', { ...this.mouseInit(frame, 0, 1), movementX, movementY }));
        }
    }

    private end(frame: TouchFrame): void {
        const touch = this.active.get(frame.key);
        if (!touch) return;
        this.active.delete(frame.key);
        const el = this.getElement();
        if (!el) return;

        const pointer = this.pointerInit(frame, touch, 0, 0, 0);
        const mouse = this.mouseInit(frame, 0, 0);
        const compat = touch.isPrimary && !touch.preventMouse;

        el.dispatchEvent(new OurPointerEvent('pointerup', pointer));
        if (compat) el.dispatchEvent(new OurMouseEvent('mouseup', { ...mouse, detail: 1 }));
        this.leave(el, touch, pointer, mouse);
        // Activation is not a compatibility mouse event: it survives a cancelled pointerdown.
        if (touch.isPrimary) el.dispatchEvent(new OurMouseEvent('click', { ...mouse, detail: 1 }));
    }

    private cancel(frame: TouchFrame): void {
        const touch = this.active.get(frame.key);
        if (!touch) return;
        this.active.delete(frame.key);
        const el = this.getElement();
        if (!el) return;

        const pointer = this.pointerInit(frame, touch, -1, 0, 0);
        const mouse = this.mouseInit(frame, 0, 0);

        el.dispatchEvent(new OurPointerEvent('pointercancel', { ...pointer, cancelable: false }));
        if (touch.isPrimary && !touch.preventMouse) {
            this.getWindowTarget()?.dispatchEvent(new OurMouseEvent('mouseup', { ...mouse, detail: 1 }));
        }
        this.leave(el, touch, pointer, mouse);
    }

    /** The out/leave pair a device without hover fires after pointerup and pointercancel alike. */
    private leave(el: DispatchTarget, touch: ActiveTouch, pointer: PointerInit, mouse: MouseInit): void {
        el.dispatchEvent(new OurPointerEvent('pointerout', pointer));
        el.dispatchEvent(new OurPointerEvent('pointerleave', { ...pointer, bubbles: false, cancelable: false }));
        if (!touch.isPrimary) return;
        el.dispatchEvent(new OurMouseEvent('mouseout', mouse));
        el.dispatchEvent(new OurMouseEvent('mouseleave', { ...mouse, bubbles: false, cancelable: false }));
    }

    private mouseInit(frame: TouchFrame, button: number, buttons: number): MouseInit {
        return {
            shiftKey: frame.shiftKey,
            ctrlKey: frame.ctrlKey,
            altKey: frame.altKey,
            metaKey: frame.metaKey,
            clientX: frame.x,
            clientY: frame.y,
            offsetX: frame.x,
            offsetY: frame.y,
            screenX: frame.x,
            screenY: frame.y,
            button,
            buttons,
            bubbles: true,
            cancelable: true,
        };
    }

    private pointerInit(
        frame: TouchFrame,
        touch: ActiveTouch,
        button: number,
        buttons: number,
        pressure: number,
    ): PointerInit {
        return {
            ...this.mouseInit(frame, button, buttons),
            pointerId: touch.id,
            pointerType: 'touch',
            isPrimary: touch.isPrimary,
            pressure,
        };
    }
}

type MouseInit = NonNullable<ConstructorParameters<typeof OurMouseEvent>[1]>;
type PointerInit = NonNullable<ConstructorParameters<typeof OurPointerEvent>[1]>;
