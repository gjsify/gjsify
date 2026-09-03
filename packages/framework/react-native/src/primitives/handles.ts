// What a `ref` receives, for the primitives React Native gives an imperative handle.
//
// THE DEFECT THIS CLOSES. `TextInput` is a CLASS in React Native, so it is a value
// AND a type, and its ref carries `focus()`, `blur()`, `clear()`, `isFocused()` and
// `setSelection()` (measured against react-native 0.85.3's own `TextInput.d.ts`:
// three of its own plus `NativeMethods`' six). This layer declared a FUNCTION and
// handed the ref the bare `Gtk.Widget`, so `useRef<TextInput>(null)` did not compile
// and `ref.current?.focus()` was `undefined is not a function` at the call — both
// ordinary React Native code. The props had a table and a named refusal for every
// gap; the ref had neither.
//
// FRAMEWORK-NEUTRAL, and it is L2 for the same reason the descriptors are: React and
// Solid both give a `ref` its value, and a handle built inside one L3 would be a
// vocabulary the other one does not have. The TABLE says which primitives carry a
// handle (`PrimitiveSpec.handle`); this file turns the kind into the object.
//
// NO `gi://` IMPORT, like everything else under `primitives/`. Every call below is a
// method on the widget the host built, so the type is structural: `grab_focus`,
// `get_root`, `set_text`, `select_region` and `get_buffer` are read off the object.
// `widgets.spec.ts` is what stops that being a typo — it asks the real `Gtk.Entry`
// and `Gtk.TextView` GTypes whether each name is there, exactly as it does for every
// property the prop table routes to.
//
// WHAT IS REFUSED AND WHY IT IS REFUSED BY NAME. `NativeMethods` also carries
// `measure`, `measureInWindow`, `measureLayout` and `setNativeProps`. Each one throws
// a `PrimitiveError` naming itself rather than being absent, because an absent method
// is the `undefined is not a function` this file exists to remove — a reader gets the
// reason and the way round instead.

import { PrimitiveError } from './errors.js';
import type { HandleKind } from './table.js';

/** What every widget a handle wraps answers, whichever primitive it belongs to. */
interface FocusableWidget {
    grab_focus(): boolean;
    is_focus(): boolean;
    get_root(): { get_focus(): unknown; set_focus(widget: unknown): void } | null;
}

/** `Gtk.Entry` — its content is the `Gtk.Editable` half. */
interface EntryWidget extends FocusableWidget {
    set_text(text: string): void;
    select_region(start: number, end: number): void;
}

/** `Gtk.TextView` — its content lives in a buffer, which is why `value` is refused on it. */
interface TextViewWidget extends FocusableWidget {
    get_buffer(): TextBuffer;
}

interface TextBuffer {
    set_text(text: string, length: number): void;
    get_iter_at_offset(offset: number): unknown;
    select_range(insert: unknown, bound: unknown): void;
}

/**
 * The imperative handle a `<TextInput ref>` receives.
 *
 * React Native's own member list, with every one of them answered — five over GTK
 * and four refused by name. `widget` is the one addition, and it is not decoration:
 * the ref used to BE the widget, so a port that already reached for `Gtk.Entry` API
 * through it keeps working by spelling `ref.current.widget` — and it is also the way
 * out of every refusal below.
 */
export interface TextInputHandle {
    /** `Gtk.Widget.grab_focus()`. */
    focus(): void;
    /**
     * Give up the focus — `Gtk.Root.set_focus(null)`, and ONLY when this widget holds it.
     *
     * The guard is the whole of the correctness here: `set_focus(null)` unsets the
     * root's focus widget whoever it is, so an unguarded `blur()` on an unfocused
     * input would take the focus away from whatever really had it.
     */
    blur(): void;
    /** Remove all text. `Gtk.Editable.set_text('')`, or the buffer's own for a multiline input. */
    clear(): void;
    /**
     * Is this the widget its root delivers keys to?
     *
     * `Gtk.Widget.is_focus()` and NOT `has-focus`: the latter is the GLOBAL input
     * focus and is false whenever the window is not the compositor's active one
     * (MEASURED on gtk 4.22.4 — a mapped, presented window that the compositor never
     * activated reports `has_focus` false for the widget `grab_focus()` just
     * returned true for). React Native's `isFocused()` is the per-application
     * question, which is `is_focus()`.
     */
    isFocused(): boolean;
    /** `Gtk.Editable.select_region(start, end)`, or `Gtk.TextBuffer.select_range` for a multiline input. */
    setSelection(start: number, end: number): void;
    /** The `Gtk.Entry` or `Gtk.TextView` itself — everything this handle does not answer. */
    readonly widget: unknown;
    /** Refused by name. GTK measures on allocation; see the message. */
    measure(callback: unknown): never;
    /** Refused by name — see `measure`. */
    measureInWindow(callback: unknown): never;
    /** Refused by name — see `measure`. */
    measureLayout(relativeTo: unknown, onSuccess: unknown, onFail?: unknown): never;
    /** Refused by name: the widget is right here, and every GTK property is settable on it. */
    setNativeProps(props: object): never;
}

const NO_MEASURE =
    'reports a laid-out geometry, and GTK only has one after the widget has been allocated inside a window that is presented — before that every number is zero, which is indistinguishable from a real measurement of an empty widget. GTK’s counterpart is `Gtk.Widget.compute_bounds(target)`, a synchronous read rather than React Native’s callback, so wrapping it here would promise an ordering this layer cannot keep. Call it on `ref.current.widget` at a moment you know the widget is mapped';

const NO_NATIVE_PROPS =
    'is React Native’s escape hatch for writing straight to a native view, and there is nothing here for it to escape: `ref.current.widget` IS the `Gtk.Entry`/`Gtk.TextView`, and every GTK property is settable on it by its own name. A second spelling that took React Native prop names would be a second prop table beside `primitives/table.ts`';

const refuse = (member: string, why: string): never => {
    throw new PrimitiveError('TextInput', `ref.${member}()`, why);
};

/**
 * `Gtk.Entry` or `Gtk.TextView` — decided by the TAG, never by probing the widget.
 *
 * A probe (`typeof widget.set_text === 'function'`) is the paranoid shape this repo
 * measures as a bug source: it turns "this layer resolved the wrong widget" into a
 * silent no-op. The plan already knows which widget it built.
 */
function textInputHandle(widget: FocusableWidget, tag: string): TextInputHandle {
    const multiline = tag === 'GtkTextView';
    const buffer = (): TextBuffer => (widget as TextViewWidget).get_buffer();
    const entry = (): EntryWidget => widget as EntryWidget;
    return {
        widget,
        focus: () => void widget.grab_focus(),
        blur: () => {
            const root = widget.get_root();
            // `get_focus() === widget` and not `is_focus()`, which asks the same
            // question one call further away: the root is needed for the write
            // anyway, so asking it directly is one lookup instead of two.
            if (root !== null && root.get_focus() === widget) root.set_focus(null);
        },
        clear: () => {
            if (multiline) buffer().set_text('', 0);
            else entry().set_text('');
        },
        isFocused: () => widget.is_focus(),
        setSelection: (start, end) => {
            if (multiline) {
                const target = buffer();
                target.select_range(target.get_iter_at_offset(start), target.get_iter_at_offset(end));
            } else {
                entry().select_region(start, end);
            }
        },
        measure: () => refuse('measure', NO_MEASURE),
        measureInWindow: () => refuse('measureInWindow', NO_MEASURE),
        measureLayout: () => refuse('measureLayout', NO_MEASURE),
        setNativeProps: () => refuse('setNativeProps', NO_NATIVE_PROPS),
    };
}

/**
 * The handle a plan asks for, or the widget itself.
 *
 * `null` for `kind` is the ordinary case and is not an omission: React Native gives
 * an imperative handle only to the components that document one, and every other
 * primitive here hands a `ref` the `Gtk.Widget` — which is what it did before this
 * file existed and what a port that reaches for GTK API relies on.
 */
export function createHandle(kind: HandleKind | null, widget: unknown, tag: string): unknown {
    if (kind === null) return widget;
    return textInputHandle(widget as FocusableWidget, tag);
}
