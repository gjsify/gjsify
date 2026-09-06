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
        addEventListener(
            eventName: string,
            callback: (data: EventData) => void,
            thisArg?: unknown,
            once?: boolean,
        ): void;
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
        /**
         * The LIVE set of classes the CSS engine matches against, rebuilt from
         * `className` on every write (`ui/core/view-base/index.js:1140-1154`), and
         * assigned once in the `ViewBase` constructor (`:226`).
         *
         * Here because it is a NAME A PORT WIDGET MUST NOT TAKE, and nothing said so.
         * ADR 0049 first spelled the style-class list `cssClasses`, which is the GIR
         * name; a subclass accessor under that name shadows the constructor's
         * assignment, so the Set never exists and the first `className` write — the one
         * in `GtkButton`'s own constructor — dies on `cssClasses.has is not a function`.
         * The package could not see it: this slice is an ambient `declare module`, so it
         * WINS over the real `@nativescript/core` even when a consumer installs it
         * (measured), and every widget test drives a pure helper because `extends
         * FlexboxLayout` cannot be imported. Declaring the member is the whole guard —
         * `gjsify tsc` now answers TS2611 on any widget that shadows it.
         */
        readonly cssClasses: Set<string>;
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
        /**
         * Inline padding in DIPs, per edge.
         *
         * A LOCAL value, so it beats whatever the stylesheet says for this view —
         * which is why the window insets are applied here rather than through CSS.
         */
        paddingTop: number;
        paddingBottom: number;
        paddingLeft: number;
        paddingRight: number;
        /**
         * Inline margin in DIPs, per edge — the OUTSIDE of the same box.
         *
         * Here because a real view carries them and this slice is what tells a gate a
         * write is a NativeScript property rather than a dead one: the storybook's
         * shortcut-label grid spaces its rows with `marginBottom`, which read as a write
         * into nothing the moment anything looked.
         */
        marginTop: number;
        marginBottom: number;
        marginLeft: number;
        marginRight: number;
        /** Visibility (`'visible' | 'hidden' | 'collapse'`). */
        visibility: string;
        /** Whether the view responds to touch at all — NS's `gtk_widget_set_can_target`. */
        isUserInteractionEnabled: boolean;
        /** Horizontal translation offset in DIPs (animatable). */
        translateX: number;
        /** Vertical translation offset in DIPs (animatable). */
        translateY: number;
        /** Whether the view is currently loaded / attached to the visual tree.
         *  Off-screen (pre-load) transitions skip animation. */
        readonly isLoaded: boolean;
        /** The view this one is mounted in, or `null` at the root — the walk a
         *  nested widget offers an unhandled action up. */
        readonly parent: View | null;
        /** The `Page` this view is mounted in — `ViewBase.page` walks the parents and
         *  `Page` returns itself — or `null` while it is not mounted in one. */
        readonly page: Page | null;
        /**
         * Android only (`CoreTypes.AndroidOverflow`) — which window-inset edges this
         * view lets its content OVERFLOW instead of paying as padding. `'none'`, which
         * `Page` sets, pays every edge; `'top'` hands the top edge back to whatever is
         * inside. Written by `host-insets.android.ts`; a no-op on other platforms.
         */
        androidOverflowEdge: string;
        /** Accessibility role announced to the platform screen reader —
         *  NS's counterpart to `gtk_widget_class_set_accessible_role`. */
        accessibilityRole: string;
        /** The view's resolved style. `direction` is an INHERITED CSS property
         *  (`ui/styling/style-properties`: `new InheritedCssProperty({ name:
         *  'direction', cssName: 'direction' })`, default null), which is the
         *  text direction `start`/`end` are resolved against. */
        readonly style: { direction?: 'ltr' | 'rtl' | null };
        /** Accessibility state — NS's counterpart to `gtk_accessible_update_state`. */
        accessibilityState: string;
        /** The text a screen reader announces for this view — NS's counterpart
         *  to `gtk_accessible_update_property (…, DESCRIPTION, …)`. */
        accessibilityLabel: string;
        /** Animate one or more properties to their target values. Resolves when the
         *  animation finishes; the returned promise can also be `cancel()`ed. */
        animate(options: AnimationDefinition): AnimationPromise;
        /** Post-layout actual size in DIPs (`{ width, height }`). */
        getActualSize(): { width: number; height: number };
        /** Add a CSS pseudo-class (e.g. `'highlighted'`) and reapply matching
         *  style. NS aliases `highlighted` → `active`/`pressed`. */
        addPseudoClass(name: string): void;
        /** Remove a previously-added CSS pseudo-class and reapply style. */
        deletePseudoClass(name: string): void;
    }

    /** One screen. Declared for the two members `host-insets.android.ts` reaches. */
    export class Page extends View {}

    /** Payload of the `'touch'` gesture — fires repeatedly through a touch. */
    export interface TouchGestureEventData extends EventData {
        /** Touch phase: `'down'` on press, `'move'` while held, `'up'` on release,
         *  `'cancel'` when an ancestor (e.g. a scrolling `ScrollView`) claims the
         *  gesture. */
        action: 'down' | 'up' | 'move' | 'cancel';
        /** X coordinate relative to the view, in DIPs. */
        getX(): number;
        /** Y coordinate relative to the view, in DIPs. */
        getY(): number;
    }

    /** An `(x, y)` pair — a translate/scale animation target. */
    export interface Pair {
        x: number;
        y: number;
    }

    /** An async operation that can be cancelled mid-flight. */
    export interface Cancelable {
        cancel(): void;
    }

    /** A running animation: a `Promise` that is also {@link Cancelable}. */
    export type AnimationPromise = Promise<void> & Cancelable;

    /** The slice of NativeScript's animation definition the Adwaita widgets use. */
    export interface AnimationDefinition {
        target?: View;
        opacity?: number;
        backgroundColor?: string;
        translate?: Pair;
        scale?: Pair;
        width?: number | string;
        height?: number | string;
        rotate?: number;
        duration?: number;
        delay?: number;
        iterations?: number;
        /** Easing curve name — `'ease' | 'easeIn' | 'easeOut' | 'easeInOut' | 'linear' | 'spring'`. */
        curve?: string;
    }

    /** A view that can hold children. */
    export class LayoutBase extends View {
        addChild(view: View): void;
        /** Insert a child at a specific index (paint/stacking order). */
        insertChild(view: View, atIndex: number): void;
        removeChild(view: View): void;
        /** Detach every child at once — `adw_wrap_box_remove_all`'s counterpart. */
        removeChildren(): void;
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
        /** Remove every column definition (lets a layout re-declare its columns,
         *  e.g. to flip the fixed/expanding column for a trailing sidebar). */
        removeColumns(): void;
        /** Remove every row definition — the row counterpart, for a layout whose
         *  row COUNT is data-driven (one row per data-grid line). A child whose
         *  row index exceeds the declared rows is clamped into the last one, so
         *  a shrinking grid has to drop the rows it no longer fills. */
        removeRows(): void;
        static setColumn(view: View, value: number): void;
        static setRow(view: View, value: number): void;
        static setColumnSpan(view: View, value: number): void;
        static setRowSpan(view: View, value: number): void;
    }

    /** A text label — `<Label>`. */
    export class Label extends View {
        text: string;
        textWrap: boolean;
        /** Horizontal text alignment (`'left' | 'center' | 'right' | 'justify' | 'initial'`). */
        textAlignment: string;
    }

    /** A toggle switch — `<Switch>`. */
    export class Switch extends View {
        checked: boolean;
    }

    /** A horizontal slider — `<Slider>`. Fires `'valueChange'` as it moves. */
    export class Slider extends View {
        value: number;
        minValue: number;
        maxValue: number;
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

    /**
     * A flexbox container — `<FlexboxLayout>`. The wrapping container with real
     * main-axis knobs, which is what `Adw.WrapBox` needs and `WrapLayout` (three
     * properties, none of them about distribution) cannot give it.
     */
    export class FlexboxLayout extends LayoutBase {
        flexDirection: 'row' | 'row-reverse' | 'column' | 'column-reverse';
        flexWrap: 'nowrap' | 'wrap' | 'wrap-reverse';
        justifyContent: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around';
        alignItems: 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'stretch';
        alignContent: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'stretch';
        /** Per-child: whether it absorbs a line's leftover space (`justify: fill`). */
        static setFlexGrow(view: View, grow: number): void;
        /** Per-child: whether an overflowing line may squeeze it (`wrap-policy`). */
        static setFlexShrink(view: View, shrink: number): void;
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

    /** A decoded native image (wraps an `android.graphics.Bitmap` / `UIImage`). */
    export class ImageSource {
        /** Wrap a native bitmap/image source (e.g. an `android.graphics.Bitmap`). */
        constructor(nativeSource?: unknown);
        readonly width: number;
        readonly height: number;
    }

    /** An image view — `<Image>`. */
    export class Image extends View {
        /** Image source: a URI, `data:` URL, `~/`-relative path, or `res://` resource. */
        src: string | ImageSource;
        /** A pre-decoded native image source (preferred for in-memory bitmaps). */
        imageSource: ImageSource;
        /** Stretch mode (`'none' | 'aspectFill' | 'aspectFit' | 'fill'`). */
        stretch: string;
    }

    /** A connected display. */
    export interface ScreenMetrics {
        /** Device pixel density (logical→physical scale factor). */
        readonly scale: number;
        readonly widthDIPs: number;
        readonly heightDIPs: number;
    }

    /** Static access to the device's screen(s). */
    export const Screen: { readonly mainScreen: ScreenMetrics };

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

    /** App-level services: the stylesheet, the lifecycle, and the two native hosts. */
    export namespace Application {
        /**
         * Append CSS to the application stylesheet and re-apply style to the live
         * view tree.
         *
         * The ONLY way to change an accent at runtime on this platform: the NS CSS
         * subset has no custom properties, so `theme/adwaita.css` inlines the accent
         * as a literal and there is nothing to reassign. Appended rules come last,
         * which is how an override of equal specificity wins.
         */
        export function addCss(cssText: string, attributeScoped?: boolean): void;

        /** Subscribe to an application lifecycle event (`resume`, `suspend`, …). */
        export function on(event: string, callback: (args: unknown) => void): void;
        /** Drop a subscription made with {@link on}. */
        export function off(event: string, callback: (args: unknown) => void): void;

        /**
         * The Android host, absent on every other platform.
         *
         * Declared only as far as the window-inset source reaches — the Activity, its
         * Window, its decor view — because those are the one place both edges' insets
         * are dispatched. Every hop is optional: `foregroundActivity` is null between
         * activities, and a widget's `loaded` can fire in that window.
         */
        export const android:
            | {
                  readonly foregroundActivity?: AndroidActivityLike | null;
                  readonly startActivity?: AndroidActivityLike | null;
              }
            | undefined;

        /** The iOS host, absent on every other platform. */
        export const ios: unknown | undefined;
    }

    /** As much of `android.app.Activity` as the inset source needs. */
    export interface AndroidActivityLike {
        getWindow?(): AndroidWindowLike | null;
    }

    /** As much of `android.view.Window` as the inset source needs. */
    export interface AndroidWindowLike {
        getDecorView?(): unknown;
    }
}
