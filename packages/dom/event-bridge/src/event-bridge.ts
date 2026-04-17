// GTK Event Controller → DOM Event bridge
// Attaches GTK4 event controllers to a widget and dispatches standard DOM events
// on the associated HTMLElement. Used by Canvas2DBridge, WebGLBridge, IFrameBridge, VideoBridge.
//
// Reference: W3C UIEvents Specification (https://www.w3.org/TR/uievents/)

import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import {
    MouseEvent as OurMouseEvent,
    PointerEvent as OurPointerEvent,
    KeyboardEvent as OurKeyboardEvent,
    WheelEvent as OurWheelEvent,
    FocusEvent as OurFocusEvent,
} from '@gjsify/dom-events';
import { gdkKeyvalToKey, gdkKeyvalToCode, gdkKeyvalToLocation } from './key-map.js';

interface BridgeState {
    lastX: number;
    lastY: number;
    buttonsPressed: number;
    pressedKeys: Set<number>;
}

/** Extract modifier flags from a GTK event controller's current event state. */
function extractModifiers(controller: Gtk.EventController) {
    const mods = controller.get_current_event_state() as number;
    return {
        shiftKey: !!(mods & Gdk.ModifierType.SHIFT_MASK),
        ctrlKey: !!(mods & Gdk.ModifierType.CONTROL_MASK),
        altKey: !!(mods & Gdk.ModifierType.ALT_MASK),
        metaKey: !!(mods & Gdk.ModifierType.SUPER_MASK),
    };
}

/** Map GTK button number (1=left, 2=middle, 3=right) to DOM button (0=left, 1=middle, 2=right). */
function gtkButtonToDom(gtkButton: number): number {
    if (gtkButton === 1) return 0;
    if (gtkButton === 2) return 1;
    if (gtkButton === 3) return 2;
    return gtkButton - 1;
}

/** Read buttons bitmask from Gdk modifier state. */
function buttonsFromModifiers(controller: Gtk.EventController): number {
    const mods = controller.get_current_event_state() as number;
    let buttons = 0;
    if (mods & Gdk.ModifierType.BUTTON1_MASK) buttons |= 1;  // primary
    if (mods & Gdk.ModifierType.BUTTON3_MASK) buttons |= 2;  // secondary
    if (mods & Gdk.ModifierType.BUTTON2_MASK) buttons |= 4;  // auxiliary
    return buttons;
}

/**
 * Attach GTK event controllers to a widget and dispatch standard DOM events
 * on the HTMLElement returned by `getElement()`.
 *
 * Controllers attached:
 * - EventControllerMotion → pointermove/mousemove, pointerenter/mouseenter, pointerleave/mouseleave
 * - GestureClick → pointerdown/mousedown, pointerup/mouseup, click, dblclick, contextmenu
 * - EventControllerScroll → wheel
 * - EventControllerKey → keydown, keyup
 * - EventControllerFocus → focus/focusin, blur/focusout
 *
 * @param widget The GTK widget to attach controllers to
 * @param getElement Returns the HTMLElement to dispatch events on (may be null before init)
 */
export interface EventControllerOptions {
    /**
     * When true, key-pressed returns true to consume the event and prevent GTK
     * focus traversal (e.g. arrow keys moving focus to other widgets). Set this
     * for game canvases where all keys must reach the app, never GTK.
     * Default: false.
     */
    captureKeys?: boolean;
}

export function attachEventControllers(
    widget: Gtk.Widget,
    getElement: () => { dispatchEvent(event: any): boolean } | null,
    options?: EventControllerOptions,
): void {
    // Make widget focusable for keyboard events
    widget.set_focusable(true);
    widget.set_can_focus(true);

    const state: BridgeState = { lastX: 0, lastY: 0, buttonsPressed: 0, pressedKeys: new Set() };

    // ---- Motion controller ----
    const motionCtrl = new Gtk.EventControllerMotion();

    motionCtrl.connect('motion', (_ctrl: Gtk.EventControllerMotion, x: number, y: number) => {
        const el = getElement();
        if (!el) return;
        // Use widget-local coords from the signal directly. Previously we
        // pulled coords from `motionCtrl.get_current_event().get_position()`,
        // which returns SURFACE-local coords — inconsistent with `pressed`
        // (GestureClick passes widget-local coords to its callback) and
        // caused drag anchors to jump on the first move after a click.
        const allocW = widget.get_allocated_width();
        const allocH = widget.get_allocated_height();
        const cx = Math.max(0, Math.min(x, allocW));
        const cy = Math.max(0, Math.min(y, allocH));
        const movementX = cx - state.lastX;
        const movementY = cy - state.lastY;
        const mods = extractModifiers(motionCtrl);
        const buttons = buttonsFromModifiers(motionCtrl);
        const init = { ...mods, clientX: cx, clientY: cy, offsetX: cx, offsetY: cy, screenX: cx, screenY: cy, movementX, movementY, buttons, button: 0, bubbles: true, cancelable: true };

        el.dispatchEvent(new OurPointerEvent('pointermove', { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new OurMouseEvent('mousemove', init));

        state.lastX = cx;
        state.lastY = cy;
    });

    motionCtrl.connect('enter', (_ctrl: Gtk.EventControllerMotion, x: number, y: number) => {
        const el = getElement();
        if (!el) return;
        state.lastX = x;
        state.lastY = y;
        const mods = extractModifiers(motionCtrl);
        const init = { ...mods, clientX: x, clientY: y, offsetX: x, offsetY: y, screenX: x, screenY: y, bubbles: false, cancelable: false };

        el.dispatchEvent(new OurPointerEvent('pointerenter', { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new OurMouseEvent('mouseenter', init));
        el.dispatchEvent(new OurMouseEvent('mouseover', { ...init, bubbles: true }));
    });

    motionCtrl.connect('leave', () => {
        const el = getElement();
        if (!el) return;
        const mods = extractModifiers(motionCtrl);
        const init = { ...mods, clientX: state.lastX, clientY: state.lastY, bubbles: false, cancelable: false };

        el.dispatchEvent(new OurPointerEvent('pointerleave', { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new OurMouseEvent('mouseleave', init));
        el.dispatchEvent(new OurMouseEvent('mouseout', { ...init, bubbles: true }));
    });

    widget.add_controller(motionCtrl);

    // ---- Click controller ----
    const clickCtrl = new Gtk.GestureClick();
    clickCtrl.set_button(0); // Listen to all buttons

    clickCtrl.connect('pressed', (_ctrl: Gtk.GestureClick, nPress: number, x: number, y: number) => {
        const el = getElement();
        if (!el) return;
        const gtkButton = clickCtrl.get_current_button();
        const domButton = gtkButtonToDom(gtkButton);
        const mods = extractModifiers(clickCtrl);
        state.buttonsPressed |= (1 << domButton);
        const init = { ...mods, clientX: x, clientY: y, offsetX: x, offsetY: y, screenX: x, screenY: y, button: domButton, buttons: state.buttonsPressed, detail: nPress, bubbles: true, cancelable: true };

        el.dispatchEvent(new OurPointerEvent('pointerdown', { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new OurMouseEvent('mousedown', init));

        // Grab focus on click so keyboard events work
        widget.grab_focus();
    });

    clickCtrl.connect('released', (_ctrl: Gtk.GestureClick, nPress: number, x: number, y: number) => {
        const el = getElement();
        if (!el) return;
        const gtkButton = clickCtrl.get_current_button();
        const domButton = gtkButtonToDom(gtkButton);
        const mods = extractModifiers(clickCtrl);
        state.buttonsPressed &= ~(1 << domButton);
        const init = { ...mods, clientX: x, clientY: y, offsetX: x, offsetY: y, screenX: x, screenY: y, button: domButton, buttons: state.buttonsPressed, detail: nPress, bubbles: true, cancelable: true };

        el.dispatchEvent(new OurPointerEvent('pointerup', { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new OurMouseEvent('mouseup', init));

        // click event (left button only per spec)
        if (domButton === 0) {
            el.dispatchEvent(new OurMouseEvent('click', init));
            if (nPress === 2) {
                el.dispatchEvent(new OurMouseEvent('dblclick', init));
            }
        }
        // contextmenu on right-click
        if (domButton === 2) {
            el.dispatchEvent(new OurMouseEvent('contextmenu', { ...init, cancelable: true }));
        }
    });

    widget.add_controller(clickCtrl);

    // ---- Scroll controller ----
    const scrollCtrl = new Gtk.EventControllerScroll({
        flags: Gtk.EventControllerScrollFlags.BOTH_AXES,
    });

    scrollCtrl.connect('scroll', (_ctrl: Gtk.EventControllerScroll, dx: number, dy: number) => {
        const el = getElement();
        if (!el) return;
        const mods = extractModifiers(scrollCtrl);
        // GTK scroll: discrete ticks are ±1.0 per notch. Scale to ~100px to match browser behavior.
        const scale = 100;
        const init = { ...mods, clientX: state.lastX, clientY: state.lastY, offsetX: state.lastX, offsetY: state.lastY, screenX: state.lastX, screenY: state.lastY, deltaX: dx * scale, deltaY: dy * scale, deltaZ: 0, deltaMode: 0, bubbles: true, cancelable: true };

        el.dispatchEvent(new OurWheelEvent('wheel', init));
        return false;
    });

    widget.add_controller(scrollCtrl);

    // ---- Key controller ----
    const keyCtrl = new Gtk.EventControllerKey();

    keyCtrl.connect('key-pressed', (_ctrl: Gtk.EventControllerKey, keyval: number, _keycode: number, modifiers: number) => {
        const el = getElement();
        if (!el) return false;

        const repeat = state.pressedKeys.has(keyval);
        state.pressedKeys.add(keyval);

        const key = gdkKeyvalToKey(keyval);
        const code = gdkKeyvalToCode(keyval);
        const location = gdkKeyvalToLocation(keyval);
        const init = {
            key, code, location, repeat,
            altKey: !!(modifiers & Gdk.ModifierType.ALT_MASK),
            ctrlKey: !!(modifiers & Gdk.ModifierType.CONTROL_MASK),
            metaKey: !!(modifiers & Gdk.ModifierType.SUPER_MASK),
            shiftKey: !!(modifiers & Gdk.ModifierType.SHIFT_MASK),
            keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
            which: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
            bubbles: true, cancelable: true,
        };
        const keydownEvent = new OurKeyboardEvent('keydown', init);
        el.dispatchEvent(keydownEvent);
        // Also dispatch on globalThis so window-level listeners (e.g. Excalibur's
        // Keyboard.init) receive the event — matches browser behaviour where
        // keydown/keyup bubble to window scope.
        (globalThis as any).__gjsify_globalEventTarget?.dispatchEvent(new OurKeyboardEvent('keydown', init));
        // Return true to consume the event and prevent GTK focus traversal
        // (e.g. arrow keys moving focus away from the canvas). Required for
        // game canvases where all keys must stay in the app.
        return options?.captureKeys === true ? true : false;
    });

    keyCtrl.connect('key-released', (_ctrl: Gtk.EventControllerKey, keyval: number, _keycode: number, modifiers: number) => {
        const el = getElement();
        if (!el) return;

        state.pressedKeys.delete(keyval);

        const key = gdkKeyvalToKey(keyval);
        const code = gdkKeyvalToCode(keyval);
        const location = gdkKeyvalToLocation(keyval);
        const init = {
            key, code, location, repeat: false,
            altKey: !!(modifiers & Gdk.ModifierType.ALT_MASK),
            ctrlKey: !!(modifiers & Gdk.ModifierType.CONTROL_MASK),
            metaKey: !!(modifiers & Gdk.ModifierType.SUPER_MASK),
            shiftKey: !!(modifiers & Gdk.ModifierType.SHIFT_MASK),
            keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
            which: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
            bubbles: true, cancelable: true,
        };
        el.dispatchEvent(new OurKeyboardEvent('keyup', init));
        (globalThis as any).__gjsify_globalEventTarget?.dispatchEvent(new OurKeyboardEvent('keyup', init));
    });

    widget.add_controller(keyCtrl);

    // ---- Focus controller ----
    const focusCtrl = new Gtk.EventControllerFocus();

    focusCtrl.connect('enter', () => {
        const el = getElement();
        if (!el) return;
        el.dispatchEvent(new OurFocusEvent('focus', { bubbles: false, cancelable: false }));
        el.dispatchEvent(new OurFocusEvent('focusin', { bubbles: true, cancelable: false }));
    });

    focusCtrl.connect('leave', () => {
        const el = getElement();
        if (!el) return;
        state.pressedKeys.clear(); // Reset key state on blur
        el.dispatchEvent(new OurFocusEvent('blur', { bubbles: false, cancelable: false }));
        el.dispatchEvent(new OurFocusEvent('focusout', { bubbles: true, cancelable: false }));
        // Excalibur's Keyboard.init() listens for 'blur' on globalThis to clear
        // pressed keys when the window loses focus.
        (globalThis as any).__gjsify_globalEventTarget?.dispatchEvent(new OurFocusEvent('blur', { bubbles: false, cancelable: false }));
    });

    widget.add_controller(focusCtrl);
}
