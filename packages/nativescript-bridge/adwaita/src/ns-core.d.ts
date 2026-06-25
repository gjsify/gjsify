// Ambient minimal type surface for `@nativescript/core`.
//
// `@nativescript/core` is an OPTIONAL peer dependency: it is only present in a
// real NativeScript app (the runtime that exposes these UI classes), never in
// the gjsify workspace install. To keep `gjsify tsc` green without forcing the
// heavy NS toolchain into the workspace, we declare here the narrow slice of
// `@nativescript/core` this package actually touches. When a consumer installs
// the real `@nativescript/core`, its own (far richer) types take precedence —
// this declaration is only a fallback so the package type-checks standalone.
//
// This is the NativeScript analogue of how `packages/framework/*` lean on the
// generated `@girs/*` types for GNOME classes: we describe the native host API
// surface, we don't reimplement it.

declare module '@nativescript/core' {
    /** Payload shape for NativeScript's `Observable.notify` / event listeners. */
    export interface EventData {
        eventName: string;
        object: Observable;
    }

    /** Base of every NativeScript object — carries the event system. */
    export class Observable {
        /** Subscribe to an event (e.g. `'checkedChange'`, `'notify::active'`). */
        addEventListener(eventName: string, callback: (data: EventData) => void, thisArg?: unknown, once?: boolean): void;
        /** Unsubscribe from an event. */
        removeEventListener(eventName: string, callback?: (data: EventData) => void, thisArg?: unknown): void;
        /** Emit an event to all listeners. */
        notify<T extends EventData>(data: T): void;
        /** Emit a `propertyChange` event (the NS equivalent of GObject `notify::`). */
        notifyPropertyChange(name: string, value: unknown, oldValue?: unknown): void;
        /** Set a property by name (used by the XML builder). */
        set(name: string, value: unknown): void;
        /** Read a property by name. */
        get(name: string): unknown;
    }

    /** Base view — every visual element. */
    export class View extends Observable {
        /** CSS class list applied to this view (space-separated). */
        className: string;
        /** Inline width in DIPs or a percentage string. */
        width: number | string;
        /** Inline height in DIPs or a percentage string. */
        height: number | string;
        /** Horizontal alignment (`'left' | 'center' | 'right' | 'stretch'`). */
        horizontalAlignment: string;
        /** Vertical alignment (`'top' | 'middle' | 'bottom' | 'stretch'`). */
        verticalAlignment: string;
        /** Inline background color (hex string or `Color`). */
        backgroundColor: string;
        /** Inline opacity in [0, 1]. */
        opacity: number;
        /** Visibility (`'visible' | 'hidden' | 'collapse'`). */
        visibility: string;
    }

    /** A view that can hold children. */
    export class LayoutBase extends View {
        addChild(view: View): void;
        /** Insert a child at a specific index (paint/stacking order). */
        insertChild(view: View, atIndex: number): void;
        removeChild(view: View): void;
        getChildAt(index: number): View;
        getChildrenCount(): number;
    }

    /** Vertical/horizontal stack of children — `<StackLayout>`. */
    export class StackLayout extends LayoutBase {
        orientation: 'horizontal' | 'vertical';
    }

    /** A row/column sizing spec for {@link GridLayout}. */
    export class ItemSpec {
        constructor(value: number, type: GridUnitType);
    }

    export type GridUnitType = 'auto' | 'star' | 'pixel';

    /** Grid of children addressed by row/column — `<GridLayout>`. */
    export class GridLayout extends LayoutBase {
        addColumn(itemSpec: ItemSpec): void;
        addRow(itemSpec: ItemSpec): void;
        static setColumn(view: View, value: number): void;
        static setRow(view: View, value: number): void;
        static setColumnSpan(view: View, value: number): void;
        static setRowSpan(view: View, value: number): void;
    }

    /** A text label — `<Label>`. */
    export class Label extends View {
        text: string;
        textWrap: boolean;
    }

    /** A toggle switch — `<Switch>`. */
    export class Switch extends View {
        checked: boolean;
    }

    /** A single-line text input — `<TextField>`. */
    export class TextField extends View {
        text: string;
        /** Placeholder text shown when empty. */
        hint: string;
        /** Mask the input (password fields). */
        secure: boolean;
        /** Whether the field accepts edits. */
        editable: boolean;
    }

    /** A push button — `<Button>`. */
    export class Button extends View {
        text: string;
    }

    /** A scrollable single-child container — `<ScrollView>`. */
    export class ScrollView extends View {
        orientation: 'horizontal' | 'vertical';
        content: View;
        /** Programmatically scroll to a horizontal offset (DIPs). */
        scrollToHorizontalOffset(value: number, animated: boolean): void;
        /** Programmatically scroll to a vertical offset (DIPs). */
        scrollToVerticalOffset(value: number, animated: boolean): void;
        /** Current horizontal scroll offset, in DIPs. */
        readonly horizontalOffset: number;
        /** Current vertical scroll offset, in DIPs. */
        readonly verticalOffset: number;
    }

    /** A single-child container — `<ContentView>`. */
    export class ContentView extends LayoutBase {
        content: View;
    }

    /** A wheel/list picker — `<ListPicker>`. */
    export class ListPicker extends View {
        items: unknown[];
        selectedIndex: number;
    }

    /** A flowing wrap container — `<WrapLayout>`. Children flow to the next line. */
    export class WrapLayout extends LayoutBase {
        orientation: 'horizontal' | 'vertical';
        /** Fixed slot width for each item, in DIPs (optional). */
        itemWidth: number;
        /** Fixed slot height for each item, in DIPs (optional). */
        itemHeight: number;
    }

    /** A layout whose children are positioned by absolute left/top — `<AbsoluteLayout>`. */
    export class AbsoluteLayout extends LayoutBase {
        static setLeft(view: View, value: number): void;
        static setTop(view: View, value: number): void;
        static getLeft(view: View): number;
        static getTop(view: View): number;
    }

    /** A spinning busy indicator — `<ActivityIndicator>`. */
    export class ActivityIndicator extends View {
        /** Whether the indicator spins. */
        busy: boolean;
    }

    /** An image view — `<Image>`. */
    export class Image extends View {
        /** Image source: a URI, `data:` URL, `~/`-relative path, or `res://` resource. */
        src: string;
        /** Stretch mode (`'none' | 'aspectFill' | 'aspectFit' | 'fill'`). */
        stretch: string;
    }

    /** One segment of a {@link SegmentedBar}. */
    export class SegmentedBarItem extends Observable {
        title: string;
    }

    /** A segmented (linked) control — `<SegmentedBar>`. Exactly one item is selected. */
    export class SegmentedBar extends View {
        items: SegmentedBarItem[];
        selectedIndex: number;
    }

    /** Options accepted by the {@link confirm} dialog. */
    export interface ConfirmOptions {
        title?: string;
        message?: string;
        okButtonText?: string;
        cancelButtonText?: string;
        neutralButtonText?: string;
        cancelable?: boolean;
    }

    /**
     * Show a native confirm dialog. Resolves `true` (OK), `false` (cancel), or
     * `undefined` (neutral / dismissed). NativeScript free function.
     */
    export function confirm(options: ConfirmOptions): Promise<boolean | undefined>;

    /** Bitmask of gesture types (only `tap` is used here). */
    export enum GestureTypes {
        tap = 1,
    }

    /** Options accepted by the {@link action} dialog. */
    export interface ActionOptions {
        title?: string;
        message?: string;
        cancelButtonText?: string;
        actions: string[];
        cancelable?: boolean;
    }

    /**
     * Show a native action-sheet / list dialog. Resolves to the tapped action's
     * label (or the cancel-button text). NativeScript free function.
     */
    export function action(options: ActionOptions): Promise<string>;
}
