// AdwStatusPage — a Libadwaita-style empty-state page for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` centering a vertical stack of: an
// optional icon (a symbolic SVG via {@link AdwIcon}, or a glyph `Label`), a bold
// `title` `Label`, a dim `description` `Label`, and an optional child widget
// (e.g. an action button). Mirrors `Adw.StatusPage`: `icon`, `iconText`, `title`,
// `description`, `setChild()`.
//
// The stack is BUILT ONCE and its parts are shown or hidden, exactly as the
// upstream template does it — every part binds its `visible` to a closure over
// the property that feeds it (adw-status-page.ui:23-28, :41-46, :57-62), and the
// predicates live in `status-page-content.ts`. The port used to add and remove
// nodes instead, re-stacking the whole content to keep the icon at the top, and
// it still left an EMPTY title in the tree — so a status page with only a
// description opened with a blank line above it.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-status-page`.
// Reference: refs/libadwaita/src/adw-status-page.c (:83-96)
// Reference: refs/libadwaita/src/adw-status-page.ui
// Reference: refs/libadwaita/src/stylesheet/widgets/_misc.scss (AdwStatusPage)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { View } from '@nativescript/core';
import { GridLayout, ItemSpec, Label, StackLayout } from '@nativescript/core';
import { AdwIcon } from './adw-icon.js';
import { statusPageIconVisibility, statusPageLabelVisibility } from './status-page-content.js';

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
    /** The bold title label. */
    protected readonly _titleLabel: Label;
    /** The dim description label. */
    protected readonly _descriptionLabel: Label;
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

        // The order is the template's and it is fixed for the life of the widget:
        // icon, title, description, then the optional child. Nothing is ever
        // re-stacked, so nothing can end up in the wrong place.
        // Every part starts empty, and its own predicate says an empty part is not
        // in the layout — so the page opens as a bare centered stack, not as three
        // blank lines waiting to be filled.
        const icon = new AdwIcon();
        icon.className = `${icon.className} adw-status-page-icon`.trim();
        icon.horizontalAlignment = 'center';
        icon.iconColor = DEFAULT_STATUS_ICON_COLOR;
        icon.iconSize = DEFAULT_STATUS_ICON_SIZE;
        icon.visibility = statusPageIconVisibility(this._iconSvg);
        this._icon = icon;

        const iconLabel = new Label();
        iconLabel.className = 'adw-status-page-icon-glyph';
        iconLabel.horizontalAlignment = 'center';
        iconLabel.visibility = statusPageIconVisibility(this._iconGlyph);
        this._iconLabel = iconLabel;

        const titleLabel = new Label();
        titleLabel.className = 'adw-status-page-title';
        titleLabel.horizontalAlignment = 'center';
        titleLabel.textWrap = true;
        titleLabel.visibility = statusPageLabelVisibility(titleLabel.text);
        this._titleLabel = titleLabel;

        const descriptionLabel = new Label();
        descriptionLabel.className = 'adw-status-page-description';
        descriptionLabel.horizontalAlignment = 'center';
        descriptionLabel.textWrap = true;
        descriptionLabel.visibility = statusPageLabelVisibility(descriptionLabel.text);
        this._descriptionLabel = descriptionLabel;

        for (const part of [icon, iconLabel, titleLabel, descriptionLabel]) stack.addChild(part);
    }

    /**
     * A large Adwaita symbolic SVG string shown above the title (e.g.
     * `folderSymbolic`). Setting a non-empty value shows the symbolic icon; empty
     * hides it. Matches `Adw.StatusPage`'s themed icon. Mutually exclusive with
     * {@link iconText} — whichever was set last wins.
     */
    get iconName(): string {
        return this._iconSvg;
    }

    set iconName(value: string) {
        this._iconSvg = value ?? '';
        this._icon.iconName = this._iconSvg;
        this._icon.visibility = statusPageIconVisibility(this._iconSvg);
        // Last one set wins: showing the SVG hides the glyph, and clearing it
        // leaves the page with no icon rather than falling back to a stale glyph.
        this._iconLabel.visibility = 'collapse';
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
        this._iconLabel.visibility = statusPageIconVisibility(this._iconGlyph);
        this._icon.visibility = 'collapse';
    }

    /** The icon fill colour (hex). Defaults to a dim grey; light/dark callers may override. */
    get iconColor(): string {
        return this._icon.iconColor;
    }

    set iconColor(value: string) {
        this._icon.iconColor = value;
    }

    /** The page title (bold, centered). An empty title takes no space. */
    get title(): string {
        return this._titleLabel.text ?? '';
    }

    set title(value: string) {
        const text = value ?? '';
        this._titleLabel.text = text;
        this._titleLabel.visibility = statusPageLabelVisibility(text);
    }

    /**
     * The dim description below the title. An empty description takes no space,
     * so a descriptionless page has no blank gap.
     */
    get description(): string {
        return this._descriptionLabel.text ?? '';
    }

    set description(value: string) {
        const text = value ?? '';
        this._descriptionLabel.text = text;
        this._descriptionLabel.visibility = statusPageLabelVisibility(text);
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

    /**
     * The one destination an XML child can have: the slot under the description,
     * where `AdwStatusPage:child` goes. The name is ignored because
     * `<AdwStatusPage.child>` and a bare child mean the same thing — the shape
     * `AdwClamp` already has.
     */
    _addChildFromBuilder(_name: string, view: View): void {
        this.setChild(view);
    }
}
