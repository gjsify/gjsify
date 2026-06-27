// Ambient minimal type surface for `@nativescript/core`.
//
// `@nativescript/core` is an OPTIONAL peer dependency: it is only present in a
// real NativeScript app (the runtime that exposes these UI classes), never in
// the gjsify workspace install. To keep `gjsify tsc` green without forcing the
// heavy NS toolchain into the workspace, we declare here the narrow slice of
// `@nativescript/core` this package actually touches — a SUPERSET of the slice
// `@gjsify/adwaita-nativescript` declares (it ships its own `ns-core.d.ts`),
// plus the page/navigation/list classes the storybook app shell needs. When a
// consumer installs the real `@nativescript/core`, its own (far richer) types
// take precedence — this declaration is only a fallback so the package
// type-checks standalone.
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
        /** Walk every child view (used by the devtools tree dumper / cleanup). */
        eachChildView(callback: (child: View) => boolean): void;
    }

    /** A view that can hold children. */
    export class LayoutBase extends View {
        addChild(view: View): void;
        removeChild(view: View): void;
        getChildAt(index: number): View;
        getChildrenCount(): number;
        removeChildren(): void;
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
    }

    /** A single-child container — `<ContentView>`. */
    export class ContentView extends LayoutBase {
        content: View;
    }

    /** Metrics of a connected display. */
    export interface ScreenMetrics {
        /** Device pixel density (logical→physical scale factor). */
        readonly scale: number;
        /** Logical (density-independent) screen width. */
        readonly widthDIPs: number;
        /** Logical (density-independent) screen height. */
        readonly heightDIPs: number;
    }

    /** Static access to the device's screen(s) — used to seed the responsive
     *  layout mode before the first layout pass. */
    export const Screen: { readonly mainScreen: ScreenMetrics };

    /** A wheel/list picker — `<ListPicker>`. */
    export class ListPicker extends View {
        items: unknown[];
        selectedIndex: number;
    }

    /** Bitmask of gesture types (only `tap` is used here). */
    export enum GestureTypes {
        tap = 1,
    }

    /** Event payload delivered to a `tap` gesture handler. */
    export interface GestureEventData extends EventData {
        view: View;
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

    // --- App-shell classes (the storybook screen layout) ---

    /** The host frame that drives page navigation — `<Frame>`. */
    export class Frame extends View {
        navigate(entry: NavigationEntry | string): void;
        canGoBack(): boolean;
        goBack(): void;
        static topmost(): Frame;
    }

    /** A single navigable screen — `<Page>`. */
    export class Page extends ContentView {
        actionBar: ActionBar;
        /** Bound navigation context handed in via `Frame.navigate({ context })`. */
        bindingContext: unknown;
        frame: Frame;
    }

    /** The top app bar of a {@link Page} — `<ActionBar>`. */
    export class ActionBar extends View {
        title: string;
        titleView: View;
        actionItems: ActionItems;
        addChild(view: View): void;
    }

    /** Collection of {@link ActionBar} action items. */
    export class ActionItems {
        addItem(item: ActionItem): void;
        removeItem(item: ActionItem): void;
        getItems(): ActionItem[];
    }

    /** A single action-bar button — `<ActionItem>`. */
    export class ActionItem extends View {
        text: string;
        icon: string;
        ios: { position: string; systemIcon?: number };
        android: { position: string; systemIcon?: string };
    }

    /** A virtualised vertical list — `<ListView>`. */
    export class ListView extends View {
        items: unknown[];
        itemTemplate: unknown;
        refresh(): void;
    }

    /** Payload delivered to a `<ListView>` `itemTap` handler. */
    export interface ItemEventData extends EventData {
        index: number;
        view: View;
    }

    /** A description of a navigation target for {@link Frame.navigate}. */
    export interface NavigationEntry {
        moduleName?: string;
        create?: () => Page;
        context?: unknown;
        clearHistory?: boolean;
        animated?: boolean;
    }

    /** Payload delivered to a page's `navigatedTo` / `navigatingTo` handler. */
    export interface NavigatedData extends EventData {
        context: unknown;
        isBackNavigation: boolean;
    }

    /** The global application object. */
    export class Application {
        static run(entry: { create: () => View } | { moduleName: string }): void;
        static getRootView(): View;
    }

    /** Color wrapper (hex / rgba). */
    export class Color {
        constructor(value: string);
        hex: string;
    }
}
