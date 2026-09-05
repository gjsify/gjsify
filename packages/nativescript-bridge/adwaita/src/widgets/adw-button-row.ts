// AdwButtonRow — a Libadwaita-style button row for NativeScript.
//
// Extends {@link AdwActionRow}: a boxed-list row that is itself tappable, with a
// centered/accent title between an optional leading glyph and an optional
// trailing one. Mirrors `Adw.ButtonRow`: the whole row acts as a button,
// emitting `activated` (the Adw signal) on tap. Use inside an
// {@link AdwPreferencesGroup} like any other row.
//
// FIDELITY: faithful. The row is a real tappable `GridLayout`; the centered accent
// label matches `Adw.ButtonRow`'s default. Both icons are REAL Adwaita symbolic
// icons ({@link GtkImage}, accent-coloured to match the title).
//
// The title/icon visibility rules are HEADLESS and live in
// `@gjsify/adwaita-core` (ADR 0004) as `ButtonRowState`, shared with
// `@gjsify/adwaita-web`. What this closes: `Adw.ButtonRow:end-icon-name`
// (adw-button-row.c:213-223, bound at adw-button-row.ui:52-65) has existed since
// libadwaita 1.6 and neither renderer had it, so a trailing chevron could only be
// faked with a suffix widget the widget does not have. The row is also
// unconditionally activatable, which is what `Adw.ButtonRow` is
// (adw-button-row.ui:5; "AdwButtonRow is always activatable.", C:31).
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-button-row`.
// Reference: refs/libadwaita/src/adw-button-row.c, adw-button-row.ui
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss (.row.button)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { StackLayout } from '@nativescript/core';
import { adwaitaAccent, onAdwaitaAccentChanged } from '@gjsify/adwaita-core';
import { AdwActionRow } from './adw-action-row.js';
import { GtkImage } from './gtk-image.js';
import { attachRowPressFeedback } from './row-press.js';
import { ButtonRowState, buttonRowIconColor, buttonRowIconVisuals } from './row-state.js';

/** Event name emitted when the row is tapped. Mirrors `Adw.ButtonRow::activated`. */
export { ACTIVATED } from './adw-action-row.js';

export class AdwButtonRow extends AdwActionRow {
    /** `AdwButtonRow` derives from `AdwPreferencesRow` in C
     *  (adw-button-row.c:74), so the search does not consult a subtitle here. */
    override readonly isActionRow: boolean = false;

    /** The horizontal content box (leading icon + centered title + trailing icon). */
    protected readonly _contentBox: StackLayout;
    /** The leading symbolic icon. */
    protected readonly _startIcon: GtkImage;
    /** The trailing symbolic icon. */
    protected readonly _endIcon: GtkImage;
    /** An explicit icon fill (the destructive red), or `null` to follow the accent. */
    private _pinnedIconColor: string | null = null;
    /** Live accent subscription — held only while the row is on screen. */
    private _unsubAccent: (() => void) | null = null;
    /**
     * The headless start/end icon state (ADR 0004).
     *
     * ICONS ONLY. `ButtonRowState` also carries the title, and the browser
     * renderer uses that half — but here the title is the action row's inherited
     * `Label`, painted from the action row's own state, and feeding it into a
     * second state object would give one label two sources of truth.
     */
    private readonly _buttonState = new ButtonRowState();

    constructor() {
        super();

        this.className = 'adw-row adw-action-row adw-button-row';

        // Replace the inherited title stack content presentation: present a
        // centered content box in place of the plain title label. We reuse the
        // inherited `_titleLabel` as the accent text.
        this._titleLabel.className = 'adw-button-row-title';
        this._titleLabel.horizontalAlignment = 'center';

        // Wrap the inherited title label inside a horizontal box so the optional
        // glyphs can sit either side of it, all centered.
        this._textStack.removeChild(this._titleLabel);
        const contentBox = new StackLayout();
        contentBox.orientation = 'horizontal';
        contentBox.className = 'adw-button-row-content';
        contentBox.horizontalAlignment = 'center';

        this._startIcon = AdwButtonRow._makeIcon('adw-button-row-start-icon');
        this._endIcon = AdwButtonRow._makeIcon('adw-button-row-end-icon');
        this._applyIconColor();

        // Follow a runtime accent change while on screen. The title is a `Label`
        // and the generated override repaints it through CSS; these two are
        // pre-coloured bitmaps, so nothing but this re-render can move them —
        // they stayed the constructor's blue on an orange page. Subscribed on
        // load and dropped on unload, as `GtkImage` does for the colour scheme.
        this.addEventListener('loaded', () => {
            this._applyIconColor();
            this._unsubAccent ??= onAdwaitaAccentChanged(() => this._applyIconColor());
        });
        this.addEventListener('unloaded', () => {
            this._unsubAccent?.();
            this._unsubAccent = null;
        });

        // Fixed child order — start icon, title, end icon — with the icons
        // collapsed when empty. The old port re-ordered children on every icon
        // change, which is what made a SECOND icon awkward enough to skip.
        contentBox.addChild(this._startIcon);
        contentBox.addChild(this._titleLabel);
        contentBox.addChild(this._endIcon);
        this._textStack.addChild(contentBox);
        this._textStack.horizontalAlignment = 'center';
        this._contentBox = contentBox;

        // `Adw.ButtonRow` is always activatable — there is no opt-out to model.
        this.activatable = true;
        this._applyIcons();

        // …and darkens on press, like an Adwaita `.button` row.
        attachRowPressFeedback(this);
    }

    /** A centered symbolic icon, collapsed until it has content. Its fill is set by
     *  {@link _applyIconColor}, which is also what follows an accent change. */
    private static _makeIcon(className: string): GtkImage {
        const icon = new GtkImage();
        icon.className = `${icon.className} ${className}`.trim();
        icon.verticalAlignment = 'middle';
        return icon;
    }

    /**
     * A leading Adwaita symbolic SVG string before the centered title (e.g.
     * `listAddSymbolic`). Empty collapses the icon.
     */
    get startIconName(): string {
        return this._buttonState.startIconName;
    }

    set startIconName(value: string) {
        if (this._buttonState.setStartIconName(value)) this._applyIcons();
    }

    /**
     * A trailing Adwaita symbolic SVG string after the centered title (e.g.
     * `goNextSymbolic`) — `Adw.ButtonRow:end-icon-name`. Empty collapses it.
     */
    get endIconName(): string {
        return this._buttonState.endIconName;
    }

    set endIconName(value: string) {
        if (this._buttonState.setEndIconName(value)) this._applyIcons();
    }

    /**
     * The icons' fill colour (hex). Defaults to the Adwaita accent; callers set
     * the destructive red when the row carries `destructive-action` so the
     * symbolic icons match the title colour (the icon bitmap is pre-coloured, so
     * CSS cannot recolour it).
     */
    get startIconColor(): string {
        return this._startIcon.iconColor;
    }

    set startIconColor(value: string) {
        // An empty value RELEASES the pin, so the row goes back to following the
        // accent rather than freezing on whatever blue was current when it was set.
        this._pinnedIconColor = value || null;
        this._applyIconColor();
    }

    /** Paint both icons in the pinned colour, or in the active accent's fill. */
    private _applyIconColor(): void {
        const color = buttonRowIconColor(this._pinnedIconColor, adwaitaAccent());
        this._startIcon.iconColor = color;
        this._endIcon.iconColor = color;
    }

    /** Push the derived icon payload + visibility onto the two `GtkImage`s. */
    private _applyIcons(): void {
        const visuals = buttonRowIconVisuals(this._buttonState.state);
        this._startIcon.iconName = visuals.startIcon;
        this._startIcon.visibility = visuals.startIconVisibility;
        this._endIcon.iconName = visuals.endIcon;
        this._endIcon.visibility = visuals.endIconVisibility;
    }
}
