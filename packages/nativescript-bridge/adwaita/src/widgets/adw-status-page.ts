// AdwStatusPage — a Libadwaita-style empty-state page for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` centering a vertical stack of: an
// optional icon `Label` (emoji/symbol glyph), a bold `title` `Label`, a dim
// `description` `Label`, and an optional child widget (e.g. an action button).
// Mirrors `Adw.StatusPage`: `iconText`, `title`, `description`, `setChild()`.
//
// FIDELITY: approximated for the icon. `Adw.StatusPage` shows a large symbolic
// icon from the icon theme; NS has no icon-theme lookup in this CSS subset, so the
// icon is a large glyph `Label` (`iconText` — pass an emoji or a font glyph). The
// centered title/description/child layout is otherwise faithful.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-status-page`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_status-page.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, Label, StackLayout, View } from '@nativescript/core';

export class AdwStatusPage extends GridLayout {
    /** The centered vertical stack. */
    protected readonly _stack: StackLayout;
    /** The large icon glyph label (lazily in the tree — only when set). */
    protected readonly _iconLabel: Label;
    /** The bold title label. */
    protected readonly _titleLabel: Label;
    /** The dim description label (lazily in the tree — only when set). */
    protected readonly _descriptionLabel: Label;
    private _hasIcon = false;
    private _hasDescription = false;
    private _child: View | null = null;

    constructor() {
        super();

        this.className = 'adw-status-page';
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'star'));

        const stack = new StackLayout();
        stack.orientation = 'vertical';
        stack.className = 'adw-status-page-content';
        stack.horizontalAlignment = 'center';
        stack.verticalAlignment = 'middle';
        GridLayout.setColumn(stack, 0);
        GridLayout.setRow(stack, 0);
        this.addChild(stack);
        this._stack = stack;

        const iconLabel = new Label();
        iconLabel.className = 'adw-status-page-icon';
        iconLabel.horizontalAlignment = 'center';
        this._iconLabel = iconLabel;

        const titleLabel = new Label();
        titleLabel.className = 'adw-status-page-title';
        titleLabel.horizontalAlignment = 'center';
        titleLabel.textWrap = true;
        stack.addChild(titleLabel);
        this._titleLabel = titleLabel;

        const descriptionLabel = new Label();
        descriptionLabel.className = 'adw-status-page-description';
        descriptionLabel.horizontalAlignment = 'center';
        descriptionLabel.textWrap = true;
        this._descriptionLabel = descriptionLabel;
    }

    /**
     * A large glyph shown above the title (emoji or font glyph). Setting a
     * non-empty value inserts the icon label at the top of the stack; empty
     * removes it. (`Adw.StatusPage` uses a themed icon; the NS subset has no
     * icon-theme lookup, so a glyph label stands in.)
     */
    get iconText(): string {
        return this._hasIcon ? (this._iconLabel.text ?? '') : '';
    }

    set iconText(value: string) {
        const text = value ?? '';
        this._iconLabel.text = text;
        const want = text.length > 0;
        if (want && !this._hasIcon) {
            // Icon goes ABOVE the title (index 0).
            this._stack.removeChild(this._titleLabel);
            if (this._hasDescription) this._stack.removeChild(this._descriptionLabel);
            this._stack.addChild(this._iconLabel);
            this._stack.addChild(this._titleLabel);
            if (this._hasDescription) this._stack.addChild(this._descriptionLabel);
            this._hasIcon = true;
        } else if (!want && this._hasIcon) {
            this._stack.removeChild(this._iconLabel);
            this._hasIcon = false;
        }
    }

    /** The page title (bold, centered). */
    get title(): string {
        return this._titleLabel.text ?? '';
    }

    set title(value: string) {
        this._titleLabel.text = value ?? '';
    }

    /**
     * The dim description below the title. Setting a non-empty value adds it;
     * empty removes it — so a descriptionless page has no blank gap.
     */
    get description(): string {
        return this._hasDescription ? (this._descriptionLabel.text ?? '') : '';
    }

    set description(value: string) {
        const text = value ?? '';
        this._descriptionLabel.text = text;
        const want = text.length > 0;
        if (want && !this._hasDescription) {
            // Description goes after the title, before any child.
            if (this._child) this._stack.removeChild(this._child);
            this._stack.addChild(this._descriptionLabel);
            if (this._child) this._stack.addChild(this._child);
            this._hasDescription = true;
        } else if (!want && this._hasDescription) {
            this._stack.removeChild(this._descriptionLabel);
            this._hasDescription = false;
        }
    }

    /** Set (or replace) the optional child widget below the description. */
    setChild(view: View | null): void {
        if (this._child) {
            this._stack.removeChild(this._child);
            this._child = null;
        }
        if (view) {
            view.className = `${view.className ?? ''} adw-status-page-child`.trim();
            view.horizontalAlignment = 'center';
            this._stack.addChild(view);
            this._child = view;
        }
    }

    /** The currently-installed child, or `null`. */
    get child(): View | null {
        return this._child;
    }
}
