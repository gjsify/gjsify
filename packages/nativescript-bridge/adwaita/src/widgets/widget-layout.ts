// The `GtkWidget` layout properties every widget of this port answers to — `halign`,
// `valign`, `hexpand`, `vexpand`, `margin-start` and `margin-end` — under the names GTK
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
//     physical ones (`box-layout.ts` records that measurement). They resolve against the
//     view's text direction when written: `start` is the left edge in LTR and the right edge
//     in RTL, as `gtk_widget_set_margin_start` documents. A direction that changes AFTER the
//     write does not move the margin — the one thing this cannot follow.
//   · `hexpand` / `vexpand` are held and read back, and no parent in this port ALLOCATES by
//     them yet. In GTK they are a request the parent's layout grants: a `GtkBox` hands its
//     spare space to its expanding children. This port's `GtkBox` is a NativeScript
//     `StackLayout`, which measures every child at its natural size and has no spare space to
//     hand out — the same missing size-negotiation protocol the `gtk-box` ledger row already
//     declares for `homogeneous`. The grid-based containers (`AdwToolbarView`'s content row,
//     `AdwViewStack`, `AdwBottomSheet`) already give their child the whole cell, which is what
//     an expanding child asks for there.
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
import { nsAlignment } from './construct-props.js';
import { xmlBoolean } from './xml-values.js';

/**
 * The slice of a NativeScript `View` these accessors read and write — what makes a class
 * behind the mixin something a parent lays out.
 */
interface LaidOut {
    horizontalAlignment: string;
    verticalAlignment: string;
    marginLeft: number | string;
    marginRight: number | string;
    readonly style: { direction?: 'ltr' | 'rtl' | null };
}

/**
 * A constructor the mixin can wrap — the same shape `withSignals` accepts, restated here so
 * this module does not import the one that applies it.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- TS2545 admits no other spelling for a mixin base
type ObservableConstructor = abstract new (...args: any[]) => Observable;

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
            flags.h = xmlBoolean(value, flags.h);
        }

        get vexpand(): boolean {
            return EXPAND.get(this)?.v ?? false;
        }

        set vexpand(value: boolean | string) {
            laidOut(this, 'vexpand');
            const flags = expandOf(this);
            flags.v = xmlBoolean(value, flags.v);
        }

        get marginStart(): number {
            const view = viewOf(this);
            if (view === null) return 0;
            return Number(view.style?.direction === 'rtl' ? view.marginRight : view.marginLeft) || 0;
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
            return Number(view.style?.direction === 'rtl' ? view.marginLeft : view.marginRight) || 0;
        }

        set marginEnd(value: number | string) {
            const view = laidOut(this, 'marginEnd');
            const margin = marginOf(value, 'marginEnd');
            if (view.style?.direction === 'rtl') view.marginLeft = margin;
            else view.marginRight = margin;
        }
    }
    return WithGtkWidgetLayout;
}
