// Adwaita action-row family behaviour — headless (ADR 0004).
//
// FOUR widgets, ONE module, because they are four carriers of ONE derivation:
// the `string_is_not_empty` label-visibility closure (adw-action-row.c:112-117,
// bound in adw-action-row.ui:49-53 for the title and :71-75 for the subtitle).
// `AdwButtonRow` declares the identical closure again (adw-button-row.c:92-97,
// bound at adw-button-row.ui:34-38 / :20-24 / :55-59) and `AdwWindowTitle`
// inlines the same expression by hand (`title && title[0]`,
// adw-window-title.c:207-208, :248-249). Splitting them into four modules would
// mean four places to re-derive the same rule — which is exactly the state the
// renderers were in: the browser port hand-rolled the block SIX times
// (`adw-action-row.ts:75`, `adw-combo-row.ts:120`, `adw-expander-row.ts:189`,
// `adw-spin-row.ts:129`, `adw-switch-row.ts:75`, `adw-window-title.ts:44`) and
// omitted the TITLE half of the rule in every single copy, so an
// `<adw-action-row title="">` reserved a blank line forever. The NativeScript
// port never removed a title label at all.
//
// The rule itself lives one level down, in `glib.ts` beside `glibClamp` and
// `stripMnemonic`, because core already carried two copies of it before this
// family arrived. What lives HERE is the per-widget state the rule feeds:
//
//   - {@link ActionRowState}  — `Adw.ActionRow`, whose `activatable-widget`
//                               drives `activatable` through a live binding.
//   - {@link SwitchRowState}  — `Adw.SwitchRow`'s active flag and its notify.
//   - {@link ButtonRowState}  — `Adw.ButtonRow`'s title + start/end icons.
//   - {@link WindowTitleState}— `Adw.WindowTitle`'s title/subtitle pair.
//
// NO SUBSCRIBE SEAM HERE, DELIBERATELY. `EntryRowState`/`SidebarState`/
// `ComboState` publish changes to subscribers because a change there can
// originate INSIDE the state (a latch flipping, a selection clamped by an
// unrelated model edit). Nothing in this family can: every transition is the
// direct result of the caller's own method call, so a subscriber would only
// re-deliver what the call already returned. Each mutator therefore returns
// whether it changed, which is precisely the `g_object_notify_by_pspec` gate the
// C puts on the same line, and the renderer emits its `notify::*` off that.
//
// NO `icon-name` on the action row. `Adw.ActionRow:icon-name` exists (and is
// deprecated since 1.3, adw-action-row.h:58-62) and binds the same closure at
// adw-action-row.ui:27-31 — but neither renderer has the property at all: the
// browser row takes a `slot="prefix"` and the NativeScript row a `setPrefix`
// view. Adding it is a feature, not a lift, so this module does not pretend to
// carry it.
//
// Reference: refs/libadwaita/src/adw-action-row.c, adw-action-row.ui
// Reference: refs/libadwaita/src/adw-switch-row.c
// Reference: refs/libadwaita/src/adw-button-row.c, adw-button-row.ui
// Reference: refs/libadwaita/src/adw-window-title.c, adw-window-title.ui
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { stringIsNotEmpty } from './glib.js';

// ---------------------------------------------------------------------------
// The shared rule
// ---------------------------------------------------------------------------

/** A title/subtitle label pair with the visibility the bindings give it. */
export interface AdwRowLabels {
    /** The title label's text — `''` for an unset title, never `null`. */
    title: string;
    /** `string_is_not_empty(title)` — adw-action-row.ui:49-53. */
    titleVisible: boolean;
    /** The subtitle label's text — `''` for an unset subtitle. */
    subtitle: string;
    /** `string_is_not_empty(subtitle)` — adw-action-row.ui:71-75. */
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
 * computes.
 *
 * Exported on its own — not just as part of {@link ActionRowState} — because the
 * rows that already have a core state machine of their OWN (`Adw.ComboRow`,
 * `Adw.ExpanderRow`, `Adw.SpinRow` via `rows.ts`) still render this pair, and
 * every one of them had hand-rolled it.
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

// ---------------------------------------------------------------------------
// Adw.ActionRow
// ---------------------------------------------------------------------------

/** Everything a renderer needs to paint an `Adw.ActionRow`. */
export interface ActionRowRenderState extends AdwRowLabels {
    /**
     * `GtkListBoxRow:activatable` — whether a click activates the row at all.
     * `False` in the template (adw-action-row.ui:5) and raised by an activatable
     * widget rather than by the row itself.
     */
    activatable: boolean;
}

/**
 * `Adw.ActionRow`: two labels plus the `activatable-widget` coupling.
 *
 * The coupling is the part no port had, and it is counter-intuitive twice over.
 *
 * (1) Setting an activatable widget does not set `activatable = TRUE`; it binds
 * the WIDGET's `sensitive` onto the row's `activatable` with
 * `G_BINDING_SYNC_CREATE` (adw-action-row.c:729-732). So handing the row an
 * INSENSITIVE widget leaves the row unactivatable, and later flipping that
 * widget's `sensitive` flips the row with it, for as long as the binding lives.
 *
 * (2) Clearing the widget only UNBINDS (`g_clear_pointer (&priv->
 * activatable_binding, g_binding_unbind)`, C:709); it never writes `activatable`
 * back. The row therefore STAYS activatable after its widget is taken away —
 * which the class documentation states outright ("unsetting it won't change the
 * row's activatability", C:28-30). A port that models this as
 * `activatable = hasActivatableWidget` gets the sticky case exactly backwards.
 *
 * `TWidget` is whatever the renderer calls a widget — a DOM element, an NS
 * `View`. Core only ever compares it by identity and hands it back.
 */
export class ActionRowState<TWidget = unknown> {
    private _title = '';
    private _subtitle = '';
    private _activatableWidget: TWidget | null = null;
    // adw-action-row.ui:5 — `<property name="activatable">False</property>`.
    private _activatable = false;
    // The binding's view of the source property. GBinding propagates on
    // `notify::sensitive`, and `gtk_widget_set_sensitive` early-returns on an
    // unchanged value — so an unchanged write propagates NOTHING. Tracking it
    // here is what lets a renderer call `setActivatableWidgetSensitive` as often
    // as it likes without the binding re-asserting itself over a direct write.
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
     * `adw_action_row_set_activatable_widget` (C:696-741).
     *
     * `sensitive` is the widget's own `GtkWidget:sensitive` at the moment of the
     * set, which `G_BINDING_SYNC_CREATE` copies straight into `activatable`
     * (C:729-732); it defaults to `true` because a freshly built widget is
     * sensitive. Passing `null` unbinds and LEAVES `activatable` alone (C:709).
     *
     * Returns whether the widget changed — the `notify::activatable-widget` gate
     * (C:740, guarded by the identity early-return at C:706-707).
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
     * `sensitive`. Safe to call unconditionally — a renderer that re-reads the
     * widget rather than being told is the normal case on both ports.
     *
     * Two things make it a no-op, and both are the C's:
     *   - no widget is set, so `g_clear_pointer (…, g_binding_unbind)` (C:709)
     *     already took the binding away;
     *   - the value is unchanged, so `gtk_widget_set_sensitive` early-returned
     *     and `notify::sensitive` — the only thing a GBinding listens to — never
     *     fired. Without this half, a re-assertion of the value the widget
     *     already had would silently undo a direct write to `activatable`.
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
     * Set `activatable` directly.
     *
     * Legal even while a binding is live: `g_object_bind_property` without
     * `G_BINDING_BIDIRECTIONAL` is one-way, so GTK lets the write land and the
     * next `sensitive` change overwrites it. Kept faithful rather than guarded —
     * a port that refused the write would diverge from every application that
     * sets `activatable` in a `.ui` file.
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
     * `adw_action_row_activate_real` (C:297-307): forward the activation to the
     * activatable widget, then emit `activated`.
     *
     * Returns the widget to forward to, or `null`. The caller emits `activated`
     * UNCONDITIONALLY afterwards — C:306 is outside the `if`, and
     * `adw_action_row_activate` is public API (adw-action-row.h:90) with no
     * `activatable` check of its own. The `activatable` gate lives one level up,
     * in GtkListBox, which does not emit `row-activated` for an unactivatable
     * row; a renderer's CLICK handler is where that check belongs.
     */
    activate(): TWidget | null {
        return this._activatableWidget;
    }
}

// ---------------------------------------------------------------------------
// Adw.SwitchRow
// ---------------------------------------------------------------------------

/**
 * `Adw.SwitchRow`: one boolean, and the notify rule the two ports disagreed on.
 *
 * `adw_switch_row_set_active` (C:216-228) early-returns when the value is
 * unchanged and otherwise writes the slider, whose `notify::active` runs
 * `slider_notify_active_cb` (C:66-77) — which updates the a11y `checked` state
 * and emits `notify::active` on the ROW. That callback is the ONLY notify path,
 * and it cannot see where the change came from, so a programmatic set notifies
 * exactly like a drag on the handle.
 *
 * Both renderers had half of it: `@gjsify/adwaita-web` emitted only from the
 * checkbox's `change` event, which the DOM does not fire for a programmatic
 * `.checked =`, so `row.active = true` was silent; `@gjsify/adwaita-nativescript`
 * re-emitted from `checkedChange`, which NS DOES fire on a programmatic write,
 * so it notified. One widget, one C source, two opposite answers.
 *
 * There is deliberately NO `interactive` flag (the `SpinState`/`ComboState`
 * shape): adding one would be an abstraction that actively contradicts C:66-77.
 */
export class SwitchRowState {
    // adw-switch-row.c:141-143 — the pspec's default is FALSE.
    private _active = false;

    /** `Adw.SwitchRow:active`. */
    get active(): boolean {
        return this._active;
    }

    /**
     * `adw_switch_row_set_active` (C:216-228). Returns whether it changed —
     * i.e. whether the renderer must emit `notify::active`. The `!!is_active`
     * normalisation is C:222.
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
     * `adw_switch_row_init` makes the row activatable and points the
     * activatable-widget at the slider (C:160-162), so an activation is
     * forwarded to the `GtkSwitch` and toggles it; the class docs state the
     * outcome directly ("When activated, the row will invert its active state.
     * The user can control the switch by activating the row or by dragging on
     * the switch handle", C:23-27). Neither port did this — the row's text was
     * dead and only the handle worked.
     *
     * Always returns `true`: inverting a boolean always changes it.
     */
    activate(): boolean {
        return this.setActive(!this._active);
    }
}

// ---------------------------------------------------------------------------
// Adw.ButtonRow
// ---------------------------------------------------------------------------

/**
 * `Adw.ButtonRow` is ALWAYS activatable — `<property name="activatable">True
 * </property>` in the template (adw-button-row.ui:5), with no setter, no
 * property and the class documentation saying so in one line
 * ("`AdwButtonRow` is always activatable.", adw-button-row.c:31).
 *
 * Exported as data because the browser renderer had INVENTED an
 * `activatable="false"` opt-out, and a passing test pinned it.
 */
export const BUTTON_ROW_ACTIVATABLE = true;

/** Everything a renderer needs to paint an `Adw.ButtonRow`. */
export interface ButtonRowRenderState {
    /** `AdwPreferencesRow:title` — `''` when unset. */
    title: string;
    /** `string_is_not_empty(title)` — adw-button-row.ui:34-38. */
    titleVisible: boolean;
    /** `AdwButtonRow:start-icon-name` — `''` when unset (C:209-210). */
    startIconName: string;
    /** `string_is_not_empty(start_image.icon-name)` — adw-button-row.ui:20-24. */
    startIconVisible: boolean;
    /** `AdwButtonRow:end-icon-name` — `''` when unset (C:221-222). */
    endIconName: string;
    /** `string_is_not_empty(end_image.icon-name)` — adw-button-row.ui:55-59. */
    endIconVisible: boolean;
    /** Always {@link BUTTON_ROW_ACTIVATABLE}. */
    activatable: true;
}

/**
 * `Adw.ButtonRow`: a centered title between two optional symbolic icons.
 *
 * The second icon is the lift: `AdwButtonRow:end-icon-name` (C:213-223, with
 * `adw_button_row_set_end_icon_name` at C:342-352 and the image bound at
 * adw-button-row.ui:52-65) has existed since libadwaita 1.6 and neither renderer
 * had it — so the "Open in Files ›" shape that the property exists for could not
 * be expressed at all.
 *
 * Both icon setters go through `g_set_str`, which returns FALSE for an unchanged
 * value and thereby gates the notify (C:309-312, C:348-351). `g_set_str (&s,
 * NULL)` stores NULL, but every read is `string_is_not_empty`-guarded and the
 * pspec default is `""`, so `''` is the faithful TS spelling of both.
 */
export class ButtonRowState {
    private _title = '';
    // adw_button_row_init (C:255-256) seeds both to "" rather than NULL.
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

    /** `adw_button_row_set_start_icon_name` (C:303-313). Returns whether it changed. */
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

    /** `adw_button_row_set_end_icon_name` (C:342-352). Returns whether it changed. */
    setEndIconName(iconName: string | null | undefined): boolean {
        const next = iconName ?? '';
        if (next === this._endIconName) return false;
        this._endIconName = next;
        return true;
    }
}

// ---------------------------------------------------------------------------
// Adw.WindowTitle
// ---------------------------------------------------------------------------

/** Everything a renderer needs to paint an `Adw.WindowTitle`. */
export type WindowTitleRenderState = AdwRowLabels;

/**
 * `Adw.WindowTitle`: the same two labels, one level out of the boxed list.
 *
 * Three rules, two lines each, and neither renderer had any of them: the TITLE
 * label is hidden when the title is empty (C:207-208 — the `.ui` even starts it
 * `visible=False`, adw-window-title.ui:15), a set to the CURRENT value returns
 * early (C:203-204, C:244-245), and a real change notifies (C:210, C:251).
 *
 * DIVERGENCE, deliberate: setting `null` over an already-empty value does NOT
 * notify here, where libadwaita does. Its guard is `g_strcmp0 (gtk_label_get_label
 * (…), title)` and `gtk_label_get_label` never returns NULL, so `g_strcmp0 ("",
 * NULL)` is 1 — the early return is skipped, the label is re-set to the same
 * `""`, and `notify::title` fires for a no-op. That is an artefact of a
 * NULL-vs-`""` pointer comparison, not a designed behaviour; both renderers
 * carry `null` for "attribute absent" and `''` for `title=""`, and emitting a
 * change notification for the difference between them would be noise. The
 * normalisation happens BEFORE the comparison, and `WINDOW_TITLE_VECTORS` pins
 * the divergence rather than hiding it.
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

    /** `adw_window_title_set_title` (C:197-211). Returns whether it changed. */
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

    /** `adw_window_title_set_subtitle` (C:238-252). Returns whether it changed. */
    setSubtitle(subtitle: string | null | undefined): boolean {
        const next = subtitle ?? '';
        if (next === this._subtitle) return false;
        this._subtitle = next;
        return true;
    }
}
