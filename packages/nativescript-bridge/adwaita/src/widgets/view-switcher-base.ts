// AdwViewSwitcherBase — shared base for the NativeScript view-switching widgets.
//
// `Adw.ViewSwitcher`, `Adw.InlineViewSwitcher` and (the tab-bar half of)
// `Adw.TabView` all reduce to the same primitive: a bar of mutually-exclusive
// buttons, each bound to one page in a content stack, with exactly one page
// visible at a time. This base is the NativeScript wiring for that; the
// BEHAVIOUR — which button exists, what it shows, and which page is selected —
// is HEADLESS and lives in `@gjsify/adwaita-core` (ADR 0004), shared with the
// `@gjsify/adwaita-web` twin and pinned by the conformance vectors. The
// NS-specific projection (page `visibility`, the SVG icon, the page record) is
// in `view-switcher-model.ts`, which the spec suite drives because a widget
// module cannot be imported off-device.
//
// Each switcher button is a REAL tappable NS `StackLayout` holding an `GtkImage`
// + a `Label` + a badge `Label`. Press feedback is wired with
// {@link attachRowPressFeedback} (NS only auto-applies `:highlighted` to
// `Button`, and these buttons are layouts). `AdwTabView` is an EDITABLE ordered
// list, not a fixed bar of mutually-exclusive buttons, so it owns its own model
// and no per-button chrome hooks live here.
//
// FIDELITY: approximated. NS has no `Adw.ViewStack`; pages swap by toggling
// `visibility` (`collapse`/`visible`) — instant, no cross-fade (the CSS subset
// has no transition). The selected button is marked with the `.active` class.
//
// Reference: refs/libadwaita/src/adw-view-switcher.c (AdwViewSwitcher)
// Reference: refs/libadwaita/src/stylesheet/widgets/_view-switcher.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, Label, StackLayout, type EventData } from '@nativescript/core';
import { buildViewSwitcherButtons } from '@gjsify/adwaita-core';
import type { AdwInlineViewSwitcherDisplayMode, AdwViewSwitcherPolicy, ViewSwitcherState } from '@gjsify/adwaita-core';
import { GtkImage } from './gtk-image.js';
import { attachRowPressFeedback } from './row-press.js';
import {
    applyViewSwitcherVisibility,
    createViewSwitcherState,
    nsIconSvg,
    switcherButtonVisible,
    viewSwitcherNotifyPayload,
    viewSwitcherPageSpecs,
    type AdwViewPage,
    type ViewSwitcherKind,
    type ViewSwitcherNotifyPayload,
} from './view-switcher-model.js';
import { xmlNumber } from './xml-values.js';

// Re-exported so the widget module stays the one import site for the page type.
export type { AdwViewPage };

/** Event name emitted when the selected view changes. Mirrors GObject `notify::selected`. */
export const NOTIFY_SELECTED = 'notify::selected';

/**
 * Payload of the `notify::selected` event. `selected` is `-1` and `name`/`title`
 * are `''` when nothing is selected — the state an empty switcher and a
 * fully-hidden one both land in.
 */
export interface NotifyViewSelectedEventData extends EventData, ViewSwitcherNotifyPayload {}

/** The per-button NS nodes kept so a selection change repaints instead of rebuilding. */
interface ButtonNodes {
    button: StackLayout;
    icon: GtkImage;
    label: Label;
    badge: Label;
}

/**
 * Shared base: a switcher bar (row 0) + a content area (row 1), one page visible.
 * Subclasses set the bar/button CSS classes for their look.
 */
export abstract class AdwViewSwitcherBase extends GridLayout {
    /** The horizontal switcher bar holding the buttons. */
    protected readonly _bar: GridLayout;
    /** `Adw.ViewSwitcher:policy`, default NARROW as in C. */
    private _policy: AdwViewSwitcherPolicy = 'narrow';
    /** The content area where the selected page is shown. */
    protected readonly _contentArea: GridLayout;
    /** The registered pages, in bar order. */
    protected readonly _pages: AdwViewPage[] = [];
    /** The headless selection + page model every derivation reads. */
    protected readonly _state: ViewSwitcherState = createViewSwitcherState();
    private _nodes: ButtonNodes[] = [];

    /** CSS class applied to the switcher bar — subclass-specific. */
    protected abstract get barClass(): string;
    /** CSS class applied to each switcher button — subclass-specific. */
    protected abstract get buttonClass(): string;
    /** `AdwViewSwitcher:policy`, which decides the button orientation. A subclass may pin it. */
    protected get policy(): AdwViewSwitcherPolicy {
        return this._policy;
    }

    /** `Adw.ViewSwitcher:policy` — settable, so a consumer can drive it from a breakpoint. */
    get switcherPolicy(): AdwViewSwitcherPolicy {
        return this._policy;
    }

    set switcherPolicy(value: AdwViewSwitcherPolicy) {
        const next = value === 'wide' ? 'wide' : 'narrow';
        if (next === this._policy) return;
        this._policy = next;
        this._applySelection();
        this.notify({ eventName: 'notify::policy', object: this });
    }

    /**
     * What the buttons show. `'both'` for the classic switcher, whose buttons always
     * have an icon and a label; `AdwInlineViewSwitcher` overrides it with the real
     * `AdwInlineViewSwitcherDisplayMode`.
     */
    protected get buttonDisplayMode(): AdwInlineViewSwitcherDisplayMode {
        return 'both';
    }

    constructor(rootClass: string) {
        super();

        this.className = rootClass;
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'auto')); // bar
        this.addRow(new ItemSpec(1, 'star')); // content

        // A grid, not a centred StackLayout: GTK's box layout is HOMOGENEOUS here,
        // so every button gets the same width and a long label cannot dominate the
        // row. One `star` column per button is what reproduces that.
        const bar = new GridLayout();
        bar.horizontalAlignment = 'stretch';
        bar.addRow(new ItemSpec(1, 'auto'));
        GridLayout.setRow(bar, 0);
        this.addChild(bar);
        this._bar = bar;

        const contentArea = new GridLayout();
        contentArea.addColumn(new ItemSpec(1, 'star'));
        contentArea.addRow(new ItemSpec(1, 'star'));
        GridLayout.setRow(contentArea, 1);
        this.addChild(contentArea);
        this._contentArea = contentArea;

        this._state.subscribe((change) => {
            this._applySelection();
            const data: NotifyViewSelectedEventData = {
                eventName: NOTIFY_SELECTED,
                object: this,
                ...viewSwitcherNotifyPayload(change),
            };
            this.notify(data);
        });
    }

    /** Initialise the bar class after the subclass fields are ready. */
    protected _initClasses(): void {
        this._bar.className = this.barClass;
    }

    /**
     * Register the view pages. Rebuilds the switcher bar + content stack.
     *
     * The SELECTED PAGE survives the rebuild whenever a page of the same name does —
     * libadwaita's selection is a page pointer, not an index — and falls back to the
     * first VISIBLE page otherwise.
     */
    setViews(pages: AdwViewPage[]): void {
        for (const nodes of this._nodes) this._bar.removeChild(nodes.button);
        this._nodes = [];
        // The columns go with the buttons: a child whose column index exceeds the
        // declared columns is clamped into the last one, so a shrinking switcher
        // would stack its buttons on top of each other.
        this._bar.removeColumns();
        for (const page of this._pages) this._contentArea.removeChild(page.content);
        this._pages.length = 0;
        this._pages.push(...pages);

        for (const [index, page] of this._pages.entries()) {
            this._nodes.push(this._buildButton(index));
            GridLayout.setColumn(page.content, 0);
            GridLayout.setRow(page.content, 0);
            this._contentArea.addChild(page.content);
        }

        // Emits at most one `notify::selected`, tagged non-interactive — the page
        // set changed, the user did not tap.
        this._state.setPages(viewSwitcherPageSpecs(this._pages));
        this._applySelection();
    }

    /** Build one button's NS nodes. Painted by {@link _applySelection}. */
    private _buildButton(index: number): ButtonNodes {
        const button = new StackLayout();
        // Overwritten from the derived model's orientation on every paint.
        button.orientation = 'horizontal';
        button.className = this.buttonClass;
        button.horizontalAlignment = 'center';

        // Icon and label always EXIST, as AdwViewSwitcherButton's template does;
        // what varies is what they carry. The icon holds the `image-missing`
        // fallback when the page has none.
        const icon = new GtkImage();
        icon.className = `${icon.className} ${this.buttonClass}-icon`.trim();
        icon.verticalAlignment = 'middle';
        button.addChild(icon);

        const label = new Label();
        label.className = `${this.buttonClass}-label`;
        label.verticalAlignment = 'middle';
        button.addChild(label);

        // AdwIndicatorBin's badge.
        const badge = new Label();
        badge.className = `${this.buttonClass}-badge`;
        badge.verticalAlignment = 'middle';
        button.addChild(badge);

        attachRowPressFeedback(button);
        button.addEventListener('tap', () => {
            this._state.setSelected(index);
        });
        this._bar.addColumn(new ItemSpec(1, 'star'));
        GridLayout.setColumn(button, index);
        GridLayout.setRow(button, 0);
        this._bar.addChild(button);
        return { button, icon, label, badge };
    }

    /**
     * Which visibility rule this switcher follows — see
     * {@link switcherButtonVisible}, which holds the rule itself so a spec can
     * reach it.
     */
    protected get switcherKind(): ViewSwitcherKind {
        return 'switcher';
    }

    /** Paint the derived models: show only the selected page, mark its button active. */
    protected _applySelection(): void {
        applyViewSwitcherVisibility(this._pages, this._state.selected);

        const showIcon = this.buttonDisplayMode !== 'labels';
        const showLabel = this.buttonDisplayMode !== 'icons';

        const models = buildViewSwitcherButtons(this._state.pages, this._state.selected, this.policy);
        models.forEach((model, index) => {
            const nodes = this._nodes[index];
            if (!nodes) return;

            const pageVisible = this._state.pages[index]?.visible ?? false;
            nodes.button.visibility = switcherButtonVisible(this.switcherKind, model.visible, pageVisible)
                ? 'visible'
                : 'collapse';
            nodes.button.orientation = model.orientation === 'horizontal' ? 'horizontal' : 'vertical';
            nodes.button.className = model.selected ? `${this.buttonClass} active` : this.buttonClass;
            nodes.icon.iconName = nsIconSvg(model.iconName);
            nodes.icon.visibility = showIcon ? 'visible' : 'collapse';
            nodes.label.text = model.label;
            nodes.label.visibility = showLabel ? 'visible' : 'collapse';
            nodes.badge.text = model.badgeLabel;
            // A bare needs-attention dot has no text; the class paints it.
            nodes.badge.visibility = model.badgeLabel.length > 0 || model.needsAttention ? 'visible' : 'collapse';
            if (model.badgeLabel.length === 0 && model.needsAttention) {
                nodes.badge.className = `${this.buttonClass}-badge needs-attention`;
            } else {
                nodes.badge.className = `${this.buttonClass}-badge`;
            }
            // `update_description` is what a screen reader announces for a badged
            // page; without it a badge is a silent dot.
            nodes.button.accessibilityLabel = model.description || model.label;
        });
    }

    /** The registered view pages. */
    get views(): AdwViewPage[] {
        return this._pages;
    }

    set views(pages: AdwViewPage[]) {
        this.setViews(Array.isArray(pages) ? pages : []);
    }

    /**
     * The selected view index, `-1` when nothing is selected. Swaps the visible
     * page + emits `notify::selected`.
     *
     * Out-of-range, negative, fractional and hidden-page indices are all silent
     * NO-OPS — refused, never clamped, as `adw_view_stack_pages_select_item` does.
     */
    get selected(): number {
        return this._state.selected;
    }

    set selected(raw: number | string) {
        const value = xmlNumber(raw, this.selected);
        this._state.setSelected(value);
    }

    /** Name of the selected page, `''` when nothing is selected. */
    get selectedName(): string {
        return this._state.selectedName;
    }

    /**
     * Show or hide a page by name. Returns whether the SELECTION moved: hiding the
     * selected page falls back to the first still-visible one.
     */
    setPageVisible(name: string, visible: boolean): boolean {
        const moved = this._state.setPageVisible(name, visible);
        this._applySelection();
        return moved;
    }
}
