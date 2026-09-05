// AdwButtonContent — a Libadwaita-style icon+label content for NativeScript.
//
// Renders a REAL NativeScript horizontal `StackLayout` with a leading
// {@link GtkImage} (a native-rasterised Adwaita symbolic icon) and a text `Label`,
// meant to be placed as the child content of a button (or as the label widget of
// an {@link AdwSplitButton}). Mirrors `Adw.ButtonContent`: `icon` + `label`,
// `useUnderline`, `canShrink`, plus `iconColor` so the icon can match the
// button's foreground (e.g. white on a `suggested-action` button).
//
// The derivations are headless in `@gjsify/adwaita-core` (ADR 0004), reached through
// `button-content.ts`. `AdwButtonContent` puts `image-text-button` on the button hosting
// it and removes it on unroot; the stylesheet gives that class 9px horizontal padding
// where a plain text button has 17px.
//
// NS has no rooting protocol, so the class goes on whatever
// {@link AdwButtonContent.hostButton} is set to — the seam the C gets for free from
// `gtk_widget_get_ancestor` plus the `AdwSplitButton` retarget. A caller that composes
// the button knows which view plays that role; core holds the retarget RULE
// (`buttonContentStyleTargetIndex`) for a renderer that can walk its own tree.
//
// Reference: refs/libadwaita/src/adw-button-content.c (AdwButtonContent)
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Label, StackLayout, type View } from '@nativescript/core';
import { ADW_BUTTON_CONTENT_DEFAULTS } from '@gjsify/adwaita-core';
import type { AdwButtonContentProps, ButtonContentEllipsize } from '@gjsify/adwaita-core';
import { GtkImage } from './gtk-image.js';
import {
    buttonContentClassName,
    buttonContentEllipsize,
    buttonContentIconIsFallback,
    buttonContentIconSvg,
    buttonContentLabelText,
    buttonContentLabelVisibility,
    buttonContentRootedParentClassName,
    buttonContentUnrootedParentClassName,
} from './button-content.js';
import { xmlBoolean } from './xml-values.js';

/** The content's own base class, before `can-shrink` adds its own. */
const BASE_CLASS = 'adw-button-content';

export class AdwButtonContent extends StackLayout {
    /** The leading symbolic icon. Always parented — the C never hides the image. */
    protected readonly _icon: GtkImage;
    /** The text label. */
    protected readonly _label: Label;
    private readonly _props: AdwButtonContentProps = { ...ADW_BUTTON_CONTENT_DEFAULTS };
    private _hostButton: View | null = null;

    constructor() {
        super();

        this.orientation = 'horizontal';
        this.className = BASE_CLASS;
        this.horizontalAlignment = 'center';

        const icon = new GtkImage();
        icon.className = `${icon.className} adw-button-content-icon`.trim();
        icon.verticalAlignment = 'middle';
        icon.iconName = buttonContentIconSvg('');
        this.addChild(icon);
        this._icon = icon;

        const label = new Label();
        label.className = 'adw-button-content-label';
        label.verticalAlignment = 'middle';
        // The label starts hidden — `gtk_widget_set_visible (self->label, FALSE)`
        // in init (:300), because the default label is empty (:239-242).
        label.visibility = buttonContentLabelVisibility('');
        this.addChild(label);
        this._label = label;
    }

    /**
     * The button view this content styles — NS's stand-in for the `GtkButton`
     * ancestor `adw_button_content_root` finds (:108).
     *
     * Setting it adds `image-text-button` (:115); clearing it, or replacing it,
     * removes the class from the previous host first (:126), so a button that
     * loses its content goes back to plain-button padding.
     */
    get hostButton(): View | null {
        return this._hostButton;
    }

    set hostButton(view: View | null) {
        if (this._hostButton === view) return;
        if (this._hostButton) {
            this._hostButton.className = buttonContentUnrootedParentClassName(this._hostButton.className ?? '');
        }
        this._hostButton = view;
        if (view) view.className = buttonContentRootedParentClassName(view.className ?? '');
    }

    /**
     * A leading Adwaita symbolic SVG string (e.g. `folderDownloadSymbolic`).
     *
     * An empty value shows the `image-missing` asset rather than hiding the icon:
     * the C sets that fallback (:355-356) and never hides `self->icon`. The doc
     * comments at :228/:343 say otherwise — see `buttonContentIconSvg`.
     */
    get iconName(): string {
        return this._props.iconName;
    }

    set iconName(svg: string) {
        this._props.iconName = svg ?? '';
        this._icon.iconName = buttonContentIconSvg(this._props.iconName);
    }

    /** Whether the icon currently shown is the empty-slot fallback. */
    get iconIsFallback(): boolean {
        return buttonContentIconIsFallback(this._props.iconName);
    }

    /** The icon fill colour (hex). Set to the button's foreground (e.g. white on suggested-action). */
    get iconColor(): string {
        return this._icon.iconColor;
    }

    set iconColor(value: string) {
        this._icon.iconColor = value;
    }

    /** The button content text. Empty collapses the label view (:398). */
    get label(): string {
        return this._props.label;
    }

    set label(value: string) {
        this._props.label = value ?? '';
        this._renderLabel();
    }

    /**
     * Whether an underline in {@link label} marks a mnemonic (:431-445).
     * Defaults to FALSE (:253-256), so an underscore is a literal unless asked.
     */
    get useUnderline(): boolean {
        return this._props.useUnderline;
    }

    set useUnderline(raw: boolean | string) {
        const value = xmlBoolean(raw, this.useUnderline);
        this._props.useUnderline = !!value;
        this._renderLabel();
    }

    /**
     * Whether the label may be smaller than its natural size (:489-491).
     *
     * FIDELITY GAP: this is `PANGO_ELLIPSIZE_END` in GTK and the NS CSS subset
     * has no ellipsize, so the property is held, reported through
     * {@link ellipsize}, and reflected as a `can-shrink` class for the theme —
     * but the truncation ellipsis is not available on this platform.
     */
    get canShrink(): boolean {
        return this._props.canShrink;
    }

    set canShrink(raw: boolean | string) {
        const value = xmlBoolean(raw, this.canShrink);
        this._props.canShrink = !!value;
        this.className = buttonContentClassName(this.className, this._props.canShrink);
    }

    /** The label's `PangoEllipsizeMode` for the current `canShrink` (:462). */
    get ellipsize(): ButtonContentEllipsize {
        return buttonContentEllipsize(this._props.canShrink);
    }

    private _renderLabel(): void {
        this._label.text = buttonContentLabelText(this._props.label, this._props.useUnderline);
        this._label.visibility = buttonContentLabelVisibility(this._props.label);
    }
}
