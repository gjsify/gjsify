// A RUNTIME DOUBLE OF THE NATIVESCRIPT PLATFORM, so this port's widget classes can be
// constructed off a device — the one thing that stood between the corpus of ADR 0051 and a
// driver on this surface.
//
// WHAT THE OBSTACLE ACTUALLY IS. Every widget module here opens with a value import from
// `@nativescript/core` because each class EXTENDS an NS view, and that package ships no
// platform-neutral module for one: `ui/label/`, `ui/core/view/` and `ui/layouts/grid-layout/`
// each hold `index.android.js`, `index.ios.js` and a `*-common.js`, and no `index.js`.
// Choosing between the two flavours is NativeScript's own platform-aware resolution, not
// Node's and not a bundler's. So `class AdwBanner extends GridLayout` has no base class in
// any runtime that is not a device — which is why every spec in this package drives a pure
// sibling instead, and why ADR 0051 § Amendment 1 withdrew the NativeScript tree driver.
//
// WHY A DOUBLE IS NOT A SECOND IMPLEMENTATION OF ANYTHING. The package ALREADY carries a
// hand-written contract with that platform: `src/ns-core.d.ts`, an ambient `declare module
// '@nativescript/core'` holding the narrow slice these widgets touch, which `gjsify tsc`
// holds every widget against on every run — and which WINS over the real package even when a
// consumer installs it. This file is the runtime half of that declaration: it implements the
// part of that slice the port REACHES off a device, so the port's own composition can run.
//
// WHAT HOLDS THE TWO TOGETHER is the bundler, and it is worth knowing which half it holds.
// `--alias @nativescript/core=…` makes every widget's bare import resolve HERE, so a name the
// port imports that this file does not export fails the build — measured, by renaming
// `Button` away: rolldown answers `MISSING_EXPORT "Button" is not exported by ns-core.mts`,
// exit 1, no bundle. That is the reachable slice held exactly. The other direction is not
// held by anything: `ListPicker` and `Screen` are in the `.d.ts` and deliberately absent
// here, because the only modules importing them are `*.android.ts` / `*.ios.ts`, which no
// off-device bundle resolves. If one of them ever moves into a platform-neutral module the
// build will say so on the next run.
//
// WHAT IT IS NOT, and the driver's header says this again where a reader of the result will
// look: it is not a device and it is not a measurement of NativeScript. It carries no layout
// pass, no CSS engine, no native view, no animation clock. What it makes measurable is the
// port's OWN tree — which widget it builds, whether a child reaches the tree at all and in
// which order, which value survives the setter it went through. It does NOT make WHICH SLOT
// a child landed in measurable, and the driver's header carries the two mutations that
// establish that. Anything whose answer belongs to Android or iOS (a rasterised icon, a
// dialog, a measured size) is either absent here or answers the same null the
// unsupported-platform module already answers off-device.
//
// Reference: @nativescript/core 9.1.x — ui/core/view-base, ui/core/view, ui/layouts/*.
// Copyright (c) NativeScript contributors. Apache-2.0. Reimplemented, not copied.

/** Payload shape for `Observable.notify` and every event listener. */
export interface EventData {
    eventName: string;
    object: Observable;
    [key: string]: unknown;
}

type Listener = (data: EventData) => void;

/**
 * The event system every NativeScript object carries.
 *
 * Listeners are kept in a module-level `WeakMap` rather than an instance field, for the
 * reason `widgets/signals.ts` gives for the same choice: an own property here is a name a
 * widget could collide with, and it would show up in the key set the construct-props bag
 * derives from a class's members.
 */
const LISTENERS = new WeakMap<object, Map<string, Listener[]>>();

const listenersOf = (target: object): Map<string, Listener[]> => {
    let map = LISTENERS.get(target);
    if (map === undefined) {
        map = new Map();
        LISTENERS.set(target, map);
    }
    return map;
};

export class Observable {
    addEventListener(eventName: string, callback: Listener): void {
        const map = listenersOf(this);
        const existing = map.get(eventName);
        if (existing === undefined) map.set(eventName, [callback]);
        else existing.push(callback);
    }

    removeEventListener(eventName: string, callback?: Listener): void {
        const map = listenersOf(this);
        if (callback === undefined) {
            map.delete(eventName);
            return;
        }
        const existing = map.get(eventName);
        if (existing === undefined) return;
        const at = existing.indexOf(callback);
        if (at !== -1) existing.splice(at, 1);
    }

    notify<T extends EventData>(data: T): void {
        // Over a COPY, because a listener may disconnect itself — `widgets/signals.ts`'s
        // `disconnect` does exactly that, and splicing the live array under the loop would
        // skip the listener after it.
        const listeners = listenersOf(this).get(data.eventName)?.slice();
        if (listeners === undefined) return;
        for (const listener of listeners) listener(data);
    }

    notifyPropertyChange(name: string, value: unknown, oldValue?: unknown): void {
        this.notify({ eventName: `${name}Change`, object: this, propertyName: name, value, oldValue });
    }

    _emit(eventName: string): void {
        this.notify({ eventName, object: this });
    }

    set(name: string, value: unknown): void {
        (this as unknown as Record<string, unknown>)[name] = value;
    }

    get(name: string): unknown {
        return (this as unknown as Record<string, unknown>)[name];
    }
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
    curve?: string;
}

/** The payload of the `'touch'` gesture. */
export interface TouchGestureEventData extends EventData {
    action: 'down' | 'up' | 'move' | 'cancel';
    getX(): number;
    getY(): number;
}

/** Parent links, written by {@link LayoutBase} and read back through {@link View.parent}. */
const PARENTS = new WeakMap<object, View>();

export class View extends Observable {
    private _className = '';
    /**
     * The live class set the CSS engine matches against, rebuilt from `className` on every
     * write. Reproduced because it is a name a port widget must NOT take: ADR 0049 first
     * spelled the style-class list `cssClasses`, and the shadowing accessor left the Set
     * missing so the first `className` write died inside a constructor.
     */
    readonly cssClasses: Set<string> = new Set();
    width: number | string = 'auto';
    height: number | string = 'auto';
    horizontalAlignment = 'stretch';
    verticalAlignment = 'stretch';
    backgroundColor = '';
    opacity = 1;
    paddingTop = 0;
    paddingBottom = 0;
    paddingLeft = 0;
    paddingRight = 0;
    marginTop = 0;
    marginBottom = 0;
    marginLeft = 0;
    marginRight = 0;
    /** `'visible' | 'hidden' | 'collapse'` — NativeScript's own default is `'visible'`. */
    visibility = 'visible';
    isUserInteractionEnabled = true;
    translateX = 0;
    translateY = 0;
    /** Never loaded here: nothing mounts a view into a page without a platform. */
    readonly isLoaded: boolean = false;
    androidOverflowEdge = 'none';
    accessibilityRole = '';
    accessibilityState = '';
    accessibilityLabel = '';
    readonly style: { direction?: 'ltr' | 'rtl' | null } = { direction: null };
    /** The pseudo-classes `attachRowPressFeedback` toggles — observable, not styled. */
    readonly pseudoClasses: Set<string> = new Set();

    get className(): string {
        return this._className;
    }

    set className(value: string) {
        this._className = value ?? '';
        this.cssClasses.clear();
        for (const token of this._className.split(/\s+/)) if (token !== '') this.cssClasses.add(token);
    }

    get parent(): View | null {
        return PARENTS.get(this) ?? null;
    }

    /** No page exists without a platform, and nothing in the corpus asks for one. */
    get page(): View | null {
        return null;
    }

    /**
     * Resolves immediately and animates nothing.
     *
     * There is no clock and no compositor here, so the honest answer is that the END STATE
     * is reached at once — which is what the widgets that animate a reveal already fall back
     * to when the CSS subset cannot express one.
     */
    animate(_options: AnimationDefinition): AnimationPromise {
        const promise = Promise.resolve() as AnimationPromise;
        promise.cancel = () => {};
        return promise;
    }

    /** No layout pass ran, so there is no size to report. */
    getActualSize(): { width: number; height: number } {
        return { width: 0, height: 0 };
    }

    addPseudoClass(name: string): void {
        this.pseudoClasses.add(name);
    }

    deletePseudoClass(name: string): void {
        this.pseudoClasses.delete(name);
    }
}

/** One screen. Declared because the ambient slice declares it; nothing here builds one. */
export class Page extends View {}

export class LayoutBase extends View {
    private readonly _childViews: View[] = [];

    /**
     * THE THREE REFUSALS `ViewBase._addView` MAKES, reproduced rather than simplified away.
     *
     * An insertion path that cannot fail is the failure mode a double HAS: every placement
     * mistake then builds a tree, here, and only a device would ever say otherwise. Upstream
     * throws on a falsy child, on a non-view, and — the one that matters — on a child that
     * ALREADY HAS A PARENT (`ui/core/view-base/index.ts`: "View already has a parent"),
     * because a view lives in exactly one native hierarchy. A port that parents a view twice
     * ships a tree no device can hold, and without this it composes it quietly.
     */
    private _adopt(view: View): void {
        if (!view) throw new Error('Expecting a valid View instance.');
        if (!(view instanceof View)) throw new Error(`${String(view)} is not a valid View instance.`);
        const parent = PARENTS.get(view);
        if (parent !== undefined) {
            throw new Error(
                `View already has a parent. View: ${view.constructor.name} Parent: ${parent.constructor.name}`,
            );
        }
        PARENTS.set(view, this);
    }

    addChild(view: View): void {
        this._adopt(view);
        this._childViews.push(view);
    }

    insertChild(view: View, atIndex: number): void {
        this._adopt(view);
        this._childViews.splice(atIndex, 0, view);
    }

    /** `_removeView` refuses a view that is not this parent's; a silent no-op would hide it. */
    removeChild(view: View): void {
        if (PARENTS.get(view) !== this) {
            throw new Error(`View not added to this instance. View: ${view?.constructor.name}`);
        }
        this._childViews.splice(this._childViews.indexOf(view), 1);
        PARENTS.delete(view);
    }

    removeChildren(): void {
        for (const view of this._childViews) PARENTS.delete(view);
        this._childViews.length = 0;
    }

    getChildAt(index: number): View {
        return this._childViews[index];
    }

    getChildrenCount(): number {
        return this._childViews.length;
    }

    /**
     * THE INHERITED XML-CHILD DOOR, and the reason this class is worth doubling at all.
     *
     * `LayoutBaseCommon._addChildFromBuilder(name, view)` IGNORES `name` and calls
     * `addChild` — which drops a template's child into the composed widget's first cell
     * instead of into the slot it asked for. Every placement rule in this package is an
     * override of exactly this method (`widgets/builder-slots.ts`), so a double that
     * quietly did something smarter here would test the driver's manners rather than the
     * port's.
     */
    _addChildFromBuilder(_name: string, view: View): void {
        this.addChild(view);
    }
}

export class StackLayout extends LayoutBase {
    orientation: 'horizontal' | 'vertical' = 'vertical';
}

export type GridUnitType = 'auto' | 'star' | 'pixel';

export class ItemSpec {
    constructor(
        readonly value: number,
        readonly gridUnitType: GridUnitType,
    ) {}
}

/** Per-child grid placement — an own property on a widget is a name it could collide with. */
const GRID_PLACEMENT = new WeakMap<object, { row: number; column: number; rowSpan: number; columnSpan: number }>();

const placementOf = (view: View) => {
    let placement = GRID_PLACEMENT.get(view);
    if (placement === undefined) {
        placement = { row: 0, column: 0, rowSpan: 1, columnSpan: 1 };
        GRID_PLACEMENT.set(view, placement);
    }
    return placement;
};

export class GridLayout extends LayoutBase {
    protected _rows: ItemSpec[] = [];
    protected _columns: ItemSpec[] = [];

    addColumn(itemSpec: ItemSpec): void {
        this._columns.push(itemSpec);
    }

    addRow(itemSpec: ItemSpec): void {
        this._rows.push(itemSpec);
    }

    removeRow(itemSpec: ItemSpec): void {
        const at = this._rows.indexOf(itemSpec);
        if (at !== -1) this._rows.splice(at, 1);
    }

    removeColumns(): void {
        this._columns.length = 0;
    }

    removeRows(): void {
        this._rows.length = 0;
    }

    /** Where a child was placed — the read-back the `set*` statics have on a device. */
    static placementOf(view: View): { row: number; column: number; rowSpan: number; columnSpan: number } {
        return { ...placementOf(view) };
    }

    static setColumn(view: View, value: number): void {
        placementOf(view).column = value;
    }

    static setRow(view: View, value: number): void {
        placementOf(view).row = value;
    }

    static setColumnSpan(view: View, value: number): void {
        placementOf(view).columnSpan = value;
    }

    static setRowSpan(view: View, value: number): void {
        placementOf(view).rowSpan = value;
    }
}

export class Label extends View {
    text = '';
    textWrap = false;
    textAlignment = 'initial';
}

export class Switch extends View {
    private _checked = false;

    get checked(): boolean {
        return this._checked;
    }

    /**
     * A write fires `checkedChange`, as the platform's own property does for a
     * PROGRAMMATIC write and not only for a drag — which is the re-entry `AdwSwitchRow`'s
     * single funnel exists to stop. A double that only fired on a gesture would leave that
     * funnel untested and the row green by absence.
     */
    set checked(value: boolean) {
        if (this._checked === value) return;
        this._checked = value;
        this.notify({ eventName: 'checkedChange', object: this, value });
    }
}

export class Slider extends View {
    value = 0;
    minValue = 0;
    maxValue = 100;
}

export class TextField extends View {
    private _text = '';
    hint = '';
    secure = false;
    editable = true;

    get text(): string {
        return this._text;
    }

    /** `textChange` for a programmatic write too — same reasoning as `Switch.checked`. */
    set text(value: string) {
        if (this._text === value) return;
        this._text = value;
        this.notify({ eventName: 'textChange', object: this, value });
    }
}

export class Button extends View {
    text = '';
}

export class ScrollView extends View {
    orientation: 'horizontal' | 'vertical' = 'vertical';
    content: View = null;
    readonly horizontalOffset: number = 0;
    readonly verticalOffset: number = 0;

    scrollToHorizontalOffset(_value: number, _animated: boolean): void {}

    scrollToVerticalOffset(_value: number, _animated: boolean): void {}
}

export class ContentView extends LayoutBase {
    content: View = null;
}

export class WrapLayout extends LayoutBase {
    orientation: 'horizontal' | 'vertical' = 'horizontal';
    itemWidth = 0;
    itemHeight = 0;
}

/** Per-child flex hints — same WeakMap reasoning as the grid placement above. */
const FLEX_CHILD = new WeakMap<object, { grow: number; shrink: number }>();

const flexOf = (view: View) => {
    let flex = FLEX_CHILD.get(view);
    if (flex === undefined) {
        flex = { grow: 0, shrink: 1 };
        FLEX_CHILD.set(view, flex);
    }
    return flex;
};

export class FlexboxLayout extends LayoutBase {
    flexDirection: 'row' | 'row-reverse' | 'column' | 'column-reverse' = 'row';
    flexWrap: 'nowrap' | 'wrap' | 'wrap-reverse' = 'nowrap';
    justifyContent: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' = 'flex-start';
    alignItems: 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'stretch' = 'stretch';
    alignContent: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'stretch' = 'stretch';

    static setFlexGrow(view: View, grow: number): void {
        flexOf(view).grow = grow;
    }

    static setFlexShrink(view: View, shrink: number): void {
        flexOf(view).shrink = shrink;
    }
}

export class AbsoluteLayout extends LayoutBase {
    private static readonly _left = new WeakMap<object, number>();
    private static readonly _top = new WeakMap<object, number>();

    static setLeft(view: View, value: number): void {
        AbsoluteLayout._left.set(view, value);
    }

    static setTop(view: View, value: number): void {
        AbsoluteLayout._top.set(view, value);
    }

    static getLeft(view: View): number {
        return AbsoluteLayout._left.get(view) ?? 0;
    }

    static getTop(view: View): number {
        return AbsoluteLayout._top.get(view) ?? 0;
    }
}

export class ActivityIndicator extends View {
    busy = false;
}

/**
 * A decoded native image.
 *
 * Constructible and inert: the only producer on this surface is `renderSymbolicIcon`, whose
 * platform-neutral module already returns `null` off a device, so nothing here ever holds a
 * bitmap. Its dimensions are zero for the same reason `getActualSize` reports zero.
 */
export class ImageSource {
    readonly width: number = 0;
    readonly height: number = 0;

    constructor(readonly nativeSource?: unknown) {}
}

export class Image extends View {
    src: string | ImageSource = '';
    imageSource: ImageSource = null;
    stretch = 'aspectFit';
}

export class SegmentedBarItem extends Observable {
    title = '';
}

export class SegmentedBar extends View {
    items: SegmentedBarItem[] = [];
    selectedIndex = 0;
}

export enum GestureTypes {
    tap = 1,
}

export interface ConfirmOptions {
    title?: string;
    message?: string;
    okButtonText?: string;
    cancelButtonText?: string;
    neutralButtonText?: string;
    cancelable?: boolean;
}

export interface ActionOptions {
    title?: string;
    message?: string;
    cancelButtonText?: string;
    actions: string[];
    cancelable?: boolean;
}

/**
 * The two dialog functions REFUSE rather than resolve.
 *
 * A native dialog is the one thing on this list whose answer belongs to the user and to the
 * platform. Resolving a default would let a suite assert a choice nobody made, so a caller
 * that reaches one off a device is told so instead — the same refusal `applyConstructProps`
 * makes for a key nothing declares, and for the same reason.
 */
const noDialog = (name: string): never => {
    throw new Error(
        `${name}() needs a native dialog, which this platform double does not have. A flow that reaches one ` +
            'cannot be measured off a device; drive the widget that raises it instead.',
    );
};

export function confirm(_options: ConfirmOptions): Promise<boolean | undefined> {
    return noDialog('confirm');
}

export function action(_options: ActionOptions): Promise<string> {
    return noDialog('action');
}

/** Every stylesheet fragment {@link Application.addCss} was handed, newest last. */
const APPLIED_CSS: string[] = [];

export namespace Application {
    export function addCss(cssText: string, _attributeScoped?: boolean): void {
        APPLIED_CSS.push(cssText);
    }

    /** What the accent layer appended — the read-back a device gives through the engine. */
    export function appliedCss(): readonly string[] {
        return [...APPLIED_CSS];
    }

    const LIFECYCLE = new Map<string, ((args: unknown) => void)[]>();

    export function on(event: string, callback: (args: unknown) => void): void {
        const existing = LIFECYCLE.get(event);
        if (existing === undefined) LIFECYCLE.set(event, [callback]);
        else existing.push(callback);
    }

    export function off(event: string, callback: (args: unknown) => void): void {
        const existing = LIFECYCLE.get(event);
        if (existing === undefined) return;
        const at = existing.indexOf(callback);
        if (at !== -1) existing.splice(at, 1);
    }

    /** Absent, as on every platform that is not Android — and this is not Android. */
    export const android: undefined = undefined;
    /** Absent, as on every platform that is not iOS — and this is not iOS. */
    export const ios: undefined = undefined;
}
