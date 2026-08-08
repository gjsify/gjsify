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
// What the lift fixed here, all of it C-derived:
//   - a page with neither title nor icon rendered a zero-content but tappable,
//     space-consuming button; libadwaita hides it (adw-view-switcher.c:178).
//   - a page with no icon rendered no icon at all; C substitutes `image-missing`
//     (adw-view-switcher-button.c:399-405).
//   - `selected = 1.5` passed the `Number.isFinite` guard, matched no page, and
//     collapsed every page at once while marking no button active; positions are
//     `guint` (adw-view-stack.c:675-683).
//   - `notify::selected` fired for a programmatic set as well as a tap with no
//     way to tell them apart; the payload now carries `interactive`, the same
//     tagging `ViewStackState` uses.
//   - there was no per-page `visible` flag, so the auto-pick took the first page
//     ADDED rather than the first VISIBLE one (adw-view-stack.c:1149-1151) and a
//     hidden page could be selected (:2415).
//   - `setViews` reset the selection to 0 whenever the index no longer fit;
//     libadwaita's selection is a page POINTER and follows the page across a
//     rebuild (adw-view-stack.c:660-672).
//   - a stale comment claimed the out-of-range branch "still applies on first
//     set"; it returned without applying anything.
//
// Each switcher button is a REAL tappable NS `StackLayout` holding an `AdwIcon`
// + a `Label` + a badge `Label`. Press feedback is wired with
// {@link attachRowPressFeedback} (NS only auto-applies `:highlighted` to
// `Button`, and these buttons are layouts). The per-button chrome hooks this base
// used to carry are gone with their only user: `AdwTabView` is an EDITABLE
// ordered list, not a fixed bar of mutually-exclusive buttons, and now owns its
// own model.
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
import { AdwIcon } from './adw-icon.js';
import { attachRowPressFeedback } from './row-press.js';
import {
    applyViewSwitcherVisibility,
    createViewSwitcherState,
    nsIconSvg,
    viewSwitcherNotifyPayload,
    viewSwitcherPageSpecs,
    type AdwViewPage,
    type ViewSwitcherNotifyPayload,
} from './view-switcher-model.js';

// Re-exported so the widget module stays the one import site for the page type,
// as `widgets/index.ts` and every consumer already expect.
export type { AdwViewPage };

/** Event name emitted when the selected view changes. Mirrors GObject `notify::selected`. */
export const NOTIFY_SELECTED = 'notify::selected';

/**
 * Payload of the `notify::selected` event. `selected` is `-1` and `name`/`title`
 * are `''` when nothing is selected — the state an empty switcher and a
 * fully-hidden one both land in.
 */
export interface NotifyViewSelectedEventData extends EventData, ViewSwitcherNotifyPayload {}

/** The per-button NS nodes, so a selection change repaints instead of rebuilding. */
interface ButtonNodes {
    button: StackLayout;
    icon: AdwIcon;
    label: Label;
    badge: Label;
}

/**
 * Shared base: a switcher bar (row 0) + a content area (row 1), one page visible.
 * Subclasses set the bar/button CSS classes for their look.
 */
export abstract class AdwViewSwitcherBase extends GridLayout {
    /** The horizontal switcher bar holding the buttons. */
    protected readonly _bar: StackLayout;
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
    /**
     * `AdwViewSwitcher:policy`, which decides the button orientation
     * (adw-view-switcher.c:534-537). `'wide'` — icon beside label — because that
     * is the layout all three NS switchers have always used; the icon-over-label
     * narrow form lives in the separate `AdwViewSwitcherBar`. There is no policy
     * PROPERTY on NS yet, so this is a constant a subclass can override rather
     * than settable state.
     */
    protected get policy(): AdwViewSwitcherPolicy {
        return 'wide';
    }

    /**
     * What the buttons show. `'both'` for the classic switcher, whose buttons
     * "always have an icon and a label" (adw-view-switcher.c class docs);
     * `AdwInlineViewSwitcher` overrides it with the real
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

        const bar = new StackLayout();
        bar.orientation = 'horizontal';
        bar.horizontalAlignment = 'center';
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
     * The SELECTED PAGE survives the rebuild whenever a page of the same name
     * does — libadwaita's selection is a page pointer, not an index
     * (adw-view-stack.c:660-672) — and falls back to the first VISIBLE page
     * otherwise (:1149-1151).
     */
    setViews(pages: AdwViewPage[]): void {
        for (const nodes of this._nodes) this._bar.removeChild(nodes.button);
        this._nodes = [];
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

        // Icon and label always EXIST, exactly as AdwViewSwitcherButton's
        // template does; what varies is what they carry. The icon holds the
        // `image-missing` fallback when the page has none.
        const icon = new AdwIcon();
        icon.className = `${icon.className} ${this.buttonClass}-icon`.trim();
        icon.verticalAlignment = 'middle';
        button.addChild(icon);

        const label = new Label();
        label.className = `${this.buttonClass}-label`;
        label.verticalAlignment = 'middle';
        button.addChild(label);

        // AdwIndicatorBin's badge (adw-indicator-bin.c:58-68).
        const badge = new Label();
        badge.className = `${this.buttonClass}-badge`;
        badge.verticalAlignment = 'middle';
        button.addChild(badge);

        attachRowPressFeedback(button);
        button.addEventListener('tap', () => {
            this._state.setSelected(index);
        });
        this._bar.addChild(button);
        return { button, icon, label, badge };
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

            // The button-visibility rule: a page with neither title nor icon has
            // no button at all (adw-view-switcher.c:178).
            nodes.button.visibility = model.visible ? 'visible' : 'collapse';
            nodes.button.orientation = model.orientation === 'horizontal' ? 'horizontal' : 'vertical';
            nodes.button.className = model.selected ? `${this.buttonClass} active` : this.buttonClass;
            nodes.icon.icon = nsIconSvg(model.iconName);
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
     * NO-OPS — refused, never clamped, exactly as
     * `adw_view_stack_pages_select_item` refuses (adw-view-stack.c:682-684).
     */
    get selected(): number {
        return this._state.selected;
    }

    set selected(value: number) {
        this._state.setSelected(value);
    }

    /** Name of the selected page, `''` when nothing is selected. */
    get selectedName(): string {
        return this._state.selectedName;
    }

    /**
     * Show or hide a page by name. Returns whether the SELECTION moved: hiding
     * the selected page falls back to the first still-visible one
     * (`update_child_visible`, adw-view-stack.c:1061-1082).
     */
    setPageVisible(name: string, visible: boolean): boolean {
        const moved = this._state.setPageVisible(name, visible);
        this._applySelection();
        return moved;
    }
}
