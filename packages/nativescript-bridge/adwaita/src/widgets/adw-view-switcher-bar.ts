// AdwViewSwitcherBar — a Libadwaita-style bottom view-switcher bar for NativeScript.
//
// The "narrow policy" companion to {@link AdwViewSwitcher}: a full-width bar of
// evenly-distributed buttons, each showing an Adwaita symbolic icon ABOVE its
// label (the mobile/phone form), bound to an external {@link AdwViewStack} via
// the `stack` property. Because it binds to a separate stack it can sit in an
// `AdwToolbarView`'s BOTTOM slot while the stack fills the content slot — the
// canonical Adwaita phone shell.
//
// The derivations are HEADLESS in `@gjsify/adwaita-core` (ADR 0004): the per-button
// model (`buildViewSwitcherButtons`, so this bar and the header switcher cannot
// disagree about what a page looks like) and `ViewSwitcherBarState`, whose reveal rule
// is `reveal` AND MORE THAN ONE VISIBLE PAGE — a one-page stack keeps the bar
// collapsed, and `reveal` itself defaults to FALSE.
//
// The `notify::visible-child` listener is dropped on `unloaded` and re-taken on
// `loaded`, which is where C's dispose-only teardown lands in a widget that really is
// detached and re-attached.
//
// Each button is a REAL tappable `StackLayout` (icon over label); press feedback needs
// {@link attachRowPressFeedback} because NS only auto-highlights `Button`. The active
// button's label is accent-coloured via CSS while its icon stays theme-coloured — the
// CSS subset cannot recolour a rasterised icon per state without re-pinning it off the
// light/dark scheme.
//
// FIDELITY: approximated. Pages swap by `visibility` toggle in the bound stack (no
// cross-fade), and the bar rebuilds on every `notify::visible-child` plus an explicit
// `refresh()` — the NS stack has no `items-changed` for C's rebuild-on-page-add.
//
// Reference: refs/libadwaita/src/adw-view-switcher-bar.c (AdwViewSwitcherBar)
// Reference: refs/libadwaita/src/stylesheet/widgets/_view-switcher.scss (viewswitcherbar)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, Label, StackLayout } from '@nativescript/core';
import { buildViewSwitcherButtons, viewSwitcherPagesFromStack } from '@gjsify/adwaita-core';
import { GtkImage } from './gtk-image.js';
import type { AdwViewStack } from './adw-view-stack.js';
import { NOTIFY_VISIBLE_CHILD } from './adw-view-stack.js';
import { attachRowPressFeedback } from './row-press.js';
import { createViewSwitcherBarState, nsIconSvg } from './view-switcher-model.js';
import { xmlBoolean } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';

/** The per-button NS nodes, so a selection change repaints instead of rebuilding. */
interface BarButtonNodes {
    button: StackLayout;
    icon: GtkImage;
    label: Label;
    badge: Label;
}

export class AdwViewSwitcherBar extends GridLayout {
    /** The horizontal (homogeneous) row of buttons. */
    private readonly _bar: GridLayout;
    private _nodes: BarButtonNodes[] = [];
    private _stack: AdwViewStack | null = null;
    private _stackListener: (() => void) | null = null;
    private readonly _barState = createViewSwitcherBarState();

    constructor(props?: ConstructProps<AdwViewSwitcherBar>) {
        super();

        this.className = 'adw-viewswitcherbar';
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'auto'));

        const bar = new GridLayout();
        bar.className = 'adw-viewswitcherbar-box';
        bar.addRow(new ItemSpec(1, 'auto'));
        GridLayout.setRow(bar, 0);
        this.addChild(bar);
        this._bar = bar;

        this._barState.subscribe(() => this._applyRevealed());
        // `reveal` defaults to FALSE, and `adw_view_switcher_bar_init` runs the
        // derivation right away — so a bar starts COLLAPSED, not on screen.
        this._applyRevealed();

        // Re-bind on attach and release on detach: the listener used to survive
        // every detach with nothing dropping it.
        this.addEventListener('loaded', () => {
            this._bindStack();
            this._rebuild();
        });
        this.addEventListener('unloaded', () => this._unbindStack());

        applyConstructProps(this, props);
    }

    /** Bind to an {@link AdwViewStack}: build buttons from its pages + two-way sync. */
    setStack(stack: AdwViewStack | null): void {
        this._unbindStack();
        this._stack = stack;
        this._bindStack();
        this._rebuild();
    }

    /** The bound stack (`Adw.ViewSwitcherBar.stack`). */
    get stack(): AdwViewStack | null {
        return this._stack;
    }

    set stack(value: AdwViewStack | null) {
        this.setStack(value);
    }

    /**
     * Whether the layout asked for the bar — `Adw.ViewSwitcherBar:reveal`. An
     * adaptive layout sets it `true` on narrow screens and `false` on wide ones,
     * where a header-bar `AdwViewSwitcher` takes over.
     */
    get reveal(): boolean {
        return this._barState.reveal;
    }

    set reveal(raw: boolean | string) {
        const value = xmlBoolean(raw, this.reveal);
        this._barState.setReveal(value);
    }

    /**
     * Whether the bar is actually shown. READ-ONLY: a one-page stack keeps it
     * collapsed however loudly the layout asks (adw-view-switcher-bar.c:125).
     * Write {@link reveal} to make the request.
     */
    get revealed(): boolean {
        return this._barState.revealed;
    }

    /**
     * Rebuild the button row from the bound stack's pages — needed after pages
     * were added without changing the stack's selection. libadwaita rebuilds on
     * the pages model's `items-changed` (adw-view-switcher.c:258-263), which the
     * NS stack has no counterpart for.
     */
    refresh(): void {
        this._rebuild();
    }

    private _bindStack(): void {
        if (!this._stack || this._stackListener) return;
        const listener = () => this._rebuild();
        this._stack.addEventListener(NOTIFY_VISIBLE_CHILD, listener);
        this._stackListener = listener;
    }

    private _unbindStack(): void {
        if (!this._stack || !this._stackListener) return;
        this._stack.removeEventListener(NOTIFY_VISIBLE_CHILD, this._stackListener);
        this._stackListener = null;
    }

    private _rebuild(): void {
        const stackPages = this._stack?.pages ?? [];
        // The page count is half the reveal derivation, so it is fed on every
        // rebuild — `update_bar_revealed` is re-run from set_stack and from
        // items-changed for exactly this reason (:340-343, :277).
        this._barState.setPages(stackPages);

        const pages = viewSwitcherPagesFromStack(stackPages);
        const models = buildViewSwitcherButtons(pages, this._stack?.visibleChildIndex ?? -1, 'narrow');

        // Nodes are recreated only when the page COUNT moves: a selection change
        // must not replace the button under the user's finger, and
        // `selection_changed_cb` only re-marks the existing buttons
        // (adw-view-switcher.c:265-295).
        if (models.length !== this._nodes.length) {
            for (const nodes of this._nodes) this._bar.removeChild(nodes.button);
            this._nodes = [];
            this._bar.removeColumns();
            this._nodes = models.map((model, index) => {
                // Homogeneous: every button gets an equal `star` column.
                this._bar.addColumn(new ItemSpec(1, 'star'));
                return this._buildButton(model.pageIndex, index);
            });
        }

        models.forEach((model, index) => {
            const nodes = this._nodes[index];
            if (!nodes) return;
            nodes.button.visibility = model.visible ? 'visible' : 'collapse';
            nodes.button.className = model.selected
                ? 'adw-viewswitcherbar-button active'
                : 'adw-viewswitcherbar-button';
            nodes.icon.iconName = nsIconSvg(model.iconName);
            nodes.label.text = model.label;
            nodes.badge.text = model.badgeLabel;
            nodes.badge.visibility = model.badgeLabel.length > 0 || model.needsAttention ? 'visible' : 'collapse';
            nodes.badge.className =
                model.badgeLabel.length === 0 && model.needsAttention
                    ? 'adw-viewswitcherbar-button-badge needs-attention'
                    : 'adw-viewswitcherbar-button-badge';
        });

        this._applyRevealed();
    }

    private _buildButton(pageIndex: number, column: number): BarButtonNodes {
        const button = new StackLayout();
        button.orientation = 'vertical';
        button.className = 'adw-viewswitcherbar-button';
        button.horizontalAlignment = 'stretch';

        // Icon and label always exist — the icon carries the `image-missing`
        // fallback rather than disappearing.
        const icon = new GtkImage();
        icon.className = `${icon.className} adw-viewswitcherbar-button-icon`.trim();
        icon.horizontalAlignment = 'center';
        button.addChild(icon);

        const label = new Label();
        label.className = 'adw-viewswitcherbar-button-label';
        label.horizontalAlignment = 'center';
        label.textAlignment = 'center';
        button.addChild(label);

        const badge = new Label();
        badge.className = 'adw-viewswitcherbar-button-badge';
        badge.horizontalAlignment = 'center';
        badge.textAlignment = 'center';
        button.addChild(badge);

        attachRowPressFeedback(button);
        button.addEventListener('tap', () => {
            // A bar IS ordinal — button n shows page n — and the stack resolves that to a
            // page at the moment of the tap (ADR 0048). Nothing here holds an index.
            this._stack?.selectNthPage(pageIndex);
        });

        GridLayout.setColumn(button, column);
        this._bar.addChild(button);
        return { button, icon, label, badge };
    }

    private _applyRevealed(): void {
        this.visibility = this._barState.revealed ? 'visible' : 'collapse';
    }
}
