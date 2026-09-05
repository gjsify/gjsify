// GTK Event Controller → DOM Event bridge
// Attaches GTK4 event controllers to a widget and dispatches standard DOM events
// on the associated HTMLElement. Used by Canvas2DBridge, WebGLBridge, IFrameBridge, VideoBridge.
//
// Reference: W3C UIEvents Specification (https://www.w3.org/TR/uievents/)
// and Pointer Events Level 3 (https://w3c.github.io/pointerevents/)
//
// Two pointer sources, deliberately kept apart. A mouse (or pen) goes through
// `EventControllerMotion` + `GestureClick`, which hand over widget-local coordinates and
// GTK's click counting. A touchscreen goes through `EventControllerLegacy`, because that is
// where the contacts actually arrive: measured on a OnePlus 6T (GTK 4.22, mutter 48, real
// finger, 1183 rows) `EventControllerMotion` emitted 0 `motion` for touch while the raw
// stream carried every `TOUCH_BEGIN`/`TOUCH_UPDATE`/`TOUCH_END` 1:1, and `GestureClick`
// stranded its press on 2 of 3 two-finger gestures (5 pressed / 3 released / 0 cancel).
// So a touch-sourced GestureClick signal is ignored here, never translated.

import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Graphene from 'gi://Graphene?version=1.0';
import {
    type Event as OurEvent,
    MouseEvent as OurMouseEvent,
    PointerEvent as OurPointerEvent,
    KeyboardEvent as OurKeyboardEvent,
    WheelEvent as OurWheelEvent,
    FocusEvent as OurFocusEvent,
} from '@gjsify/dom-events';
import { gdkKeyvalToKey, gdkKeyvalToCode, gdkKeyvalToLocation } from './key-map.js';
import { type DispatchTarget, type ModifierKeys, type TouchPhase, TouchPointerTranslator } from './touch-pointers.js';

interface BridgeState {
    lastX: number;
    lastY: number;
    buttonsPressed: number;
    pressedKeys: Set<number>;
}

/** DOM pointerId of the one hover-capable pointer; contacts start above it (touch-pointers.ts). */
const MOUSE_POINTER_ID = 1;

/**
 * A wheel notch in DOM_DELTA_LINE units. GDK reports a notch as 1.0 of unit WHEEL; every
 * platform that exposes the setting scrolls three lines per notch (Windows
 * SPI_GETWHEELSCROLLLINES, Firefox's default), and consumers that honour deltaMode scale
 * lines by their line height — which lands near Chromium's ~53 px per notch on Linux.
 */
const LINES_PER_WHEEL_NOTCH = 3;

const TOUCH_PHASES: ReadonlyMap<Gdk.EventType, TouchPhase> = new Map([
    [Gdk.EventType.TOUCH_BEGIN, 'begin'],
    [Gdk.EventType.TOUCH_UPDATE, 'update'],
    [Gdk.EventType.TOUCH_END, 'end'],
    [Gdk.EventType.TOUCH_CANCEL, 'cancel'],
]);

/**
 * True for an event GDK synthesised from a touchscreen contact. A synthetic `emit()` on a
 * controller has no current event and reads as a mouse, which is what the tests and the
 * node-gi fixture drive.
 */
export function isTouchEvent(event: Gdk.Event | null): boolean {
    return event !== null && TOUCH_PHASES.has(event.get_event_type());
}

/** The DOM pointerType a GDK device source maps to; no event means a synthetic mouse. */
export function pointerTypeOf(event: Gdk.Event | null): 'mouse' | 'pen' | 'touch' {
    const source = event?.get_device()?.get_source();
    if (source === Gdk.InputSource.TOUCHSCREEN) return 'touch';
    if (source === Gdk.InputSource.PEN) return 'pen';
    return 'mouse';
}

const NATIVE_ADDRESS_MARKER = 'native@';
let sequenceKeyFallbackReported = false;

/**
 * A key equal for every event of one contact and distinct across concurrent contacts.
 *
 * `GdkEventSequence` is an opaque boxed pointer (the Wayland backend passes the wl_touch id + 1;
 * measured `0x2a1`/`0x2a2` for two fingers on mutter 48) with no accessor at all, and GJS
 * creates a fresh wrapper for every call, so two wrappers of the
 * same contact are never `===`. The pointer is still legible: GJS prints every wrapper as
 * `[boxed instance wrapper GIName:Gdk.EventSequence jsobj@0x… native@0x…]`, and the `native@`
 * address is the sequence itself; GTK registers the type with an identity copy, so every wrapper
 * of one contact prints the same address. A runtime that prints something else (node-gi) falls
 * back to the emulating-pointer flag, which still separates two concurrent contacts — measured
 * 330/249 true/false over real two-finger episodes — and says so once instead of silently merging
 * fingers. A null sequence is GTK's own "the pointer" sequence, not a legibility problem, so it
 * takes the flag key quietly.
 */
export function sequenceKey(sequence: Gdk.EventSequence | null, isPrimary: boolean): string {
    if (sequence === null) return isPrimary ? 'primary' : 'secondary';
    const text = String(sequence);
    const at = text.lastIndexOf(NATIVE_ADDRESS_MARKER);
    if (at !== -1 && text.endsWith(']')) return text.slice(at + NATIVE_ADDRESS_MARKER.length, -1);
    if (!sequenceKeyFallbackReported) {
        sequenceKeyFallbackReported = true;
        console.warn(
            '@gjsify/event-bridge: GdkEventSequence identity is not readable on this runtime; ' +
                'touch pointers are keyed by the emulating-pointer flag, so a third concurrent contact merges with the second.',
        );
    }
    return isPrimary ? 'primary' : 'secondary';
}

/**
 * GDK positions are surface-relative. GTK hands every controller widget-local coordinates,
 * but `EventControllerLegacy` drops them from its signal, so this repeats the translation
 * gtkmain.c performs before it runs a controller: subtract the native's surface transform,
 * then map through the widget tree with `compute_point`.
 */
export function surfaceToWidget(widget: Gtk.Widget, surfaceX: number, surfaceY: number): [number, number] {
    // An event only reaches a controller on a rooted widget, so the native exists.
    const native = widget.get_native()!;
    const [nativeX, nativeY] = native.get_surface_transform();
    const x = surfaceX - nativeX;
    const y = surfaceY - nativeY;
    const [ok, point] = (native as unknown as Gtk.Widget).compute_point(widget, new Graphene.Point({ x, y }));
    // compute_point reports a non-invertible transform through its return value, not an error.
    return ok ? [point.x, point.y] : [x, y];
}

/**
 * Typed view over the singleton globalThis-scoped EventTarget that
 * `@gjsify/dom-elements/register/document.ts` installs as
 * `__gjsify_globalEventTarget`. Window-level listeners (e.g. Excalibur's
 * `Keyboard.init` on 'keydown' / 'keyup' / 'blur') hook into it; this
 * file optionally re-dispatches a subset of GTK→DOM events there.
 */
interface _GlobalEventTargetHolder {
    __gjsify_globalEventTarget?: { dispatchEvent(event: Event): boolean };
}

function getGlobalEventTarget(): { dispatchEvent(event: Event): boolean } | undefined {
    return (globalThis as unknown as _GlobalEventTargetHolder).__gjsify_globalEventTarget;
}

const NO_MODIFIERS: ModifierKeys = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };

function modifiersFromState(mods: number): ModifierKeys {
    return {
        shiftKey: !!(mods & Gdk.ModifierType.SHIFT_MASK),
        ctrlKey: !!(mods & Gdk.ModifierType.CONTROL_MASK),
        altKey: !!(mods & Gdk.ModifierType.ALT_MASK),
        metaKey: !!(mods & Gdk.ModifierType.SUPER_MASK),
    };
}

/** Extract modifier flags from a GTK event controller's current event state. */
function extractModifiers(controller: Gtk.EventController): ModifierKeys {
    return modifiersFromState(controller.get_current_event_state() as number);
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
    if (mods & Gdk.ModifierType.BUTTON1_MASK) buttons |= 1; // primary
    if (mods & Gdk.ModifierType.BUTTON3_MASK) buttons |= 2; // secondary
    if (mods & Gdk.ModifierType.BUTTON2_MASK) buttons |= 4; // auxiliary
    return buttons;
}

/**
 * Attach GTK event controllers to a widget and dispatch standard DOM events
 * on the HTMLElement returned by `getElement()`.
 *
 * Controllers attached, in this order (the node-gi fixture reads them back by add order):
 * - EventControllerMotion → pointermove/mousemove, pointerenter/mouseenter, pointerleave/mouseleave
 * - GestureClick → pointerdown/mousedown, pointerup/mouseup, click, dblclick, contextmenu,
 *   pointercancel — mouse and pen only
 * - EventControllerScroll → wheel
 * - EventControllerKey → keydown, keyup
 * - EventControllerFocus → focus/focusin, blur/focusout
 * - EventControllerLegacy → the touchscreen: one PointerEvent stream per contact with a distinct
 *   pointerId, plus the compatibility mouse events the primary contact owes legacy code
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
    getElement: () => { dispatchEvent(event: OurEvent): boolean } | null,
    options?: EventControllerOptions,
): void {
    // Make widget focusable for keyboard events
    widget.set_focusable(true);
    widget.set_can_focus(true);

    const state: BridgeState = { lastX: 0, lastY: 0, buttonsPressed: 0, pressedKeys: new Set() };
    // The window bus is typed against lib.dom's Event, ours against @gjsify/dom-events — the same
    // seam every `getGlobalEventTarget()?.dispatchEvent(… as unknown as Event)` below crosses.
    const touch = new TouchPointerTranslator(
        getElement,
        () => getGlobalEventTarget() as unknown as DispatchTarget | undefined,
    );

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
        const init = {
            ...mods,
            clientX: cx,
            clientY: cy,
            offsetX: cx,
            offsetY: cy,
            screenX: cx,
            screenY: cy,
            movementX,
            movementY,
            buttons,
            button: 0,
            bubbles: true,
            cancelable: true,
        };

        el.dispatchEvent(
            new OurPointerEvent('pointermove', {
                ...init,
                pointerId: MOUSE_POINTER_ID,
                pointerType: pointerTypeOf(motionCtrl.get_current_event()),
                isPrimary: true,
            }),
        );
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
        const init = {
            ...mods,
            clientX: x,
            clientY: y,
            offsetX: x,
            offsetY: y,
            screenX: x,
            screenY: y,
            bubbles: false,
            cancelable: false,
        };

        el.dispatchEvent(
            new OurPointerEvent('pointerenter', {
                ...init,
                pointerId: MOUSE_POINTER_ID,
                pointerType: pointerTypeOf(motionCtrl.get_current_event()),
                isPrimary: true,
            }),
        );
        el.dispatchEvent(new OurMouseEvent('mouseenter', init));
        el.dispatchEvent(new OurMouseEvent('mouseover', { ...init, bubbles: true }));
    });

    motionCtrl.connect('leave', () => {
        const el = getElement();
        if (!el) return;
        const mods = extractModifiers(motionCtrl);
        const init = { ...mods, clientX: state.lastX, clientY: state.lastY, bubbles: false, cancelable: false };

        el.dispatchEvent(
            new OurPointerEvent('pointerleave', {
                ...init,
                pointerId: MOUSE_POINTER_ID,
                pointerType: pointerTypeOf(motionCtrl.get_current_event()),
                isPrimary: true,
            }),
        );
        el.dispatchEvent(new OurMouseEvent('mouseleave', init));
        el.dispatchEvent(new OurMouseEvent('mouseout', { ...init, bubbles: true }));
    });

    widget.add_controller(motionCtrl);

    // ---- Click controller ----
    const clickCtrl = new Gtk.GestureClick();
    clickCtrl.set_button(0); // Listen to all buttons

    clickCtrl.connect('pressed', (_ctrl: Gtk.GestureClick, nPress: number, x: number, y: number) => {
        // A contact's press already went out from the raw stream; GestureClick's copy is the one
        // that intermittently never releases.
        if (isTouchEvent(clickCtrl.get_current_event())) return;
        const el = getElement();
        if (!el) return;
        const gtkButton = clickCtrl.get_current_button();
        const domButton = gtkButtonToDom(gtkButton);
        const mods = extractModifiers(clickCtrl);
        state.buttonsPressed |= 1 << domButton;
        const init = {
            ...mods,
            clientX: x,
            clientY: y,
            offsetX: x,
            offsetY: y,
            screenX: x,
            screenY: y,
            button: domButton,
            buttons: state.buttonsPressed,
            detail: nPress,
            bubbles: true,
            cancelable: true,
        };

        el.dispatchEvent(
            new OurPointerEvent('pointerdown', {
                ...init,
                pointerId: MOUSE_POINTER_ID,
                pointerType: pointerTypeOf(clickCtrl.get_current_event()),
                isPrimary: true,
            }),
        );
        el.dispatchEvent(new OurMouseEvent('mousedown', init));

        // Grab focus on click so keyboard events work
        widget.grab_focus();
    });

    clickCtrl.connect('released', (_ctrl: Gtk.GestureClick, nPress: number, x: number, y: number) => {
        if (isTouchEvent(clickCtrl.get_current_event())) return;
        const el = getElement();
        if (!el) return;
        const gtkButton = clickCtrl.get_current_button();
        const domButton = gtkButtonToDom(gtkButton);
        const mods = extractModifiers(clickCtrl);
        state.buttonsPressed &= ~(1 << domButton);
        const init = {
            ...mods,
            clientX: x,
            clientY: y,
            offsetX: x,
            offsetY: y,
            screenX: x,
            screenY: y,
            button: domButton,
            buttons: state.buttonsPressed,
            detail: nPress,
            bubbles: true,
            cancelable: true,
        };

        el.dispatchEvent(
            new OurPointerEvent('pointerup', {
                ...init,
                pointerId: MOUSE_POINTER_ID,
                pointerType: pointerTypeOf(clickCtrl.get_current_event()),
                isPrimary: true,
            }),
        );
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

    // GTK cancels the gesture instead of releasing it when the grab moves elsewhere — a popover
    // opened from the contextmenu handler is the everyday case — and `released` then never
    // comes, which left the button bit stuck in `buttons` for every later event.
    clickCtrl.connect('cancel', (_ctrl: Gtk.GestureClick, sequence: Gdk.EventSequence | null) => {
        const lastEvent = clickCtrl.get_last_event(sequence);
        if (isTouchEvent(lastEvent)) return;
        if (state.buttonsPressed === 0) return;
        state.buttonsPressed = 0;
        const el = getElement();
        if (!el) return;
        el.dispatchEvent(
            new OurPointerEvent('pointercancel', {
                ...extractModifiers(clickCtrl),
                clientX: state.lastX,
                clientY: state.lastY,
                offsetX: state.lastX,
                offsetY: state.lastY,
                screenX: state.lastX,
                screenY: state.lastY,
                button: -1,
                buttons: 0,
                pointerId: MOUSE_POINTER_ID,
                pointerType: pointerTypeOf(lastEvent),
                isPrimary: true,
                bubbles: true,
                cancelable: false,
            }),
        );
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
        // The unit of the event being handled (WHEEL before any event arrived, which is what a
        // synthetic `emit()` gets). Measured: a wheel notch reports WHEEL, a touchpad SURFACE.
        const notches = scrollCtrl.get_unit() === Gdk.ScrollUnit.WHEEL;
        const scale = notches ? LINES_PER_WHEEL_NOTCH : 1;
        const init = {
            ...mods,
            clientX: state.lastX,
            clientY: state.lastY,
            offsetX: state.lastX,
            offsetY: state.lastY,
            screenX: state.lastX,
            screenY: state.lastY,
            deltaX: dx * scale,
            deltaY: dy * scale,
            deltaZ: 0,
            deltaMode: notches ? OurWheelEvent.DOM_DELTA_LINE : OurWheelEvent.DOM_DELTA_PIXEL,
            bubbles: true,
            cancelable: true,
        };

        el.dispatchEvent(new OurWheelEvent('wheel', init));
        return false;
    });

    widget.add_controller(scrollCtrl);

    // ---- Key controller ----
    const keyCtrl = new Gtk.EventControllerKey();

    keyCtrl.connect(
        'key-pressed',
        (_ctrl: Gtk.EventControllerKey, keyval: number, _keycode: number, modifiers: number) => {
            const el = getElement();
            if (!el) return false;

            const repeat = state.pressedKeys.has(keyval);
            state.pressedKeys.add(keyval);

            const key = gdkKeyvalToKey(keyval);
            const code = gdkKeyvalToCode(keyval);
            const location = gdkKeyvalToLocation(keyval);
            const init = {
                key,
                code,
                location,
                repeat,
                altKey: !!(modifiers & Gdk.ModifierType.ALT_MASK),
                ctrlKey: !!(modifiers & Gdk.ModifierType.CONTROL_MASK),
                metaKey: !!(modifiers & Gdk.ModifierType.SUPER_MASK),
                shiftKey: !!(modifiers & Gdk.ModifierType.SHIFT_MASK),
                keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
                which: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
                bubbles: true,
                cancelable: true,
            };
            const keydownEvent = new OurKeyboardEvent('keydown', init);
            el.dispatchEvent(keydownEvent);
            // Also dispatch on globalThis so window-level listeners (e.g. Excalibur's
            // Keyboard.init) receive the event — matches browser behaviour where
            // keydown/keyup bubble to window scope.
            getGlobalEventTarget()?.dispatchEvent(new OurKeyboardEvent('keydown', init) as unknown as Event);
            // Return true to consume the event and prevent GTK focus traversal
            // (e.g. arrow keys moving focus away from the canvas). Required for
            // game canvases where all keys must stay in the app.
            return options?.captureKeys === true ? true : false;
        },
    );

    keyCtrl.connect(
        'key-released',
        (_ctrl: Gtk.EventControllerKey, keyval: number, _keycode: number, modifiers: number) => {
            const el = getElement();
            if (!el) return;

            state.pressedKeys.delete(keyval);

            const key = gdkKeyvalToKey(keyval);
            const code = gdkKeyvalToCode(keyval);
            const location = gdkKeyvalToLocation(keyval);
            const init = {
                key,
                code,
                location,
                repeat: false,
                altKey: !!(modifiers & Gdk.ModifierType.ALT_MASK),
                ctrlKey: !!(modifiers & Gdk.ModifierType.CONTROL_MASK),
                metaKey: !!(modifiers & Gdk.ModifierType.SUPER_MASK),
                shiftKey: !!(modifiers & Gdk.ModifierType.SHIFT_MASK),
                keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
                which: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
                bubbles: true,
                cancelable: true,
            };
            el.dispatchEvent(new OurKeyboardEvent('keyup', init));
            getGlobalEventTarget()?.dispatchEvent(new OurKeyboardEvent('keyup', init) as unknown as Event);
        },
    );

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
        getGlobalEventTarget()?.dispatchEvent(
            new OurFocusEvent('blur', { bubbles: false, cancelable: false }) as unknown as Event,
        );
    });

    widget.add_controller(focusCtrl);

    // ---- Touchscreen ----
    // Added last, so it runs first: GTK runs a widget's controllers in reverse add order, and
    // the contact's pointer events must precede whatever GestureClick still emits for it.
    const legacyCtrl = new Gtk.EventControllerLegacy();

    legacyCtrl.connect('event', (_ctrl: Gtk.EventControllerLegacy, event: Gdk.Event) => {
        const type = event.get_event_type();
        const phase = TOUCH_PHASES.get(type);
        if (phase === undefined) {
            // Another surface took the grab (a popover opened from a long-press): the contacts'
            // TOUCH_END will go there, so end them here the way GtkGesture cancels itself.
            if (type === Gdk.EventType.GRAB_BROKEN && touch.activeCount > 0) {
                const grabSurface = (event as Gdk.GrabBrokenEvent).get_grab_surface();
                if (grabSurface !== widget.get_native()!.get_surface()) {
                    touch.cancelAll(modifiersFromState(event.get_modifier_state()));
                }
            }
            return false;
        }
        const [, surfaceX, surfaceY] = event.get_position();
        const [x, y] = surfaceToWidget(widget, surfaceX, surfaceY);
        // Only meaningful once the source is known to be a touchscreen — mouse events read false too.
        const isPrimary = (event as Gdk.TouchEvent).get_emulating_pointer();
        touch.handle({
            ...modifiersFromState(event.get_modifier_state()),
            phase,
            key: sequenceKey(event.get_event_sequence(), isPrimary),
            x,
            y,
            isPrimary,
        });
        if (phase === 'begin') widget.grab_focus();
        return false;
    });

    widget.add_controller(legacyCtrl);

    // GTK resets every controller when the widget unmaps or turns insensitive (gtkwidget.c
    // gtk_widget_real_unmap / gtk_widget_set_sensitive → gtk_widget_reset_controllers), which is
    // how a GtkGesture cancels its sequences. The raw stream has no reset, and once the pointer
    // focus moved on, the contacts' TOUCH_END lands under the finger and never here — so the
    // translator ends them the way the gestures do.
    widget.connect('unmap', () => touch.cancelAll(NO_MODIFIERS));
    widget.connect('state-flags-changed', (_w: Gtk.Widget, previous: Gtk.StateFlags) => {
        const insensitive = Gtk.StateFlags.INSENSITIVE;
        if (widget.get_state_flags() & insensitive && !(previous & insensitive)) touch.cancelAll(NO_MODIFIERS);
    });
}
