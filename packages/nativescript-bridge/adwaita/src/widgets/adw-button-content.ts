// AdwButtonContent — a Libadwaita-style icon+label content for NativeScript.
//
// Renders a REAL NativeScript horizontal `StackLayout` with a leading
// {@link AdwIcon} (a native-rasterised Adwaita symbolic icon) and a text `Label`,
// meant to be placed as the child content of a button (or used as the label
// widget of an {@link AdwSplitButton}). Mirrors `Adw.ButtonContent`: an `icon`
// symbolic + a `label`, with `iconColor` so the icon can match the button's
// foreground (e.g. white on a `suggested-action` button).
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-button-content`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss (.button .content)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Label, StackLayout } from '@nativescript/core';
import { AdwIcon } from './adw-icon.js';

export class AdwButtonContent extends StackLayout {
    /** The leading symbolic icon (lazily in the tree — only when an icon is set). */
    protected readonly _icon: AdwIcon;
    /** The text label. */
    protected readonly _label: Label;
    private _hasIcon = false;
    private _iconSvg = '';

    constructor() {
        super();

        this.orientation = 'horizontal';
        this.className = 'adw-button-content';
        this.horizontalAlignment = 'center';

        const icon = new AdwIcon();
        icon.className = `${icon.className} adw-button-content-icon`.trim();
        icon.verticalAlignment = 'middle';
        this._icon = icon;

        const label = new Label();
        label.className = 'adw-button-content-label';
        label.verticalAlignment = 'middle';
        this.addChild(label);
        this._label = label;
    }

    /**
     * A leading Adwaita symbolic SVG string (e.g. `folderDownloadSymbolic`).
     * Setting a non-empty value inserts the icon before the label; empty removes it.
     */
    get icon(): string {
        return this._iconSvg;
    }

    set icon(svg: string) {
        this._iconSvg = svg ?? '';
        this._icon.icon = this._iconSvg;
        const want = this._iconSvg.length > 0;
        if (want && !this._hasIcon) {
            this.removeChild(this._label);
            this.addChild(this._icon);
            this.addChild(this._label);
            this._hasIcon = true;
        } else if (!want && this._hasIcon) {
            this.removeChild(this._icon);
            this._hasIcon = false;
        }
    }

    /** The icon fill colour (hex). Set to the button's foreground (e.g. white on suggested-action). */
    get iconColor(): string {
        return this._icon.iconColor;
    }

    set iconColor(value: string) {
        this._icon.iconColor = value;
    }

    /** The button content text. */
    get label(): string {
        return this._label.text ?? '';
    }

    set label(value: string) {
        this._label.text = value ?? '';
    }
}
