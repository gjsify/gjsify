// AdwViewStackPage — the page record an `Adw.ViewStack` is AUTHORED with, for NativeScript.
//
// NOT A VIEW, AS UPSTREAM. `AdwViewStackPage` descends from `GObject.Object`: it carries a
// page's `name`, `title`, `icon-name` and badge state beside the `child` that is the page, and
// the stack adopts the child and keeps the record. A Blueprint spells a titled stack with it —
// `Adw.ViewStack { Adw.ViewStackPage { name: "inbox"; title: _("Inbox"); child: … } }` — and
// this port had no class for it, so the shared-tree builder refused every such `.blp` and the
// gallery's view-switcher blocks could not be built from one file. The imperative door
// (`add_titled_with_icon`) was there; the declarative one was not.
//
// IT IS READ WHEN THE STACK ADOPTS IT. `AdwViewStack._addChildFromBuilder` takes the record's
// values and its child into the stack's headless page list (`ViewStackState`), which is what
// a bound switcher reads. The port's stack has no per-page change notification beyond
// `visible`, so after adoption `visible` is forwarded and every other write is REFUSED — a
// title changed on a record the stack no longer reads would be a silent no-op, and the
// switcher would keep showing the old one.
//
// Reference: refs/libadwaita/src/adw-view-stack.c (AdwViewStackPage, adw_view_stack_add_child)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Observable, type View } from '@nativescript/core';

import { builderSlotsOf } from './builder-slots.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { withSignals } from './signals.js';
import { xmlBoolean, xmlNumber } from './xml-values.js';

/** The one stack call a record needs once adopted — `AdwViewStack.setPageVisible`. */
interface AdoptingStack {
    setPageVisible(name: string, visible: boolean): boolean;
}

export class AdwViewStackPage extends withSignals(Observable) {
    /** `child:` in a `.blp` — the page itself. The fallback too: a bare child IS the page. */
    static readonly builderSlots: readonly string[] = builderSlotsOf(['child'], 'child');

    private _child: View | null = null;
    private _name = '';
    private _title: string | null = null;
    private _iconName: string | null = null;
    private _needsAttention = false;
    private _badgeNumber = 0;
    private _visible = true;
    private _useUnderline = false;
    /** The stack that adopted this record, or `null` while it is still being authored. */
    private _stack: AdoptingStack | null = null;

    constructor(props?: ConstructProps<AdwViewStackPage>) {
        super();
        applyConstructProps(this, props);
    }

    /** `AdwViewStackPage:child` — the view the stack shows for this page. */
    get child(): View | null {
        return this._child;
    }

    set child(view: View | null) {
        this._refuseAfterAdoption('child');
        this._child = view;
    }

    /** `AdwViewStackPage:name` — what `visible-child-name` and a bound switcher select by. */
    get name(): string {
        return this._name;
    }

    set name(value: string | null) {
        this._refuseAfterAdoption('name');
        this._name = value ?? '';
    }

    /** `AdwViewStackPage:title` — `null` until written; the stack falls back to the name. */
    get title(): string | null {
        return this._title;
    }

    set title(value: string | null) {
        this._refuseAfterAdoption('title');
        this._title = value;
    }

    /** `AdwViewStackPage:icon-name`. */
    get iconName(): string | null {
        return this._iconName;
    }

    set iconName(value: string | null) {
        this._refuseAfterAdoption('iconName');
        this._iconName = value;
    }

    /** `AdwViewStackPage:needs-attention` — the dot a switcher draws beside the title. */
    get needsAttention(): boolean {
        return this._needsAttention;
    }

    set needsAttention(raw: boolean | string) {
        this._refuseAfterAdoption('needsAttention');
        this._needsAttention = xmlBoolean(raw, this._needsAttention);
    }

    /** `AdwViewStackPage:badge-number` — `0` shows no badge. */
    get badgeNumber(): number {
        return this._badgeNumber;
    }

    set badgeNumber(raw: number | string) {
        this._refuseAfterAdoption('badgeNumber');
        this._badgeNumber = xmlNumber(raw, this._badgeNumber);
    }

    /** `AdwViewStackPage:use-underline` — whether an `_` in the title marks a mnemonic. */
    get useUnderline(): boolean {
        return this._useUnderline;
    }

    set useUnderline(raw: boolean | string) {
        this._refuseAfterAdoption('useUnderline');
        this._useUnderline = xmlBoolean(raw, this._useUnderline);
    }

    /**
     * `AdwViewStackPage:visible` — whether the page can be selected at all. The one property
     * that still reaches the stack after adoption, because the stack has a door for it.
     */
    get visible(): boolean {
        return this._visible;
    }

    set visible(raw: boolean | string) {
        this._visible = xmlBoolean(raw, this._visible);
        this._stack?.setPageVisible(this._name, this._visible);
    }

    /**
     * An XML child is the page's `child` — there is nothing else a record holds, which is why
     * the slot and the fallback are one name.
     */
    _addChildFromBuilder(_name: string, view: View): void {
        this.child = view;
    }

    /**
     * Called by the stack that takes this record. Not API: the stack is the only caller, and
     * a record adopted twice is refused, since two stacks cannot show one child.
     */
    _adoptBy(stack: AdoptingStack): void {
        if (this._stack !== null) {
            throw new Error(`AdwViewStackPage '${this._name}' already belongs to a stack.`);
        }
        this._stack = stack;
    }

    private _refuseAfterAdoption(property: string): void {
        if (this._stack === null) return;
        throw new Error(
            `AdwViewStackPage '${this._name}' was read when its stack adopted it, so '${property}' can no longer ` +
                "reach the stack or a switcher bound to it. Write it before the page is added, or use the stack's " +
                'own methods.',
        );
    }
}
