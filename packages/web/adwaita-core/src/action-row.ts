// Adwaita action-row family behaviour — headless (ADR 0004).
//
// FOUR widgets, ONE module, because they are four carriers of ONE derivation: the
// `string_is_not_empty` label-visibility closure, which `AdwActionRow` and
// `AdwButtonRow` each declare privately and `AdwWindowTitle` inlines by hand
// (`title && title[0]`). The rule itself lives one level down in `glib.ts`; what
// lives HERE is the per-widget state it feeds:
//
//   - {@link ActionRowState}  — `Adw.ActionRow`, whose `activatable-widget`
//                               drives `activatable` through a live binding.
//   - {@link SwitchRowState}  — `Adw.SwitchRow`'s active flag and its notify.
//   - {@link ButtonRowState}  — `Adw.ButtonRow`'s title + start/end icons.
//   - {@link WindowTitleState}— `Adw.WindowTitle`'s title/subtitle pair.
//
// NO SUBSCRIBE SEAM HERE, DELIBERATELY. `EntryRowState`/`SidebarState`/`ComboState`
// publish to subscribers because a change there can originate INSIDE the state (a
// latch flipping, a selection clamped by an unrelated model edit). Nothing in this
// family can: every transition is the direct result of the caller's own method call,
// so a subscriber would only re-deliver what the call already returned. Each mutator
// returns whether it changed — precisely the `g_object_notify_by_pspec` gate the C puts
// on the same line — and the renderer emits its `notify::*` off that.
//
// NO `icon-name` on the action row: `Adw.ActionRow:icon-name` exists (deprecated since
// 1.3) and binds the same closure, but neither renderer has the property at all — the
// browser row takes a `slot="prefix"`, the NativeScript row a `setPrefix` view. Adding
// it is a feature, not a lift.
//
// Reference: refs/libadwaita/src/adw-action-row.c, adw-action-row.ui
// Reference: refs/libadwaita/src/adw-switch-row.c
// Reference: refs/libadwaita/src/adw-button-row.c, adw-button-row.ui
// Reference: refs/libadwaita/src/adw-window-title.c, adw-window-title.ui
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { stringIsNotEmpty } from './glib.js';

/** A title/subtitle label pair with the visibility the bindings give it. */
export interface AdwRowLabels {
    /** The title label's text — `''` for an unset title, never `null`. */
    title: string;
    /** `string_is_not_empty(title)`, bound from `adw-action-row.ui`. */
    titleVisible: boolean;
    /** The subtitle label's text — `''` for an unset subtitle. */
    subtitle: string;
    /** `string_is_not_empty(subtitle)`, bound from `adw-action-row.ui`. */
    subtitleVisible: boolean;
}

/** What a row knows about its two labels. */
export interface AdwRowLabelInput {
    /** `AdwPreferencesRow:title`. */
    title?: string | null;
    /** `AdwActionRow:subtitle`. */
    subtitle?: string | null;
}

/**
 * The title/subtitle labels of any Adwaita row, with the `visible` each binding
 * computes. Exported on its own — not just as part of {@link ActionRowState} — because
 * the rows that have a core state machine of their OWN (`Adw.ComboRow`,
 * `Adw.ExpanderRow`, `Adw.SpinRow` via `rows.ts`) still render this pair.
 */
export function deriveRowLabels(input: AdwRowLabelInput): AdwRowLabels {
    const title = input.title ?? '';
    const subtitle = input.subtitle ?? '';
    return {
        title,
        titleVisible: stringIsNotEmpty(title),
        subtitle,
        subtitleVisible: stringIsNotEmpty(subtitle),
    };
}

/** Everything a renderer needs to paint an `Adw.ActionRow`. */
export interface ActionRowRenderState extends AdwRowLabels {
    /**
     * `GtkListBoxRow:activatable` — whether a click activates the row at all. `False`
     * in the template and raised by an activatable widget, not by the row itself.
     */
    activatable: boolean;
}

/**
 * `Adw.ActionRow`: two labels plus the `activatable-widget` coupling, which is
 * counter-intuitive twice over.
 *
 * (1) Setting an activatable widget does not set `activatable = TRUE`; it binds the
 * WIDGET's `sensitive` onto the row's `activatable` with `G_BINDING_SYNC_CREATE`. So
 * handing the row an INSENSITIVE widget leaves the row unactivatable, and later
 * flipping that widget's `sensitive` flips the row with it, as long as the binding
 * lives.
 *
 * (2) Clearing the widget only UNBINDS
 * (`g_clear_pointer (&priv->activatable_binding, g_binding_unbind)`); it never writes
 * `activatable` back, so the row STAYS activatable after its widget is taken away —
 * which the class documentation states outright ("unsetting it won't change the row's
 * activatability"). Modelling this as `activatable = hasActivatableWidget` gets the
 * sticky case exactly backwards.
 *
 * `TWidget` is whatever the renderer calls a widget — a DOM element, an NS `View`. Core
 * only ever compares it by identity and hands it back.
 */
export class ActionRowState<TWidget = unknown> {
    private _title = '';
    private _subtitle = '';
    private _activatableWidget: TWidget | null = null;
    // The template's `<property name="activatable">False</property>`.
    private _activatable = false;
    // The binding's view of the source property. GBinding propagates on
    // `notify::sensitive`, and `gtk_widget_set_sensitive` early-returns on an unchanged
    // value — so an unchanged write propagates NOTHING. Tracking it here is what lets a
    // renderer call `setActivatableWidgetSensitive` as often as it likes without the
    // binding re-asserting itself over a direct write.
    private _widgetSensitive = true;

    /** The current render snapshot. */
    get state(): ActionRowRenderState {
        return {
            ...deriveRowLabels({ title: this._title, subtitle: this._subtitle }),
            activatable: this._activatable,
        };
    }

    /** `AdwPreferencesRow:title`. */
    get title(): string {
        return this._title;
    }

    /** Set the title. Returns whether it changed (the `notify::title` gate). */
    setTitle(title: string | null | undefined): boolean {
        const next = title ?? '';
        if (next === this._title) return false;
        this._title = next;
        return true;
    }

    /** `AdwActionRow:subtitle`. */
    get subtitle(): string {
        return this._subtitle;
    }

    /** Set the subtitle. Returns whether it changed (the `notify::subtitle` gate). */
    setSubtitle(subtitle: string | null | undefined): boolean {
        const next = subtitle ?? '';
        if (next === this._subtitle) return false;
        this._subtitle = next;
        return true;
    }

    /** `AdwActionRow:activatable-widget` — `null` when unset. */
    get activatableWidget(): TWidget | null {
        return this._activatableWidget;
    }

    /**
     * `adw_action_row_set_activatable_widget`.
     *
     * `sensitive` is the widget's own `GtkWidget:sensitive` at the moment of the set,
     * which `G_BINDING_SYNC_CREATE` copies straight into `activatable`; it defaults to
     * `true` because a freshly built widget is sensitive. Passing `null` unbinds and
     * LEAVES `activatable` alone.
     *
     * Returns whether the widget changed — the `notify::activatable-widget` gate, which
     * the C guards with an identity early-return.
     */
    setActivatableWidget(widget: TWidget | null, sensitive = true): boolean {
        if (widget === this._activatableWidget) return false;
        this._activatableWidget = widget;
        this._widgetSensitive = sensitive;
        if (widget !== null) this._activatable = sensitive;
        return true;
    }

    /**
     * The live half of the binding: the activatable widget's `sensitive` is now
     * `sensitive`. Safe to call unconditionally. Two things make it a no-op, both the
     * C's:
     *   - no widget is set, so `g_clear_pointer (…, g_binding_unbind)` already took the
     *     binding away;
     *   - the value is unchanged, so `gtk_widget_set_sensitive` early-returned and
     *     `notify::sensitive` — the only thing a GBinding listens to — never fired.
     *     Without this half, re-asserting the value the widget already had would
     *     silently undo a direct write to `activatable`.
     *
     * Returns whether `activatable` changed.
     */
    setActivatableWidgetSensitive(sensitive: boolean): boolean {
        if (this._activatableWidget === null) return false;
        const next = !!sensitive;
        if (next === this._widgetSensitive) return false;
        this._widgetSensitive = next;
        return this.setActivatable(next);
    }

    /** `GtkListBoxRow:activatable`. */
    get activatable(): boolean {
        return this._activatable;
    }

    /**
     * Set `activatable` directly. Legal even while a binding is live:
     * `g_object_bind_property` without `G_BINDING_BIDIRECTIONAL` is one-way, so GTK lets
     * the write land and the next `sensitive` change overwrites it. Refusing the write
     * would diverge from every application that sets `activatable` in a `.ui` file.
     *
     * Returns whether it changed.
     */
    setActivatable(activatable: boolean): boolean {
        const next = !!activatable;
        if (next === this._activatable) return false;
        this._activatable = next;
        return true;
    }

    /**
     * `adw_action_row_activate_real`: forward the activation to the activatable widget,
     * then emit `activated`.
     *
     * Returns the widget to forward to, or `null`. The caller emits `activated`
     * UNCONDITIONALLY afterwards — the C's `g_signal_emit` sits outside the `if`, and
     * `adw_action_row_activate` is public API with no `activatable` check of its own.
     * The `activatable` gate lives one level up, in GtkListBox, which does not emit
     * `row-activated` for an unactivatable row; a renderer's CLICK handler is where that
     * check belongs.
     */
    activate(): TWidget | null {
        return this._activatableWidget;
    }
}

/**
 * `Adw.SwitchRow`: one boolean and its notify rule.
 *
 * `adw_switch_row_set_active` early-returns when the value is unchanged and otherwise
 * writes the slider, whose `notify::active` runs `slider_notify_active_cb` — which
 * updates the a11y `checked` state and emits `notify::active` on the ROW. That callback
 * is the ONLY notify path and it cannot see where the change came from, so a
 * programmatic set notifies exactly like a drag on the handle. That is also why there is
 * deliberately NO `interactive` flag here (the `SpinState`/`ComboState` shape): it would
 * be an abstraction the C contradicts.
 *
 * The DOM makes this easy to get wrong: `<input>`'s `change` event does not fire for a
 * programmatic `.checked =`, so a renderer that only re-emits `change` is silent for
 * `row.active = true`.
 */
export class SwitchRowState {
    // The pspec's default is FALSE.
    private _active = false;

    /** `Adw.SwitchRow:active`. */
    get active(): boolean {
        return this._active;
    }

    /**
     * `adw_switch_row_set_active`. Returns whether it changed — i.e. whether the renderer
     * must emit `notify::active`. The `!!is_active` normalisation is the C's.
     */
    setActive(active: boolean): boolean {
        const next = !!active;
        if (next === this._active) return false;
        this._active = next;
        return true;
    }

    /**
     * The row was activated (clicked, or <kbd>Enter</kbd>) — invert the state.
     *
     * `adw_switch_row_init` makes the row activatable and points the activatable-widget
     * at the slider, so an activation is forwarded to the `GtkSwitch` and toggles it; the
     * class docs state the outcome directly ("When activated, the row will invert its
     * active state. The user can control the switch by activating the row or by dragging
     * on the switch handle") — the whole row is the target, not just the handle.
     *
     * Always returns `true`: inverting a boolean always changes it.
     */
    activate(): boolean {
        return this.setActive(!this._active);
    }
}

/**
 * `Adw.ButtonRow` is ALWAYS activatable — `<property name="activatable">True</property>`
 * in the template, with no setter and no property, and the class documentation saying so
 * in one line ("`AdwButtonRow` is always activatable."). Exported as data so a renderer
 * cannot invent an `activatable="false"` opt-out.
 */
export const BUTTON_ROW_ACTIVATABLE = true;

/** Everything a renderer needs to paint an `Adw.ButtonRow`. */
export interface ButtonRowRenderState {
    /** `AdwPreferencesRow:title` — `''` when unset. */
    title: string;
    /** `string_is_not_empty(title)`. */
    titleVisible: boolean;
    /** `AdwButtonRow:start-icon-name` — `''` when unset. */
    startIconName: string;
    /** `string_is_not_empty(start_image.icon-name)`. */
    startIconVisible: boolean;
    /** `AdwButtonRow:end-icon-name` — `''` when unset. */
    endIconName: string;
    /** `string_is_not_empty(end_image.icon-name)`. */
    endIconVisible: boolean;
    /** Always {@link BUTTON_ROW_ACTIVATABLE}. */
    activatable: true;
}

/**
 * `Adw.ButtonRow`: a centered title between two optional symbolic icons.
 *
 * `AdwButtonRow:end-icon-name` has existed since libadwaita 1.6 and is what the
 * "Open in Files ›" shape needs. Both icon setters go through `g_set_str`, which returns
 * FALSE for an unchanged value and thereby gates the notify; `g_set_str (&s, NULL)`
 * stores NULL, but every read is `string_is_not_empty`-guarded and the pspec default is
 * `""`, so `''` is the faithful TS spelling of both.
 */
export class ButtonRowState {
    private _title = '';
    // adw_button_row_init seeds both to "" rather than NULL.
    private _startIconName = '';
    private _endIconName = '';

    /** The current render snapshot. */
    get state(): ButtonRowRenderState {
        return {
            title: this._title,
            titleVisible: stringIsNotEmpty(this._title),
            startIconName: this._startIconName,
            startIconVisible: stringIsNotEmpty(this._startIconName),
            endIconName: this._endIconName,
            endIconVisible: stringIsNotEmpty(this._endIconName),
            activatable: BUTTON_ROW_ACTIVATABLE,
        };
    }

    /** `AdwPreferencesRow:title`. */
    get title(): string {
        return this._title;
    }

    /** Set the title. Returns whether it changed. */
    setTitle(title: string | null | undefined): boolean {
        const next = title ?? '';
        if (next === this._title) return false;
        this._title = next;
        return true;
    }

    /** `AdwButtonRow:start-icon-name`. */
    get startIconName(): string {
        return this._startIconName;
    }

    /** `adw_button_row_set_start_icon_name`. Returns whether it changed. */
    setStartIconName(iconName: string | null | undefined): boolean {
        const next = iconName ?? '';
        if (next === this._startIconName) return false;
        this._startIconName = next;
        return true;
    }

    /** `AdwButtonRow:end-icon-name`. */
    get endIconName(): string {
        return this._endIconName;
    }

    /** `adw_button_row_set_end_icon_name`. Returns whether it changed. */
    setEndIconName(iconName: string | null | undefined): boolean {
        const next = iconName ?? '';
        if (next === this._endIconName) return false;
        this._endIconName = next;
        return true;
    }
}

/** Everything a renderer needs to paint an `Adw.WindowTitle`. */
export type WindowTitleRenderState = AdwRowLabels;

/**
 * `Adw.WindowTitle`: the same two labels, one level out of the boxed list. Three rules —
 * the TITLE label is hidden when the title is empty (the `.ui` even starts it
 * `visible=False`), a set to the CURRENT value returns early, and a real change notifies.
 *
 * DIVERGENCE, deliberate: setting `null` over an already-empty value does NOT notify
 * here, where libadwaita does. Its guard is `g_strcmp0 (gtk_label_get_label (…), title)`
 * and `gtk_label_get_label` never returns NULL, so `g_strcmp0 ("", NULL)` is 1 — the
 * early return is skipped, the label is re-set to the same `""`, and `notify::title` fires
 * for a no-op. That is an artefact of a NULL-vs-`""` pointer comparison, not a designed
 * behaviour; both renderers carry `null` for "attribute absent" and `''` for `title=""`.
 * The normalisation happens BEFORE the comparison, and `WINDOW_TITLE_VECTORS` pins the
 * divergence rather than hiding it.
 */
export class WindowTitleState {
    private _title = '';
    private _subtitle = '';

    /** The current render snapshot. */
    get state(): WindowTitleRenderState {
        return deriveRowLabels({ title: this._title, subtitle: this._subtitle });
    }

    /** `Adw.WindowTitle:title`. */
    get title(): string {
        return this._title;
    }

    /** `adw_window_title_set_title`. Returns whether it changed. */
    setTitle(title: string | null | undefined): boolean {
        const next = title ?? '';
        if (next === this._title) return false;
        this._title = next;
        return true;
    }

    /** `Adw.WindowTitle:subtitle`. */
    get subtitle(): string {
        return this._subtitle;
    }

    /** `adw_window_title_set_subtitle`. Returns whether it changed. */
    setSubtitle(subtitle: string | null | undefined): boolean {
        const next = subtitle ?? '';
        if (next === this._subtitle) return false;
        this._subtitle = next;
        return true;
    }
}
