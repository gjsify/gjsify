// GtkStackPage — the page record a `Gtk.Stack` is AUTHORED with, for NativeScript.
//
// NOT A VIEW, AS UPSTREAM. `GtkStackPage` descends from `GObject.Object`: it carries a page's
// `name`, `title`, `icon-name` and attention state beside the `child` that is the page, and
// the stack adopts the child and keeps the record. A Blueprint spells it
// `Stack { StackPage { name: "debugger"; child: … } }`, and without a class for it the
// shared-tree builder refuses every such `.blp`.
//
// The shape is `AdwViewStackPage`'s (`view-stack-page.ts`) for the same reason and with the
// same rule: the stack reads the record when it ADOPTS it, so after adoption `visible` is
// forwarded and every other write is REFUSED rather than becoming a silent no-op on a record
// the stack no longer reads. Unlike `Adw.ViewStackPage` it has no `badge-number`.
//
// Reference: refs/gtk gtk/gtkstack.c (GtkStackPage)
// Copyright (c) The GTK Team. LGPLv2.1+.

import { Observable, type View } from '@nativescript/core';

import { builderSlotsOf } from './builder-slots.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { withSignals } from './signals.js';
import { xmlBoolean } from './xml-values.js';

/** The one stack call a record needs once adopted — `GtkStack.setPageVisible`. */
interface AdoptingStack {
    setPageVisible(name: string, visible: boolean): boolean;
}

/** A stack this record was handed to before it had a child — see {@link GtkStackPage._awaitChild}. */
interface AwaitingStack {
    _addChildFromBuilder(name: string, view: GtkStackPage): void;
}

export class GtkStackPage extends withSignals(Observable) {
    static readonly GTypeName: string = 'GtkStackPage';

    /** `child:` in a `.blp` — the page itself. The fallback too: a bare child IS the page. */
    static readonly builderSlots: readonly string[] = builderSlotsOf(['child'], 'child');

    private _child: View | null = null;
    private _name = '';
    private _title: string | null = null;
    private _iconName: string | null = null;
    private _needsAttention = false;
    private _visible = true;
    private _useUnderline = false;
    /** The stack that adopted this record, or `null` while it is still being authored. */
    private _stack: AdoptingStack | null = null;
    /** The stack waiting for this record's child, while it has none. */
    private _awaiting: AwaitingStack | null = null;

    constructor(props?: ConstructProps<GtkStackPage>) {
        super();
        applyConstructProps(this, props);
    }

    /** `GtkStackPage:child` — the view the stack shows for this page. */
    get child(): View | null {
        return this._child;
    }

    set child(view: View | null) {
        this._refuseAfterAdoption('child');
        this._child = view;
        const stack = this._awaiting;
        if (stack === null || view === null) return;
        this._awaiting = null;
        stack._addChildFromBuilder('', this);
    }

    /** `GtkStackPage:name` — what `visible-child-name` selects by. */
    get name(): string {
        return this._name;
    }

    set name(value: string | null) {
        this._refuseAfterAdoption('name');
        this._name = value ?? '';
    }

    /** `GtkStackPage:title`. */
    get title(): string | null {
        return this._title;
    }

    set title(value: string | null) {
        this._refuseAfterAdoption('title');
        this._title = value;
    }

    /** `GtkStackPage:icon-name`. */
    get iconName(): string | null {
        return this._iconName;
    }

    set iconName(value: string | null) {
        this._refuseAfterAdoption('iconName');
        this._iconName = value;
    }

    /** `GtkStackPage:needs-attention`. */
    get needsAttention(): boolean {
        return this._needsAttention;
    }

    set needsAttention(raw: boolean | string) {
        this._refuseAfterAdoption('needsAttention');
        this._needsAttention = xmlBoolean(raw, this._needsAttention);
    }

    /** `GtkStackPage:use-underline`. */
    get useUnderline(): boolean {
        return this._useUnderline;
    }

    set useUnderline(raw: boolean | string) {
        this._refuseAfterAdoption('useUnderline');
        this._useUnderline = xmlBoolean(raw, this._useUnderline);
    }

    /** `GtkStackPage:visible` — the one property that still reaches the stack after adoption. */
    get visible(): boolean {
        return this._visible;
    }

    set visible(raw: boolean | string) {
        this._visible = xmlBoolean(raw, this._visible);
        this._stack?.setPageVisible(this._name, this._visible);
    }

    /** An XML child is the page's `child` — there is nothing else a record holds. */
    _addChildFromBuilder(_name: string, view: View): void {
        this.child = view;
    }

    /** Called by the stack that takes this record; a record adopted twice is refused. */
    _adoptBy(stack: AdoptingStack): void {
        if (this._stack !== null) {
            throw new Error(`GtkStackPage '${this._name}' already belongs to a stack.`);
        }
        this._stack = stack;
    }

    /**
     * Called by a stack handed this record while it has no child yet. NativeScript's XML
     * builder hands a child to its parent at the child's START tag, so a template's
     * `<gtk:StackPage>` reaches the stack before its own `<gtk:StackPage.child>` has been
     * read; the stack takes the record when the child arrives, which keeps document order.
     */
    _awaitChild(stack: AwaitingStack): void {
        this._awaiting = stack;
    }

    private _refuseAfterAdoption(property: string): void {
        if (this._stack === null) return;
        throw new Error(
            `GtkStackPage '${this._name}' was read when its stack adopted it, so '${property}' can no longer ` +
                "reach the stack. Write it before the page is added, or use the stack's own methods.",
        );
    }
}
