// AdwWindowTitle — a Libadwaita-style window title for NativeScript.
//
// Renders a REAL NativeScript vertical `StackLayout` with a centered bold title
// `Label` and an optional dim subtitle `Label`, intended as the title view of an
// `ActionBar` (the NS analogue of a GTK header bar). Mirrors `Adw.WindowTitle`:
// `title`, `subtitle` — empty subtitle leaves no gap.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `_headerbar.scss` (title bold,
// subtitle dim/smaller).
// Reference: refs/libadwaita/src/stylesheet/widgets/_header-bar.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Label, StackLayout } from '@nativescript/core';

export class AdwWindowTitle extends StackLayout {
    /** The bold title label. */
    protected readonly _titleLabel: Label;
    /** The dim subtitle label (created lazily — only in the tree when set). */
    protected readonly _subtitleLabel: Label;
    private _hasSubtitle = false;

    constructor() {
        super();

        this.orientation = 'vertical';
        this.className = 'adw-window-title';
        this.horizontalAlignment = 'center';

        const titleLabel = new Label();
        titleLabel.className = 'adw-window-title-title';
        titleLabel.horizontalAlignment = 'center';
        this.addChild(titleLabel);
        this._titleLabel = titleLabel;

        const subtitleLabel = new Label();
        subtitleLabel.className = 'adw-window-title-subtitle';
        subtitleLabel.horizontalAlignment = 'center';
        this._subtitleLabel = subtitleLabel;
    }

    /** The window title (bold, top line). */
    get title(): string {
        return this._titleLabel.text ?? '';
    }

    set title(value: string) {
        this._titleLabel.text = value ?? '';
    }

    /**
     * The subtitle (dim second line). Setting a non-empty value adds the subtitle
     * label; setting empty removes it — so an empty subtitle leaves no blank gap,
     * matching `Adw.WindowTitle`.
     */
    get subtitle(): string {
        return this._hasSubtitle ? (this._subtitleLabel.text ?? '') : '';
    }

    set subtitle(value: string) {
        const text = value ?? '';
        this._subtitleLabel.text = text;
        const wantSubtitle = text.length > 0;
        if (wantSubtitle && !this._hasSubtitle) {
            this.addChild(this._subtitleLabel);
            this._hasSubtitle = true;
        } else if (!wantSubtitle && this._hasSubtitle) {
            this.removeChild(this._subtitleLabel);
            this._hasSubtitle = false;
        }
    }
}
