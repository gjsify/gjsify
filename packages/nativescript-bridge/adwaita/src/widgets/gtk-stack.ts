// GtkStack — shows one of its children at a time, for NativeScript.
//
// A REAL `GridLayout` with one star cell that all the pages share; the selected page is
// `visible` and the others `collapse`d, which is how `AdwViewStack` swaps pages and is the
// same state machine: the selection (name lookup, the first-visible-page auto-pick, the
// fallbacks when a page is removed or hidden) is `ViewStackState` from `@gjsify/adwaita-core`,
// shared with the web renderer and held by the conformance vectors, and `view-stack-state.ts`
// holds its projection onto `View.visibility`. This class is the wiring and GTK's names.
//
// WHY NOT `AdwViewStack` ITSELF. `Gtk.Stack` is GTK's type and carries no switcher contract:
// no `add_titled_with_icon`, no `selectNthPage`, no badge numbers. Extending the Adw class
// would hand a `Gtk.Stack` those names, which is the vocabulary leak ADR 0034 exists to stop.
//
// `transition-type` and `transition-duration` are accepted, validated and held; the swap is
// instant (`transition-type.ts`). `hhomogeneous` / `vhomogeneous` / `interpolate-size` size
// the stack from its children, and a one-cell grid already sizes to the largest of them.
//
// Reference: refs/gtk gtk/gtkstack.c (GtkStack)
// Copyright (c) The GTK Team. LGPLv2.1+.

import { GridLayout, ItemSpec, type EventData, type View } from '@nativescript/core';

import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { GtkStackPage } from './stack-page.js';
import { StyleClassList, type AdwStyleClassesInput } from './style-classes.js';
import { withSignals } from './signals.js';
import {
    DEFAULT_STACK_TRANSITION_DURATION,
    GTK_STACK_TRANSITIONS,
    transitionNick,
    type GtkStackTransitionNick,
} from './transition-type.js';
import {
    applyViewStackVisibility,
    createViewStackState,
    viewStackNotifyPayload,
    type AdwViewStackPageInfo,
    type ViewStackNotifyPayload,
} from './view-stack-state.js';
import { xmlBoolean, xmlNumber } from './xml-values.js';

/** Event name emitted when the visible child changes. Mirrors GObject `notify::visible-child`. */
export const NOTIFY_STACK_VISIBLE_CHILD = 'notify::visible-child';

/** Mirrors GObject `notify::visible-child-name`; fired together with the one above. */
export const NOTIFY_STACK_VISIBLE_CHILD_NAME = 'notify::visible-child-name';

/** Payload of both events. `index` is `-1` and `name`/`title` are `''` when nothing is selected. */
export interface NotifyStackVisibleChildEventData extends EventData, ViewStackNotifyPayload {}

export class GtkStack extends withSignals(GridLayout) {
    /** The GTK signals this widget emits through `connect` — read by the shared-tree builder (ADR 0093). */
    static readonly emittedSignals: readonly string[] = [NOTIFY_STACK_VISIBLE_CHILD, NOTIFY_STACK_VISIBLE_CHILD_NAME];

    /**
     * No named placement: a stack's XML children are its pages, in order, as GtkBuildable's
     * untyped `<child>` is. An empty list so the builder refuses an authored slot by name.
     */
    static readonly builderSlots: readonly string[] = [];

    private readonly _state = createViewStackState();
    private readonly _classList = new StyleClassList();
    private _transitionType: GtkStackTransitionNick = 'none';
    private _transitionDuration = DEFAULT_STACK_TRANSITION_DURATION;
    private _hhomogeneous = true;
    private _vhomogeneous = true;
    private _interpolateSize = false;

    constructor(props?: ConstructProps<GtkStack>) {
        super();

        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'star'));

        this._state.subscribe((change) => {
            applyViewStackVisibility(this._state);
            const payload = viewStackNotifyPayload(change);
            for (const eventName of [NOTIFY_STACK_VISIBLE_CHILD, NOTIFY_STACK_VISIBLE_CHILD_NAME]) {
                const data: NotifyStackVisibleChildEventData = { eventName, object: this, ...payload };
                this.notify(data);
            }
        });

        applyConstructProps(this, props);
    }

    // --- pages ---

    /** `gtk_stack_add_named` — a page with a name. Returns the page handle. */
    add_named(child: View, name: string | null): AdwViewStackPageInfo {
        return this._add(child, name ?? '');
    }

    /** `gtk_stack_add_titled`. */
    add_titled(child: View, name: string | null, title: string): AdwViewStackPageInfo {
        return this._add(child, name ?? '', title);
    }

    /** `gtk_stack_add_child` — a page with no name. */
    add_child(child: View): AdwViewStackPageInfo {
        return this._add(child, '');
    }

    /**
     * `gtk_stack_remove`. Returns whether anything was removed. A removed visible page leaves
     * the stack showing nothing and emits no event (`gtk_stack_remove` clears the visible
     * child without re-picking).
     */
    remove(child: View): boolean {
        const page = this._state.pages.find((held) => held.content === child);
        if (!page || !this._state.removePage(page.name)) return false;
        this.removeChild(child);
        applyViewStackVisibility(this._state);
        return true;
    }

    /** `gtk_stack_get_child_by_name` — the child of the page called `name`, or `null`. */
    get_child_by_name(name: string): View | null {
        return this._state.pages[this._state.indexOfName(name)]?.content ?? null;
    }

    /**
     * Show or hide a page (`GtkStackPage:visible`). Returns whether the SELECTION moved:
     * hiding the visible page falls back to the next visible one.
     */
    setPageVisible(name: string, visible: boolean): boolean {
        const moved = this._state.setPageVisible(name, visible);
        applyViewStackVisibility(this._state);
        return moved;
    }

    /**
     * An XML child — a {@link GtkStackPage} record adds its child under the record's name and
     * title; any other view is a page with no name (`gtk_stack_buildable_add_child`).
     */
    _addChildFromBuilder(_name: string, view: View | GtkStackPage): void {
        if (!(view instanceof GtkStackPage)) {
            this._add(view, '');
            return;
        }
        const content = view.child;
        if (content === null) {
            // The record adds itself once its child arrives (`_awaitChild` says why). One
            // that never gets a child never becomes a page, as `gtk_stack_add_page` needs one.
            view._awaitChild(this);
            return;
        }
        view._adoptBy(this);
        this._state.addPage({
            name: view.name,
            title: view.title,
            icon: view.iconName,
            content,
            visible: view.visible,
            needsAttention: view.needsAttention,
            useUnderline: view.useUnderline,
        });
        this._place(content);
    }

    // --- selection ---

    /** `Gtk.Stack:visible-child-name` — the visible page's name; `null` for none or an unnamed page. */
    get visibleChildName(): string | null {
        return this._state.visibleName || null;
    }

    set visibleChildName(name: string | null | undefined) {
        this._state.setVisibleName(name);
    }

    /** `Gtk.Stack:visible-child` — the visible page's child, or `null`. */
    get visibleChild(): View | null {
        return this._state.visiblePage?.content ?? null;
    }

    set visibleChild(child: View | null) {
        const at = this._state.pages.findIndex((page) => page.content === child);
        if (at !== -1) this._state.setVisibleIndex(at);
    }

    // --- properties held but not rendered ---

    /** `Gtk.Stack:transition-type` — held and validated, never rendered. */
    get transitionType(): GtkStackTransitionNick {
        return this._transitionType;
    }

    set transitionType(value: GtkStackTransitionNick) {
        this._transitionType = transitionNick(value, GTK_STACK_TRANSITIONS, 'Gtk.StackTransitionType');
    }

    /** `Gtk.Stack:transition-duration`, in ms — held, never rendered. */
    get transitionDuration(): number {
        return this._transitionDuration;
    }

    set transitionDuration(raw: number | string) {
        this._transitionDuration = Math.max(0, xmlNumber(raw, this._transitionDuration));
    }

    /** `Gtk.Stack:hhomogeneous`. */
    get hhomogeneous(): boolean {
        return this._hhomogeneous;
    }

    set hhomogeneous(raw: boolean | string) {
        this._hhomogeneous = xmlBoolean(raw, this._hhomogeneous);
    }

    /** `Gtk.Stack:vhomogeneous`. */
    get vhomogeneous(): boolean {
        return this._vhomogeneous;
    }

    set vhomogeneous(raw: boolean | string) {
        this._vhomogeneous = xmlBoolean(raw, this._vhomogeneous);
    }

    /** `Gtk.Stack:interpolate-size`. */
    get interpolateSize(): boolean {
        return this._interpolateSize;
    }

    set interpolateSize(raw: boolean | string) {
        this._interpolateSize = xmlBoolean(raw, this._interpolateSize);
    }

    // --- style classes ---

    /** `GtkWidget:css-classes`, spelled `styleClasses` (`style-classes.ts`). */
    get styleClasses(): string[] {
        return this._classList.classes;
    }

    set styleClasses(value: AdwStyleClassesInput) {
        this._classList.replace(value);
        this._restyle();
    }

    /** `gtk_widget_add_css_class`. */
    add_css_class(name: string): void {
        this._classList.add(name);
        this._restyle();
    }

    /** `gtk_widget_remove_css_class`. */
    remove_css_class(name: string): void {
        this._classList.remove(name);
        this._restyle();
    }

    /** `gtk_widget_has_css_class`. */
    has_css_class(name: string): boolean {
        return this._classList.has(name);
    }

    /** `gtk_widget_get_css_classes`. */
    get_css_classes(): string[] {
        return this._classList.classes;
    }

    /** `gtk_widget_set_css_classes` — REPLACES the list. */
    set_css_classes(names: readonly string[]): void {
        this._classList.replaceAll(names);
        this._restyle();
    }

    private _restyle(): void {
        this.className = this._classList.className;
    }

    private _add(child: View, name: string, title?: string): AdwViewStackPageInfo {
        const page = this._state.addPage({ name, title, content: child });
        this._place(child);
        return page;
    }

    /** Put a page's view into the one cell and let the selection decide what shows. */
    private _place(content: View): void {
        GridLayout.setColumn(content, 0);
        GridLayout.setRow(content, 0);
        this.addChild(content);
        applyViewStackVisibility(this._state);
    }
}
