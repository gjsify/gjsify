// AdwViewSwitcherBar — a Libadwaita-style bottom view-switcher bar for NativeScript.
//
// The "narrow policy" companion to {@link AdwViewSwitcher}: a full-width bar of
// evenly-distributed buttons, each showing an Adwaita symbolic icon ABOVE its
// label (the mobile/phone form), bound to an external {@link AdwViewStack} via the
// `stack` property. Mirrors `Adw.ViewSwitcherBar`: it drives — and reflects — the
// stack's `visible-child`, and a `revealed` property shows/hides it (an adaptive
// layout reveals it only on narrow screens, hiding it when a wide `AdwViewSwitcher`
// in the header bar takes over). Because it binds to a separate stack, it can sit
// in an `AdwToolbarView`'s BOTTOM slot while the stack fills the content slot —
// the canonical Adwaita phone shell.
//
// Each button is a REAL tappable `StackLayout` (icon over label); press feedback is
// wired with {@link attachRowPressFeedback} (NS only auto-highlights `Button`). The
// active button's label is accent-coloured via CSS; its icon stays theme-coloured
// (the CSS subset can't recolour a rasterised icon per-state without re-pinning it
// off the light/dark scheme — a documented, minor fidelity gap).
//
// FIDELITY: approximated. Pages swap by `visibility` toggle in the bound stack (no
// cross-fade). The bar/stack decoupling + icon-over-label layout + reveal semantics
// are faithful.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_view-switcher.scss (viewswitcherbar)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, Label, StackLayout } from '@nativescript/core';
import { AdwIcon } from './adw-icon.js';
import { AdwViewStack, NOTIFY_VISIBLE_CHILD } from './adw-view-stack.js';
import { attachRowPressFeedback } from './row-press.js';

export class AdwViewSwitcherBar extends GridLayout {
    /** The horizontal (homogeneous) row of buttons. */
    private readonly _bar: GridLayout;
    /** The tappable button containers, one per stack page, in page order. */
    private readonly _buttons: StackLayout[] = [];
    private _stack: AdwViewStack | null = null;
    private _stackListener: (() => void) | null = null;
    private _revealed = true;

    constructor() {
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

        // Keep in sync if the stack changed selection while the bar was detached.
        this.addEventListener('loaded', () => this._syncActive());
    }

    /** Bind to an {@link AdwViewStack}: build buttons from its pages + two-way sync. */
    setStack(stack: AdwViewStack | null): void {
        if (this._stack && this._stackListener) {
            this._stack.removeEventListener(NOTIFY_VISIBLE_CHILD, this._stackListener);
        }
        this._stack = stack;
        this._stackListener = null;
        this._rebuild();
        if (stack) {
            const listener = () => this._syncActive();
            stack.addEventListener(NOTIFY_VISIBLE_CHILD, listener);
            this._stackListener = listener;
        }
    }

    /** The bound stack (`Adw.ViewSwitcherBar.stack`). */
    get stack(): AdwViewStack | null {
        return this._stack;
    }

    set stack(value: AdwViewStack | null) {
        this.setStack(value);
    }

    /**
     * Whether the bar is shown (`Adw.ViewSwitcherBar.reveal`). An adaptive layout
     * sets this `true` on narrow screens and `false` on wide ones (where a header-bar
     * `AdwViewSwitcher` takes over).
     */
    get revealed(): boolean {
        return this._revealed;
    }

    set revealed(value: boolean) {
        this._revealed = !!value;
        this.visibility = this._revealed ? 'visible' : 'collapse';
    }

    /** Rebuild the button row from the bound stack's pages (call after late page adds). */
    refresh(): void {
        this._rebuild();
    }

    private _rebuild(): void {
        for (const btn of this._buttons) this._bar.removeChild(btn);
        this._buttons.length = 0;
        this._bar.removeColumns();

        const pages = this._stack?.pages ?? [];
        pages.forEach((page, index) => {
            // Homogeneous: every button gets an equal `star` column.
            this._bar.addColumn(new ItemSpec(1, 'star'));

            const btn = new StackLayout();
            btn.orientation = 'vertical';
            btn.className = 'adw-viewswitcherbar-button';
            btn.horizontalAlignment = 'stretch';

            if (page.icon) {
                const icon = new AdwIcon();
                icon.className = `${icon.className} adw-viewswitcherbar-button-icon`.trim();
                icon.horizontalAlignment = 'center';
                icon.icon = page.icon;
                btn.addChild(icon);
            }

            const label = new Label();
            label.text = page.title;
            label.className = 'adw-viewswitcherbar-button-label';
            label.horizontalAlignment = 'center';
            label.textAlignment = 'center';
            btn.addChild(label);

            attachRowPressFeedback(btn);
            btn.addEventListener('tap', () => {
                if (this._stack) this._stack.visibleChildIndex = index;
            });

            GridLayout.setColumn(btn, index);
            this._bar.addChild(btn);
            this._buttons.push(btn);
        });

        this._syncActive();
    }

    /** Mark the button for the stack's visible page active (accent label via CSS). */
    private _syncActive(): void {
        const selected = this._stack?.visibleChildIndex ?? -1;
        this._buttons.forEach((btn, i) => {
            btn.className = i === selected ? 'adw-viewswitcherbar-button active' : 'adw-viewswitcherbar-button';
        });
    }
}
