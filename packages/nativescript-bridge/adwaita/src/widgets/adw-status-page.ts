// AdwStatusPage — a Libadwaita-style empty-state page for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` centering a vertical stack of: an
// optional icon `Label` (emoji/symbol glyph), a bold `title` `Label`, a dim
// `description` `Label`, and an optional child widget (e.g. an action button).
// Mirrors `Adw.StatusPage`: `iconText`, `title`, `description`, `setChild()`.
//
// The icon is a REAL Adwaita symbolic icon (`icon` — a symbolic SVG string),
// rendered large + dim by an {@link AdwIcon} (native PathParser rasteriser),
// matching `Adw.StatusPage`'s themed empty-state icon. The centered
// title/description/child layout is faithful too.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-status-page`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_status-page.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, Label, StackLayout, View } from '@nativescript/core';
import { AdwIcon } from './adw-icon.js';

/** Default status-page icon size (DIPs) — Adw.StatusPage shows a large glyph. */
const DEFAULT_STATUS_ICON_SIZE = 96;
/** Default dim icon colour — Adw.StatusPage dims the empty-state icon. */
const DEFAULT_STATUS_ICON_COLOR = '#9b9b9b';

export class AdwStatusPage extends GridLayout {
    /** The centered vertical stack. */
    protected readonly _stack: StackLayout;
    /** The large symbolic icon (shown when an `icon` SVG is set). */
    protected readonly _icon: AdwIcon;
    private _iconSvg = '';
    /** The large glyph label (shown when `iconText` is set — the legacy fallback). */
    protected readonly _iconLabel: Label;
    private _iconGlyph = '';
    /** The icon node currently in the stack (the AdwIcon or the glyph Label), or null. */
    private _iconNode: View | null = null;
    /** The bold title label. */
    protected readonly _titleLabel: Label;
    /** The dim description label (lazily in the tree — only when set). */
    protected readonly _descriptionLabel: Label;
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

        const icon = new AdwIcon();
        icon.className = `${icon.className} adw-status-page-icon`.trim();
        icon.horizontalAlignment = 'center';
        icon.iconColor = DEFAULT_STATUS_ICON_COLOR;
        icon.iconSize = DEFAULT_STATUS_ICON_SIZE;
        this._icon = icon;

        const iconLabel = new Label();
        iconLabel.className = 'adw-status-page-icon-glyph';
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
     * A large Adwaita symbolic SVG string shown above the title (e.g.
     * `folderSymbolic`). Setting a non-empty value shows the symbolic icon; empty
     * removes it. Matches `Adw.StatusPage`'s themed icon. Mutually exclusive with
     * {@link iconText} — whichever was set last wins.
     */
    get icon(): string {
        return this._iconSvg;
    }

    set icon(value: string) {
        this._iconSvg = value ?? '';
        this._icon.icon = this._iconSvg;
        this._setIconNode(this._iconSvg.length > 0 ? this._icon : null);
    }

    /**
     * A large glyph shown above the title (emoji / font glyph — the legacy
     * fallback for callers that have no symbolic SVG). Mutually exclusive with
     * {@link icon}; prefer `icon` for real Adwaita symbolics.
     */
    get iconText(): string {
        return this._iconGlyph;
    }

    set iconText(value: string) {
        this._iconGlyph = value ?? '';
        this._iconLabel.text = this._iconGlyph;
        this._setIconNode(this._iconGlyph.length > 0 ? this._iconLabel : null);
    }

    /** Swap the icon node at the TOP of the stack (above the title), or clear it. */
    private _setIconNode(node: View | null): void {
        if (this._iconNode === node) return;
        if (this._iconNode) this._stack.removeChild(this._iconNode);
        this._iconNode = node;
        if (!node) return;
        // Re-stack so the icon sits at index 0 (above title/description/child).
        this._stack.removeChild(this._titleLabel);
        if (this._hasDescription) this._stack.removeChild(this._descriptionLabel);
        if (this._child) this._stack.removeChild(this._child);
        this._stack.addChild(node);
        this._stack.addChild(this._titleLabel);
        if (this._hasDescription) this._stack.addChild(this._descriptionLabel);
        if (this._child) this._stack.addChild(this._child);
    }

    /** The icon fill colour (hex). Defaults to a dim grey; light/dark callers may override. */
    get iconColor(): string {
        return this._icon.iconColor;
    }

    set iconColor(value: string) {
        this._icon.iconColor = value;
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
