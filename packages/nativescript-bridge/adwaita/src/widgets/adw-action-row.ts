// AdwActionRow — a Libadwaita-style action row for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` (columns `*, auto`): a title+subtitle
// `Label` stack in column 0 and a suffix slot in column 1. Styled to look like
// `Adw.ActionRow` via the `adw-row adw-action-row` CSS classes (see
// `src/theme/adwaita.css`) — NOT a webview.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-action-row` / `_row.scss`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_action-row.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, StackLayout, Label, View } from '@nativescript/core';

export class AdwActionRow extends GridLayout {
    /** The text/value column (column 0). */
    protected readonly _textStack: StackLayout;
    /** The title label. */
    protected readonly _titleLabel: Label;
    /** The subtitle label (created lazily — only added to the tree when set). */
    protected readonly _subtitleLabel: Label;
    private _hasSubtitle = false;
    /** The currently-installed suffix view (column 1), if any. */
    private _suffix: View | null = null;

    constructor() {
        super();

        this.className = 'adw-row adw-action-row';

        // Columns: `*, auto` — text expands, suffix hugs its content.
        this.addColumn(new ItemSpec(1, 'star'));
        this.addColumn(new ItemSpec(1, 'auto'));
        this.addRow(new ItemSpec(1, 'auto'));

        // Column 0: a vertical stack holding title (+ optional subtitle).
        const textStack = new StackLayout();
        textStack.orientation = 'vertical';
        textStack.className = 'adw-row-text';
        GridLayout.setColumn(textStack, 0);

        const titleLabel = new Label();
        titleLabel.className = 'adw-row-title';
        titleLabel.textWrap = true;
        textStack.addChild(titleLabel);

        const subtitleLabel = new Label();
        subtitleLabel.className = 'adw-row-subtitle';
        subtitleLabel.textWrap = true;

        this.addChild(textStack);

        this._textStack = textStack;
        this._titleLabel = titleLabel;
        this._subtitleLabel = subtitleLabel;
    }

    /** The row title (column 0, top line). */
    get title(): string {
        return this._titleLabel.text ?? '';
    }

    set title(value: string) {
        this._titleLabel.text = value ?? '';
    }

    /**
     * The row subtitle (column 0, dim second line). Setting a non-empty value
     * adds the subtitle label to the tree; setting empty removes it again so an
     * empty subtitle leaves no blank gap — matching `Adw.ActionRow`.
     */
    get subtitle(): string {
        return this._hasSubtitle ? (this._subtitleLabel.text ?? '') : '';
    }

    set subtitle(value: string) {
        const text = value ?? '';
        this._subtitleLabel.text = text;
        const wantSubtitle = text.length > 0;
        if (wantSubtitle && !this._hasSubtitle) {
            this._textStack.addChild(this._subtitleLabel);
            this._hasSubtitle = true;
        } else if (!wantSubtitle && this._hasSubtitle) {
            this._textStack.removeChild(this._subtitleLabel);
            this._hasSubtitle = false;
        }
    }

    /**
     * Install a suffix widget in column 1 (e.g. a `Switch`, `Button`, or icon).
     * Replaces any previously-installed suffix. Pass `null` to clear it.
     */
    setSuffix(view: View | null): void {
        if (this._suffix) {
            this.removeChild(this._suffix);
            this._suffix = null;
        }
        if (view) {
            view.className = `${view.className ?? ''} adw-row-suffix`.trim();
            GridLayout.setColumn(view, 1);
            this.addChild(view);
            this._suffix = view;
        }
    }

    /** The currently-installed suffix view, or `null`. */
    get suffix(): View | null {
        return this._suffix;
    }
}
