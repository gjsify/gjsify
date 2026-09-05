# @gjsify/event-bridge

GTK to DOM event bridge for GJS. Maps GTK4 event controllers to standard DOM events (MouseEvent, PointerEvent, KeyboardEvent, WheelEvent, FocusEvent).

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/event-bridge

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/event-bridge
yarn add @gjsify/event-bridge
```

## Usage

```typescript
import { attachEventControllers } from '@gjsify/event-bridge';

// Attach GTK4 event controllers that dispatch DOM events
attachEventControllers(gtkWidget, () => domElement);
```

### Supported Event Mappings

| GTK Controller | DOM Events |
|---|---|
| EventControllerMotion | pointermove, mousemove, pointer/mouse enter/leave/over/out (mouse and pen) |
| GestureClick | pointer/mouse down/up, click, dblclick, contextmenu, pointercancel (mouse and pen) |
| EventControllerScroll | wheel — `deltaMode` follows `Gdk.ScrollUnit`: a wheel notch is `DOM_DELTA_LINE` (three lines), touchpad pixels are `DOM_DELTA_PIXEL` |
| EventControllerKey | keydown, keyup |
| EventControllerFocus | focus, focusin, blur, focusout |
| EventControllerLegacy | the touchscreen: one `PointerEvent` stream per contact (`pointerType: 'touch'`, a distinct `pointerId` per `GdkEventSequence`, `isPrimary` from the pointer-emulating contact) — pointerover/enter/down/move/up/cancel/out/leave, plus the compatibility mouse events and `click` the primary contact owes legacy code, in the order Pointer Events Level 3 prescribes for devices without hover |

`pointerType` is `'mouse'`, `'pen'` or `'touch'` from the GDK device source. Touch movement comes from the raw
event stream because `EventControllerMotion` never fires for a finger, and touch presses never come from
`GestureClick`, which strands its press on multi-finger input. No `TouchEvent`/`TouchList` is emitted — pointer
events carry every field a consumer needs to reconstruct pan and pinch, and `@gjsify/dom-events` has no
`TouchEvent`.

## Design

Two pointer sources, deliberately kept apart. Measured on a OnePlus 6T (postmarketOS, GTK 4.22, mutter 48) with
synthetic touch through `org.gnome.Mutter.RemoteDesktop` and then a real finger (1183 rows):

- `Gtk.EventControllerMotion` emitted **0** `motion` callbacks for a finger, while the raw event stream carried every
  `TOUCH_BEGIN`/`TOUCH_UPDATE`/`TOUCH_END` 1:1 (61 of 61 for a real swipe) at ~8 ms cadence. Touch movement therefore
  comes from `Gtk.EventControllerLegacy`, not from the motion controller.
- `Gtk.GestureClick` strands its press on multi-finger input, and intermittently so: 5 `pressed` / 3 `released` /
  0 `cancel` over the real two-finger gestures, one `released` with `n_press = 0`. Its cause is in GTK's own code:
  a second contact makes the gesture unrecognised and `end` fires with the *second* finger's sequence, which
  `gtk_gesture_click_end` ignores; the first finger's later `TOUCH_END` finds nothing recognised. A touch-sourced
  GestureClick signal (`isTouchEvent(get_current_event())`) is therefore ignored here in every branch — neither
  a missing nor a late `released` can reach the DOM.
- A mouse or pen stays on `EventControllerMotion` + `GestureClick`: widget-local coordinates from the signal, GTK's
  click counting, `pointerType` from `Gdk.InputSource` (`PEN` → `'pen'`, unmeasured here — no stylus).

The touch path (`touch-pointers.ts`, no GTK imports, unit-tested with the frame shapes the adapter extracts):

- **Identity.** `pointerId` is distinct per `GdkEventSequence`. The sequence is an opaque boxed pointer (the Wayland
  backend passes touch slot + 1) with no accessor, and GJS returns a fresh wrapper per call, so `sequenceKey()` reads
  the `native@` address off the wrapper's `toString()`. A runtime that prints something else falls back to the
  emulating-pointer flag — still correct for two contacts — and says so once.
- **`isPrimary`** is `GdkTouchEvent.get_emulating_pointer()`, evaluated only after the source is known to be a
  touchscreen (mouse events read `false` too).
- **Coordinates** come from `Gdk.Event.get_position()` (surface-relative) through `surfaceToWidget()`, the same
  translation gtkmain.c performs before running a controller; nothing on the path rounds (a real digitizer at
  scale 3 reports thirds of a pixel).
- **Cancel.** `TOUCH_CANCEL` → `pointercancel` — a GNOME Mobile edge swipe reaches the client as begin + updates and
  is then cancelled by the shell, fanning `cancel` out to every gesture; the translator ignores the fan-out because
  the contact is already gone. A `GRAB_BROKEN` to a foreign surface cancels every contact (what `GtkGesture` does;
  unmeasured). A `begin` for a contact still active cancels the stale one first, so a lost `TOUCH_END` heals.
- **Compatibility mouse events** follow Pointer Events Level 3 § "Mapping for devices that do not support hover"
  verbatim: `mousemove, pointerover, pointerenter, mouseover, mouseenter, pointerdown, mousedown, [pointermove,
  mousemove]*, pointerup, mouseup, pointerout, pointerleave, mouseout, mouseleave, click`; primary contact only;
  a cancelled primary `pointerdown` suppresses mousedown/mousemove/mouseup but not the transitions or `click`;
  `pointercancel` sends its `mouseup` at the window. `detail` is 1 — GTK's `n_press` was measured untrustworthy on
  touch — so there is no touch `dblclick`.
- **No gesture semantics** (pan, pinch, long-press, tap-vs-stroke) live in the bridge: a consumer rebuilds them from
  the per-contact stream. No `TouchEvent`/`TouchList`: pointer events carry every field needed, `@gjsify/dom-events`
  has no `TouchEvent`, and Excalibur uses pointer events exclusively when `PointerEvent` exists.

Not measured, and not claimed: pen pressure/tilt (no plumbing), `GRAB_BROKEN`, three or more fingers, double-tap
click counts, palm rejection. Pressure is *absent* on 1165 of 1165 real touch rows, so touch reports the spec
constant 0.5 while in contact.

## License

MIT
