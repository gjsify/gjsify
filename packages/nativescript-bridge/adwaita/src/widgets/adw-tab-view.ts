// AdwTabView — a Libadwaita-style tabbed view for NativeScript.
//
// A top tab bar (one tappable chip per page) over a content area, with one page
// visible at a time. Mirrors `Adw.TabView` + `Adw.TabBar`: the active chip is a
// raised rounded pill (NOT an accent underline) carrying a small ✕ close button.
//
// The MODEL is HEADLESS and lives in `@gjsify/adwaita-core` (ADR 0004) as
// `TabViewState`, shared with the `@gjsify/adwaita-web` twin and pinned by the
// conformance vectors; `tab-view-state.ts` holds the NS-specific projection onto
// `View.visibility`. This class is the `GridLayout` wiring only.
//
// Deliberately NOT derived from `AdwViewSwitcherBase`: that base models a bar of
// mutually-exclusive buttons over a page stack, and its rebuild-everything `setViews`
// shape cannot express an insert, a reorder or a pin — a tab view is an EDITABLE
// ordered list with a pinned prefix, parent links and a close protocol.
//
// FIDELITY: approximated. NS ships a native `TabView`, but it imposes its own platform
// tab chrome (Material/UIKit), bottom-tab placement quirks and an item-binding model
// that fights the Adwaita top-tab look, so the bar is built from real NS widgets
// instead. Pages swap by visibility (no slide animation), a `loading` page shows its
// icon rather than a spinner, and tab drag-and-drop — hence the `dragging` and
// `is-transferring-page` terms — has no NS analogue. The `icon` slot carries an Adwaita
// symbolic SVG string rather than a GTK icon name; the model treats it as opaque.
//
// Reference: refs/libadwaita/src/adw-tab-view.c (Adw.TabView)
// Reference: refs/libadwaita/src/adw-tab-bar.c (Adw.TabBar autohide)
// Reference: refs/libadwaita/src/stylesheet/widgets/_tab-view.scss (tabbar/tabbox)
// Reference: packages/web/adwaita-web/src/elements/adw-tab-view.ts (web twin)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, Label, StackLayout, type EventData, type View } from '@nativescript/core';
import { windowCloseSymbolic } from '@gjsify/adwaita-icons/ui';
import { tabIconState } from '@gjsify/adwaita-core';
import type { AdwTabPageSpec, TabViewPagesChange } from '@gjsify/adwaita-core';
import { GtkImage } from './gtk-image.js';
import { AdwImageButton } from './adw-image-button.js';
import { attachRowPressFeedback } from './row-press.js';
import {
    applyTabViewVisibility,
    createTabViewState,
    tabBarVisibility,
    tabCloseVisibilities,
    tabLabelText,
    tabViewNotifyPayload,
    type AdwTabPage,
    type TabViewNotifyPayload,
} from './tab-view-state.js';
import type { AdwViewPage } from './view-switcher-base.js';
import { xmlBoolean } from './xml-values.js';

// Re-exported so the widget module stays the one import site for the page type,
// as `widgets/index.ts` and every consumer already expect.
export type { AdwTabPage };

/** Event name emitted when the selected page changes. Mirrors `notify::selected-page`. */
export const NOTIFY_SELECTED_PAGE = 'notify::selected-page';

/** Event name emitted for every page-list change (attach / detach / reorder / pin / update). */
export const PAGES_CHANGED = 'pages-changed';

/** Event name emitted for every close ATTEMPT, before the verdict is applied. */
export const CLOSE_PAGE = 'close-page';

/** Payload of {@link NOTIFY_SELECTED_PAGE}. */
export interface NotifySelectedPageEventData extends EventData, TabViewNotifyPayload {}

/** Payload of {@link PAGES_CHANGED} — the core's page-list change, verbatim. */
export interface PagesChangedEventData extends EventData, TabViewPagesChange {}

/** Payload of {@link CLOSE_PAGE}. */
export interface ClosePageEventData extends EventData {
    /** The page being asked about. */
    id: string;
    /** Its index while it is still in the view. */
    index: number;
}

/** The NS widgets making up one tab chip. */
interface TabChip {
    button: StackLayout;
    icon: GtkImage;
    indicator: GtkImage;
    label: Label;
    close: AdwImageButton;
}

export class AdwTabView extends GridLayout {
    private readonly _state = createTabViewState({ onClosePage: (page) => this._requestClose(page) });
    private readonly _bar: StackLayout;
    private readonly _contentArea: GridLayout;
    /** Tab chips keyed by page id — the bar is edited in place, never rebuilt. */
    private readonly _chips = new Map<string, TabChip>();
    private _autohide = false;
    private _defaultIcon: string | null = null;
    private _generatedIds = 0;

    /**
     * The `close-page` decision seam. Return `true` to confirm, `false` to deny,
     * `'defer'` to hold the page until {@link closePageFinish} — which is how an
     * app shows a "save before closing?" dialog. Unset takes libadwaita's own
     * default, `!page.pinned` (adw-tab-view.c:1990-1991).
     *
     * A PROPERTY rather than an event return value because NS events cannot
     * carry one; {@link CLOSE_PAGE} still fires for every attempt, so observing
     * and deciding stay separable.
     */
    closeHandler: ((page: AdwTabPage) => boolean | 'defer') | null = null;

    constructor() {
        super();

        this.className = 'adw-tab-view';
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'auto')); // bar
        this.addRow(new ItemSpec(1, 'star')); // content

        const bar = new StackLayout();
        bar.orientation = 'horizontal';
        // The tab bar spans the full width (not centered like a view switcher).
        bar.horizontalAlignment = 'stretch';
        bar.className = 'adw-tab-view-bar';
        GridLayout.setRow(bar, 0);
        this.addChild(bar);
        this._bar = bar;

        const contentArea = new GridLayout();
        contentArea.addColumn(new ItemSpec(1, 'star'));
        contentArea.addRow(new ItemSpec(1, 'star'));
        GridLayout.setRow(contentArea, 1);
        this.addChild(contentArea);
        this._contentArea = contentArea;

        this._state.subscribePages((change) => this._onPagesChange(change));
        this._state.subscribe((change) => {
            this._applySelection();
            const data: NotifySelectedPageEventData = {
                eventName: NOTIFY_SELECTED_PAGE,
                object: this,
                ...tabViewNotifyPayload(change),
            };
            this.notify(data);
        });
    }

    // --- Model surface (thin delegations to TabViewState) --------------------

    /** All pages in order. */
    get pages(): readonly AdwTabPage[] {
        return this._state.pages;
    }

    /** Number of pages. */
    get nPages(): number {
        return this._state.nPages;
    }

    /** Length of the pinned prefix. */
    get nPinnedPages(): number {
        return this._state.nPinnedPages;
    }

    /** Id of the selected page, `null` when the view is empty. */
    get selectedId(): string | null {
        return this._state.selectedId;
    }

    /** Index of the selected page, `-1` when the view is empty — never 0 for an empty view. */
    get selectedIndex(): number {
        return this._state.selectedIndex;
    }

    /**
     * The selected page (`Adw.TabView:selected-page`), `null` when the view is empty.
     *
     * THE PAGE, NOT ITS POSITION (ADR 0048). `Adw.TabView` is the one widget in this port
     * whose counterpart selects by OBJECT rather than by name or by ordinal, and the model
     * has held that object all along — this property is the door onto it. Setting a page
     * this view does not hold is ignored, as `setSelectedPage` already was.
     */
    get selectedPage(): AdwTabPage | null {
        return this._state.selectedPage;
    }

    set selectedPage(id: string | null) {
        // THE ID, BECAUSE ON THIS PORT AN ID IS WHAT A PAGE HANDLE IS. Every other page
        // call here takes one — `isClosing`, `closePage`, `setPagePinned` — and a
        // NativeScript XML attribute can carry nothing else, so `<AdwTabView
        // selectedPage="inbox">` is the only way markup can declare a starting tab. The web
        // twin takes the page OBJECT because its DOM has one and its attribute carries the
        // id separately; ADR 0034 § 1 converges the NAME and never the shape.
        //
        // The core refuses an id this view does not hold, with the diagnostic C raises —
        // and because a caller here cannot hand over another view's page object, the
        // cross-view confusion the web twin has to guard against cannot arise.
        this._state.setSelectedPage(id);
    }

    isClosing(id: string): boolean {
        return this._state.isClosing(id);
    }

    /** `adw_tab_view_set_selected_page`. The page, or the id this port uses as its handle. */
    setSelectedPage(page: AdwTabPage | string | null): boolean {
        return this._state.setSelectedPage(page);
    }

    selectNthPage(n: number): boolean {
        return this._state.selectNthPage(n);
    }

    selectPreviousPage(): boolean {
        return this._state.selectPreviousPage();
    }

    selectNextPage(): boolean {
        return this._state.selectNextPage();
    }

    selectFirstPage(): boolean {
        return this._state.selectFirstPage();
    }

    selectLastPage(): boolean {
        return this._state.selectLastPage();
    }

    /** The next page, WRAPPING to the first (Ctrl+Tab). */
    cycleNextPage(): boolean {
        return this._state.cycleNextPage();
    }

    /** The previous page, WRAPPING to the last (Ctrl+Shift+Tab). */
    cyclePreviousPage(): boolean {
        return this._state.cyclePreviousPage();
    }

    /** Add a page opened FROM `parentId`, deriving its position (Adw.TabView.add_page). */
    addPage(spec: AdwTabPageSpec<View>, parentId: string | null = null): number {
        return this._state.addPage(spec, parentId);
    }

    insertPage(spec: AdwTabPageSpec<View>, position: number): number {
        return this._state.insertPage(spec, position);
    }

    prependPage(spec: AdwTabPageSpec<View>): number {
        return this._state.prependPage(spec);
    }

    appendPage(spec: AdwTabPageSpec<View>): number {
        return this._state.appendPage(spec);
    }

    insertPinnedPage(spec: AdwTabPageSpec<View>, position: number): number {
        return this._state.insertPinnedPage(spec, position);
    }

    prependPinnedPage(spec: AdwTabPageSpec<View>): number {
        return this._state.prependPinnedPage(spec);
    }

    appendPinnedPage(spec: AdwTabPageSpec<View>): number {
        return this._state.appendPinnedPage(spec);
    }

    /** Pin or unpin a page, re-ordering it in the same step. Returns its new position. */
    setPagePinned(id: string, pinned: boolean): number {
        return this._state.setPagePinned(id, pinned);
    }

    /** Request a close. Fires {@link CLOSE_PAGE}, then applies {@link closeHandler}'s verdict. */
    closePage(id: string): boolean {
        return this._state.closePage(id);
    }

    closePageFinish(id: string, confirm: boolean): boolean {
        return this._state.closePageFinish(id, confirm);
    }

    closeOtherPages(id: string): void {
        this._state.closeOtherPages(id);
    }

    closePagesBefore(id: string): void {
        this._state.closePagesBefore(id);
    }

    closePagesAfter(id: string): void {
        this._state.closePagesAfter(id);
    }

    /** Remove a page unconditionally, running the successor rule first. */
    detachPage(id: string): AdwTabPage | null {
        return this._state.detachPage(id);
    }

    reorderPage(id: string, position: number): boolean {
        return this._state.reorderPage(id, position);
    }

    reorderBackward(id: string): boolean {
        return this._state.reorderBackward(id);
    }

    reorderForward(id: string): boolean {
        return this._state.reorderForward(id);
    }

    reorderFirst(id: string): boolean {
        return this._state.reorderFirst(id);
    }

    reorderLast(id: string): boolean {
        return this._state.reorderLast(id);
    }

    setPageTitle(id: string, title: string | null): boolean {
        return this._state.setPageTitle(id, title);
    }

    setPageIcon(id: string, icon: string | null): boolean {
        return this._state.setPageIcon(id, icon);
    }

    setPageLoading(id: string, loading: boolean): boolean {
        return this._state.setPageLoading(id, loading);
    }

    setPageNeedsAttention(id: string, needsAttention: boolean): boolean {
        return this._state.setPageNeedsAttention(id, needsAttention);
    }

    /** Every precondition the model refused, as C would have warned about it. */
    get diagnostics(): readonly string[] {
        return this._state.diagnostics;
    }

    // --- Tab bar chrome -----------------------------------------------------

    /**
     * Whether the tab bar hides itself when it has nothing to show
     * (`Adw.TabBar:autohide`, adw-tab-bar.c:142-164). Defaults to `false` rather
     * than to the platform's `DEFAULT_TAB_AUTOHIDE`, so a bar that was always
     * visible before this lift stays visible unless asked otherwise.
     */
    get autohide(): boolean {
        return this._autohide;
    }

    set autohide(raw: boolean | string) {
        const value = xmlBoolean(raw, this.autohide);
        this._autohide = !!value;
        this._applyBarVisibility();
    }

    /** `Adw.TabView:default-icon` — what a PINNED page with no icon of its own shows. */
    get defaultIcon(): string | null {
        return this._defaultIcon;
    }

    set defaultIcon(value: string | null) {
        this._defaultIcon = value;
        for (const page of this._state.pages) this._refreshChip(page.id);
    }

    // --- Compatibility with the old view-page list --------------------------

    /**
     * Replace every page from a plain `{ title, content, icon? }` list.
     *
     * Kept because that was this widget's only API before the lift, when it
     * derived from `AdwViewSwitcherBase` and rebuilt the whole bar on every
     * change. It now goes through the model — each entry becomes an appended page
     * with a generated id — so the incremental bar, the close protocol and the
     * selection rules apply to it too.
     */
    setViews(pages: AdwViewPage[]): void {
        // `pages` hands out a frozen SNAPSHOT, so detaching while iterating it is
        // safe: the model builds a new array, it does not edit this one.
        for (const page of this._state.pages) this._state.detachPage(page.id);
        for (const page of pages) {
            this._state.appendPage({
                id: this._nextId(),
                title: page.title,
                icon: page.icon ?? null,
                content: page.content,
            });
        }
    }

    /** The pages as a plain list — the shape {@link setViews} takes. */
    get views(): AdwViewPage[] {
        return this._state.pages.map((page) => ({
            title: page.title,
            content: page.content!,
            icon: page.icon ?? undefined,
        }));
    }

    set views(pages: AdwViewPage[]) {
        this.setViews(Array.isArray(pages) ? pages : []);
    }

    /** Alias of {@link views}, matching the widget's own vocabulary. */
    get tabs(): AdwViewPage[] {
        return this.views;
    }

    set tabs(pages: AdwViewPage[]) {
        this.views = pages;
    }

    // --- Rendering ----------------------------------------------------------

    private _onPagesChange(change: TabViewPagesChange): void {
        switch (change.kind) {
            case 'attached': {
                const page = this._state.getPage(change.id);
                if (page) this._insertChip(page, change.position);
                break;
            }
            case 'detached': {
                const chip = this._chips.get(change.id);
                if (chip) this._bar.removeChild(chip.button);
                this._chips.delete(change.id);
                break;
            }
            case 'reordered':
            case 'pinned': {
                const chip = this._chips.get(change.id);
                if (chip) {
                    // Remove-then-insert, the same shape the model's own move has.
                    this._bar.removeChild(chip.button);
                    this._bar.insertChild(chip.button, change.position);
                }
                this._refreshChip(change.id);
                break;
            }
            case 'updated':
                this._refreshChip(change.id);
                break;
        }
        this._applyBarVisibility();
        this._applySelection();
        const data: PagesChangedEventData = { eventName: PAGES_CHANGED, object: this, ...change };
        this.notify(data);
    }

    private _insertChip(page: AdwTabPage, position: number): void {
        const button = new StackLayout();
        button.orientation = 'horizontal';
        button.className = 'adw-tab-view-tab';
        button.verticalAlignment = 'middle';

        const icon = new GtkImage();
        icon.className = `${icon.className} adw-tab-view-tab-icon`.trim();
        icon.verticalAlignment = 'middle';
        button.addChild(icon);

        const indicator = new GtkImage();
        indicator.className = `${indicator.className} adw-tab-view-tab-icon`.trim();
        indicator.verticalAlignment = 'middle';
        button.addChild(indicator);

        const label = new Label();
        label.className = 'adw-tab-view-tab-label';
        label.verticalAlignment = 'middle';
        button.addChild(label);

        const close = new AdwImageButton();
        close.className = `${close.className} adw-tab-close`.trim();
        close.iconName = windowCloseSymbolic;
        close.iconSize = 12;
        close.verticalAlignment = 'middle';
        close.addEventListener('tap', () => this._state.closePage(page.id));
        button.addChild(close);

        attachRowPressFeedback(button);
        button.addEventListener('tap', () => this._state.setSelectedPage(page.id));

        this._bar.insertChild(button, position);
        this._chips.set(page.id, { button, icon, indicator, label, close });

        const content = page.content;
        if (content) {
            GridLayout.setColumn(content, 0);
            GridLayout.setRow(content, 0);
            this._contentArea.addChild(content);
        }
        this._refreshChip(page.id);
    }

    private _refreshChip(id: string): void {
        const page = this._state.getPage(id);
        const chip = this._chips.get(id);
        if (!page || !chip) return;

        chip.label.text = tabLabelText(page);
        chip.label.visibility = page.pinned ? 'collapse' : 'visible';

        // `update_icons` (adw-tab.c:171-198): a pinned page with no icon of its
        // own falls back to the view's default-icon, and on a pinned tab the
        // indicator REPLACES the icon.
        const icons = tabIconState(page, this._defaultIcon);
        chip.icon.iconName = icons.icon ?? '';
        chip.icon.visibility = icons.iconVisible && icons.icon !== null ? 'visible' : 'collapse';
        chip.indicator.iconName = page.indicatorIcon ?? '';
        chip.indicator.visibility = icons.indicatorVisible ? 'visible' : 'collapse';
    }

    /** Show only the selected page, mark its chip active, gate the close buttons. */
    private _applySelection(): void {
        applyTabViewVisibility(this._state);
        const closes = tabCloseVisibilities(this._state);
        const selected = this._state.selectedId;
        this._state.pages.forEach((page, index) => {
            const chip = this._chips.get(page.id);
            if (!chip) return;
            chip.button.className = page.id === selected ? 'adw-tab-view-tab active' : 'adw-tab-view-tab';
            chip.close.visibility = closes[index]!;
        });
    }

    private _applyBarVisibility(): void {
        this._bar.visibility = tabBarVisibility(this._state, this._autohide);
    }

    private _requestClose(page: AdwTabPage): boolean | 'defer' {
        const data: ClosePageEventData = {
            eventName: CLOSE_PAGE,
            object: this,
            id: page.id,
            index: this._state.getPagePosition(page.id),
        };
        this.notify(data);
        return this.closeHandler ? this.closeHandler(page) : !page.pinned;
    }

    private _nextId(): string {
        // Monotonic and never reused: an id stands in for a page POINTER, so
        // recycling one would silently alias a closed tab to a new one.
        this._generatedIds += 1;
        return `tab-${this._generatedIds}`;
    }
}
