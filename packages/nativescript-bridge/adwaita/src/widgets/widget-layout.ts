// The `GtkWidget` properties every widget of this port answers to — `halign`, `valign`,
// `hexpand`, `vexpand`, `margin-start`, `margin-end`, and the five BASE properties
// `visible`, `sensitive`, `name`, `width-request` and `height-request` — under the names GTK
// gives them.
//
// WHY THEY WERE MISSING, AND WHAT IT COST. A GTK widget inherits these from `GtkWidget`, and
// every Blueprint that places anything writes them: the gallery's `Adw.BottomSheet` centres
// its button with `halign: center; valign: center;` and insets its sheet with four
// `margin-*` lines. This port had NativeScript's own `horizontalAlignment` /
// `verticalAlignment` / `marginLeft` / `marginRight` and none of the GTK names, so the
// shared-tree builder refused every such `.blp` — correctly, since a write to a name nothing
// declares is a dead own-property at exit 0 — and the same `<adw:Avatar halign="center">`
// failed on the XML door. ADR 0034 § Amendment 12 left the names open because answering them
// seemed to take "46 near-identical accessor pairs or a prototype patch". Neither is needed
// now: § Amendment 15 put ONE mixin on every class where the port meets the platform
// (`withSignals`, `signals.ts`), and this is applied there, so each accessor is written once
// and every widget, and every widget a later change adds, has it.
//
// THE PLATFORM PROPERTY STAYS THE SOURCE OF TRUTH. `halign` writes `horizontalAlignment` and
// reads it back; nothing is cached beside it, so a caller writing NativeScript's own name
// and a caller writing GTK's see one value. `margin-top` and `margin-bottom` are not here at
// all: `marginTop` / `marginBottom` are NativeScript's own names already, and a projected
// `.blp` reaches them through the case rule alone.
//
// WHAT EACH ONE MAPS TO, AND WHERE THE MAPPING STOPS.
//
//   · `halign` / `valign` go through `gtk-align.ts`'s tables — the same translation the
//     construct-props bag applies to the NativeScript names. The three baseline members are
//     refused, by name and with the reason, because nothing in @nativescript/core measures a
//     baseline. A value that is not a `Gtk.Align` is refused too, rather than passed
//     through: `halign="left"` is NativeScript's vocabulary written under GTK's name.
//   · `margin-start` / `margin-end` are LOGICAL edges and NativeScript's `Style` has only
//     physical ones (`gtk-align.ts` records that measurement: only ALIGNMENT is direction-relative). They resolve against the
//     view's text direction when written: `start` is the left edge in LTR and the right edge
//     in RTL, as `gtk_widget_set_margin_start` documents. A direction that changes AFTER the
//     write does not move the margin — the one thing this cannot follow.
//   · `hexpand` / `vexpand` are held and read back, and a change emits `notify::hexpand` /
//     `notify::vexpand` (`NOTIFY_HEXPAND`, `NOTIFY_VEXPAND`). In GTK they are a request the
//     parent's layout grants, and ONE parent in this port grants it: `Gtk.Box` plans a `*`
//     track for every child that expands along its axis and listens to these events to
//     re-plan (`box-layout.ts`). The grid-based containers (`AdwToolbarView`'s content row,
//     `AdwViewStack`, `AdwBottomSheet`) already give their child the whole cell, which is what
//     an expanding child asks for there; `Gtk.Grid` places by cell and does not distribute.
//
// THE FIVE BASE PROPERTIES (ADR 0034 § Amendment 22), each over a platform property that
// stays the source of truth:
//
//   · `visible` is `visibility`: `true` is `'visible'`, `false` is `'collapse'` — out of
//     layout, which is what a hidden GTK widget is (it allocates nothing). `'hidden'`, which
//     keeps the space, reads back as not visible. A widget that drives `visibility` itself
//     (`Adw.Banner:revealed`, a `Gtk.Revealer`'s child) and a caller writing `visible` write
//     the same property; the last write wins, which is the one thing this cannot arbitrate.
//   · `sensitive` is `isEnabled`, NativeScript's own flag: a disabled view takes no input and
//     NativeScript puts it in the `:disabled` pseudo-state the Adwaita theme dims.
//   · `name` is the widget NAME GTK's CSS reads as `#name`. NativeScript's `#id` selector is
//     the same thing under another word, so a write also lands on `id` — unless the view
//     already has one, because the `id` a `.blp` declares is how code beside it finds the
//     view (`getViewById`) and the `name` is a second, independent fact. Either write order
//     gives the same result. Read back, an unnamed widget answers its class name, as
//     `gtk_widget_get_name` answers its GType name.
//   · `width-request` / `height-request` are `minWidth` / `minHeight`. GTK's `-1` means
//     "unset" and is what an unrequested size reads back as; `0` writes the same request. A
//     request is a MINIMUM, which is exactly what `min-width` is — and why neither is `width`,
//     which NativeScript takes as an exact size.
//
// All five are tolerant of NativeScript's unset reads: `minWidth` answers a `{value, unit}`
// object (its `zeroLength` default), `isEnabled` and `visibility` carry real defaults, and
// none of the five is in `status/nativescript-undefined-defaults.json` — measured against
// `@nativescript/core` 9.1.0-alpha.11, where each `Property` registers a `defaultValue`.
//
// NOT EVERY CLASS BEHIND THE MIXIN IS A VIEW. `withSignals` also wraps the two classes that
// extend `Observable` directly (`AdwAlertDialog`, and the page records a stack is authored
// with), and those have no layout to align. Their setters refuse instead of writing a
// property no layout pass reads.
//
// Reference: refs/gtk/gtk/gtkwidget.c (gtk_widget_set_halign, gtk_widget_set_margin_start,
//            gtk_widget_set_hexpand)
// Copyright (c) The GTK Team. LGPLv2.1+.

import type { Observable } from '@nativescript/core';

import { GTK_ALIGN, NS_HORIZONTAL_ALIGNMENT, NS_VERTICAL_ALIGNMENT } from './gtk-align.js';
import { gtypeNameOfInstance } from './gtype-name.js';
import { nsAlignment } from './construct-props.js';
import { lengthValue, type NsLength } from './ns-length.js';
import { xmlBoolean } from './xml-values.js';
import { insertActionGroup } from './actions.js';
import type { ActionGroupLike } from '@gjsify/adwaita-core';

/**
 * The slice of a NativeScript `View` these accessors read and write — what makes a class
 * behind the mixin something a parent lays out.
 */
interface LaidOut {
    horizontalAlignment: string;
    verticalAlignment: string;
    marginLeft: NsLength;
    marginRight: NsLength;
    visibility: string;
    isEnabled: boolean;
    id: string | undefined;
    minWidth: NsLength;
    minHeight: NsLength;
    readonly style: { direction?: 'ltr' | 'rtl' | null };
}

/**
 * A constructor the mixin can wrap — the same shape `withSignals` accepts, restated here so
 * this module does not import the one that applies it.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- TS2545 admits no other spelling for a mixin base
type ObservableConstructor = abstract new (...args: any[]) => Observable;

/** The events a `hexpand` / `vexpand` change emits, so a parent that allocates by them can re-allocate. */
export const NOTIFY_HEXPAND = 'notify::hexpand';
export const NOTIFY_VEXPAND = 'notify::vexpand';

/** `gtkwidget.c`'s margin pspecs: `0 … G_MAXINT16`. */
const MAX_MARGIN = 0x7fff;

/**
 * Whether `target` is a view — the `LaidOut` slice is there — or throw, naming the property.
 *
 * `horizontalAlignment` is the probe because every `View` has it (a registered style
 * property on the real platform, a field on the test double) and an `Observable` does not.
 */
function laidOut(target: object, property: string): LaidOut {
    const view = viewOf(target);
    if (view !== null) return view;
    throw new TypeError(
        `${target.constructor.name} is not laid out by a parent, so it has no '${property}'. ` +
            'The GtkWidget layout properties reach views only; this class extends Observable.',
    );
}

/**
 * The view behind `target` for a READ, or `null` when there is none — a getter answers the
 * GTK default rather than throwing, so a tree walk that reads every property of every node
 * (the devtools inspector does) is not broken by the two classes that are not views.
 */
function viewOf(target: object): LaidOut | null {
    return 'horizontalAlignment' in target ? (target as unknown as LaidOut) : null;
}

/** What the tree members read of a `View`: its parent, its children in order and its CSS direction. */
interface TreeNode {
    parent?: TreeNode | null;
    eachChildView?(callback: (child: TreeNode) => boolean): void;
    style?: { direction?: string };
}

/** `Gtk.TextDirection`: NONE, LTR, RTL. */
const DIRECTIONS = [0, 1, 2];

/** A GTK widget is a view that carries these members; plain NativeScript views (a scroller's inner `ScrollView`) are layout plumbing. */
function isWidget(node: object): boolean {
    return typeof (node as { get_first_child?: unknown }).get_first_child === 'function';
}

/** The widget children of `widget`, looking through plain views the way GTK has no such layer. */
function childrenOf(widget: object): TreeNode[] {
    const children: TreeNode[] = [];
    (widget as TreeNode).eachChildView?.((child) => {
        if (isWidget(child)) children.push(child);
        else children.push(...childrenOf(child));
        return true;
    });
    return children;
}

function parentOf(widget: object): TreeNode | null {
    let parent = (widget as TreeNode).parent ?? null;
    while (parent !== null && !isWidget(parent)) parent = parent.parent ?? null;
    return parent;
}

function siblingOf(widget: object, offset: 1 | -1): TreeNode | null {
    const parent = parentOf(widget);
    if (parent === null) return null;
    const siblings = childrenOf(parent);
    return siblings[siblings.indexOf(widget as TreeNode) + offset] ?? null;
}

/** A `Gtk.Align` nick from a nick or a constant, or throw — never NativeScript's own words. */
function alignNick(value: unknown, property: 'halign' | 'valign'): string {
    if (typeof value === 'string' && Object.hasOwn(GTK_ALIGN, value)) return value;
    if (typeof value === 'number') {
        const nick = Object.keys(GTK_ALIGN).find((name) => GTK_ALIGN[name] === value);
        if (nick !== undefined) return nick;
    }
    throw new TypeError(
        `'${String(value)}' is not a Gtk.Align, so it cannot be '${property}'. The members are ` +
            `${Object.keys(GTK_ALIGN).join(', ')}; NativeScript's own alignment words go to ` +
            `${property === 'halign' ? 'horizontalAlignment' : 'verticalAlignment'}.`,
    );
}

/**
 * The `Gtk.Align` a NativeScript alignment reads back as.
 *
 * The inverse of `gtk-align.ts`'s table, plus NativeScript's PHYSICAL horizontal words,
 * which a caller may have written under the platform's own name: `left` is the start edge
 * in LTR and the end edge in RTL. Anything the layout pass does not know is `fill`, because
 * that pass sends it to its `default:` arm, which stretches.
 */
function readAlign(value: string, table: Readonly<Record<string, string>>, rtl: boolean | null): string {
    for (const [nick, mapped] of Object.entries(table)) if (mapped === value) return nick;
    if (rtl !== null && value === 'left') return rtl ? 'end' : 'start';
    if (rtl !== null && value === 'right') return rtl ? 'start' : 'end';
    return 'fill';
}

/** A margin as GTK takes it: an integer in `0 … G_MAXINT16`, or throw. */
function marginOf(value: unknown, property: string): number {
    const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof parsed === 'number' && Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_MARGIN) {
        return parsed;
    }
    // `g_object_set` refuses an out-of-range value with a warning and keeps the old one; a
    // silent keep is the drop this port refuses everywhere else, so it is an error here.
    throw new TypeError(`'${String(value)}' is not a margin: '${property}' takes an integer from 0 to ${MAX_MARGIN}.`);
}

/** `gtkwidget.c`'s size-request pspecs: `-1 … G_MAXINT`. */
const MAX_SIZE_REQUEST = 0x7fffffff;

/** A size request as GTK takes it: an integer from -1 (unset) up, or throw. */
function sizeRequestOf(value: unknown, property: string): number {
    const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof parsed === 'number' && Number.isInteger(parsed) && parsed >= -1 && parsed <= MAX_SIZE_REQUEST) {
        return parsed;
    }
    throw new TypeError(
        `'${String(value)}' is not a size request: '${property}' takes an integer from -1 (unset) upward.`,
    );
}

/**
 * The size request a NativeScript minimum reads back as — `-1` when nothing is requested.
 *
 * `minWidth` answers `{ value: 0, unit: 'px' }` until written, a number or `'120'`/`'120px'`
 * once someone wrote one; a percentage or `auto` is no request GTK has a number for.
 */
function readSizeRequest(length: NsLength): number {
    const parsed = lengthValue(length);
    return parsed !== null && parsed > 0 ? Math.round(parsed) : -1;
}

/** Per-instance `name`s, held beside the view because `id` may belong to a `.blp`. */
const NAMES = new WeakMap<object, string>();

/** The per-instance expand flags, kept off the instance so the mixin adds no own property. */
const EXPAND = new WeakMap<object, { h: boolean; v: boolean }>();

function expandOf(target: object): { h: boolean; v: boolean } {
    let flags = EXPAND.get(target);
    if (flags === undefined) {
        flags = { h: false, v: false };
        EXPAND.set(target, flags);
    }
    return flags;
}

/** The six accessors the mixin adds. Named so a consumer can annotate with it. */
export interface GtkWidgetLayout {
    /** `GtkWidget:halign` — a `Gtk.Align` nick, read back from `horizontalAlignment`. */
    halign: string;
    /** `GtkWidget:valign` — a `Gtk.Align` nick, read back from `verticalAlignment`. */
    valign: string;
    /** `GtkWidget:hexpand` — held; see the file header for which parents grant it. */
    hexpand: boolean;
    /** `GtkWidget:vexpand` — held; see the file header for which parents grant it. */
    vexpand: boolean;
    /** `GtkWidget:margin-start` — the leading edge, resolved against the text direction. */
    marginStart: number;
    /** `GtkWidget:margin-end` — the trailing edge, resolved against the text direction. */
    marginEnd: number;
    /** `GtkWidget:visible` — `visibility`; `false` takes the widget out of layout. */
    visible: boolean;
    /** `GtkWidget:sensitive` — `isEnabled`. */
    sensitive: boolean;
    /** `GtkWidget:name` — the CSS `#name`, written through to `id` when the view has none. */
    name: string;
    /** `GtkWidget:width-request` — `minWidth`; `-1` is unset. */
    widthRequest: number;
    /** `GtkWidget:height-request` — `minHeight`; `-1` is unset. */
    heightRequest: number;
}

/**
 * Give a `@nativescript/core` base GTK's widget layout properties.
 *
 * Applied by `withSignals` and nowhere else, so it reaches exactly the classes that meet the
 * platform — the rule arm 6 of `check-nativescript-xml-doors.mjs` already holds for that
 * mixin — and a subclass of a port class inherits it like any other accessor.
 */
export function withGtkWidgetLayout<TBase extends ObservableConstructor>(Base: TBase) {
    abstract class WithGtkWidgetLayout extends Base implements GtkWidgetLayout {
        get halign(): string {
            const view = viewOf(this);
            if (view === null) return 'fill';
            return readAlign(view.horizontalAlignment, NS_HORIZONTAL_ALIGNMENT, view.style?.direction === 'rtl');
        }

        set halign(value: string | number) {
            const view = laidOut(this, 'halign');
            view.horizontalAlignment = nsAlignment(alignNick(value, 'halign'), 'horizontal') as string;
        }

        get valign(): string {
            const view = viewOf(this);
            return view === null ? 'fill' : readAlign(view.verticalAlignment, NS_VERTICAL_ALIGNMENT, null);
        }

        set valign(value: string | number) {
            const view = laidOut(this, 'valign');
            view.verticalAlignment = nsAlignment(alignNick(value, 'valign'), 'vertical') as string;
        }

        get hexpand(): boolean {
            return EXPAND.get(this)?.h ?? false;
        }

        set hexpand(value: boolean | string) {
            laidOut(this, 'hexpand');
            const flags = expandOf(this);
            const next = xmlBoolean(value, flags.h);
            if (next === flags.h) return;
            flags.h = next;
            this.notify({ eventName: NOTIFY_HEXPAND, object: this });
        }

        get vexpand(): boolean {
            return EXPAND.get(this)?.v ?? false;
        }

        set vexpand(value: boolean | string) {
            laidOut(this, 'vexpand');
            const flags = expandOf(this);
            const next = xmlBoolean(value, flags.v);
            if (next === flags.v) return;
            flags.v = next;
            this.notify({ eventName: NOTIFY_VEXPAND, object: this });
        }

        get marginStart(): number {
            const view = viewOf(this);
            if (view === null) return 0;
            return lengthValue(view.style?.direction === 'rtl' ? view.marginRight : view.marginLeft) ?? 0;
        }

        set marginStart(value: number | string) {
            const view = laidOut(this, 'marginStart');
            const margin = marginOf(value, 'marginStart');
            if (view.style?.direction === 'rtl') view.marginRight = margin;
            else view.marginLeft = margin;
        }

        get marginEnd(): number {
            const view = viewOf(this);
            if (view === null) return 0;
            return lengthValue(view.style?.direction === 'rtl' ? view.marginLeft : view.marginRight) ?? 0;
        }

        set marginEnd(value: number | string) {
            const view = laidOut(this, 'marginEnd');
            const margin = marginOf(value, 'marginEnd');
            if (view.style?.direction === 'rtl') view.marginLeft = margin;
            else view.marginRight = margin;
        }

        get visible(): boolean {
            const view = viewOf(this);
            return view === null ? true : view.visibility === 'visible';
        }

        set visible(value: boolean | string) {
            const view = laidOut(this, 'visible');
            view.visibility = xmlBoolean(value, this.visible) ? 'visible' : 'collapse';
        }

        get sensitive(): boolean {
            const view = viewOf(this);
            return view === null ? true : view.isEnabled !== false;
        }

        set sensitive(value: boolean | string) {
            const view = laidOut(this, 'sensitive');
            view.isEnabled = xmlBoolean(value, this.sensitive);
        }

        get name(): string {
            return NAMES.get(this) ?? gtypeNameOfInstance(this);
        }

        set name(value: string | null) {
            const view = laidOut(this, 'name');
            const previous = NAMES.get(this);
            const next = value ?? '';
            if (next === '') NAMES.delete(this);
            else NAMES.set(this, next);
            // `id` follows the name only while it IS the name (or nothing): an id someone else
            // wrote is a different fact and stays.
            if (view.id === undefined || view.id === previous) view.id = next === '' ? undefined : next;
        }

        /** `gtk_widget_set_direction`: written to the CSS `direction` a view resolves its margins by; NONE clears it. */
        set_direction(direction: number): void {
            if (!DIRECTIONS.includes(direction)) {
                throw new TypeError(`${direction} is not a valid value for enum argument dir`);
            }
            const style = (this as unknown as TreeNode).style;
            if (style === undefined) return;
            style.direction = direction === 0 ? '' : direction === 2 ? 'rtl' : 'ltr';
        }

        /** `gtk_widget_get_direction`: LTR until set. */
        get_direction(): number {
            const direction = (this as unknown as TreeNode).style?.direction;
            return direction === 'rtl' ? 2 : 1;
        }

        get_first_child(): object | null {
            return childrenOf(this)[0] ?? null;
        }

        get_last_child(): object | null {
            return childrenOf(this).at(-1) ?? null;
        }

        get_next_sibling(): object | null {
            return siblingOf(this, 1);
        }

        get_prev_sibling(): object | null {
            return siblingOf(this, -1);
        }

        get_parent(): object | null {
            return parentOf(this);
        }

        /** `gtk_widget_insert_action_group`: `null` removes the group of `prefix`. */
        insert_action_group(prefix: string, group: ActionGroupLike | null): void {
            insertActionGroup(this as unknown as Parameters<typeof insertActionGroup>[0], prefix, group);
        }

        get widthRequest(): number {
            const view = viewOf(this);
            return view === null ? -1 : readSizeRequest(view.minWidth);
        }

        set widthRequest(value: number | string) {
            const view = laidOut(this, 'widthRequest');
            view.minWidth = Math.max(0, sizeRequestOf(value, 'widthRequest'));
        }

        get heightRequest(): number {
            const view = viewOf(this);
            return view === null ? -1 : readSizeRequest(view.minHeight);
        }

        set heightRequest(value: number | string) {
            const view = laidOut(this, 'heightRequest');
            view.minHeight = Math.max(0, sizeRequestOf(value, 'heightRequest'));
        }
    }
    return WithGtkWidgetLayout;
}
