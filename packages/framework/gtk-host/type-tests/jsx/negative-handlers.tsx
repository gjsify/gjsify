// SIGNAL-HANDLER negatives: the generated GIR signatures, from the other side.
//
// Grammar and mechanism: see the header of `negative-tags.tsx`.

import type Gdk from '@girs/gdk-4.0';
import type Gtk from '@girs/gtk-4.0';

/** A handler parameter annotated as a type the signal never carries. */
// @ts-expect-error TS2322 — `row-activated` carries a Gtk.ListBoxRow, not a string
export const wrongParam = <gtk-list-box onRowActivated={(row: string) => row.length} />;

/**
 * A handler parameter NARROWED to a subtype — and the one negative that proves
 * `strictFunctionTypes`.
 *
 * `page-added` carries a `Gtk.Widget`; annotating the parameter as `Gtk.Button`
 * is unsound, because the signal will hand over whatever was added. Without
 * `strictFunctionTypes` a parameter is BIVARIANT and this is accepted (measured),
 * while the `wrongParam` line above — two unrelated types — errors either way. So
 * a gate missing this setting still looks alive and stops checking the half that
 * actually happens: a consumer narrowing a parameter to the case they handle.
 */
// @ts-expect-error TS2322 needs=strictFunctionTypes — Gtk.Button is a subtype of Gtk.Widget
export const narrowed = <gtk-notebook onPageAdded={(child: Gtk.Button, _n: number) => child.set_label('')} />;

/** A handler declared with more parameters than the signal emits. */
// @ts-expect-error TS2322 — `clicked` carries no arguments
export const tooManyParams = <gtk-button onClicked={(widget: Gtk.Button) => widget.set_label('x')} />;

/**
 * The out-parameter direction that still holds, and why the other one is now a
 * measured hole rather than a deleted line.
 *
 * `get-child-position` is `caller-allocates="1"`: the handler is handed a live
 * `Gdk.Rectangle` to FILL, which is the entire purpose of the signal. It keeps
 * its real type, and this line COMPILES — a rule that typed every non-`in`
 * parameter as unusable would break it.
 *
 * Its twin, `GtkSpinButton::input` (`caller-allocates="0"`), was a negative here
 * until `@girs`' `SignalSignatures` replaced the generated ones and spelled that
 * slot `number`. It lives in `known-hole-out-param.tsx` now, where COMPILING is
 * the measurement and the upstream cause is named.
 */
export const fillsOutParam = (
    <gtk-overlay
        onGetChildPosition={(_child: Gtk.Widget, allocation: Gdk.Rectangle) => {
            allocation.width = 10;
        }}
    />
);
