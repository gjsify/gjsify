// StorybookNativeApp — the NativeScript component browser: a story SIDEBAR/LIST
// grouped by category, a PREVIEW area (the selected StoryView), and a CONTROLS
// panel (the live-bound Adwaita rows for the selected story). The NS counterpart
// of @gjsify/adwaita-storybook's StorybookWebApp and @gjsify/storybook's
// StorybookWindow, built from REAL @gjsify/adwaita-nativescript widgets so it
// looks + behaves like the native GTK / browser storybooks (screenshot-comparable
// 1:1).
//
// The app state machine (register/instantiate, category grouping, show + wire
// controls, the MCP control surface) lives in @gjsify/storybook-core's
// StorybookController. This class is the NS StorybookView<StoryView>: it owns
// ONLY the @gjsify/adwaita-nativescript chrome (_buildUI): a collapsed
// AdwNavigationSplitView (the GTK NavigationSplitView at narrow width) — the
// master story list and the detail (preview + controls) never sit side-by-side
// on a phone; tapping a story navigates to the detail, a back button returns.

import type { StoryArgValue } from '@gjsify/stories';
import {
    type CategoryGroup,
    type ControlRow,
    StorybookController,
    type StorybookView,
    type StorySummary,
} from '@gjsify/storybook-core';
import {
    AdwHeaderBar,
    AdwImageButton,
    AdwNavigationSplitView,
    AdwOverlaySplitView,
    AdwPreferencesGroup,
    AdwToolbarView,
    AdwWindowTitle,
} from '@gjsify/adwaita-nativescript';
import { goPreviousSymbolic, sidebarShowRightSymbolic } from '@gjsify/adwaita-icons/actions';
import { Label, ScrollView, StackLayout, type View } from '@nativescript/core';
import { createControlRow } from './controls.js';
import type { StoryView } from './story-view.js';
import type { NsStoryModule } from './types.js';

export type { StorySummary } from '@gjsify/storybook-core';

/** Options that adapt the storybook to a host project. */
export interface StorybookNativeOptions {
    /** Story modules to display. */
    stories: NsStoryModule[];
    /** Title shown in the sidebar header. */
    title?: string;
    /** Auto-select the first story on mount (default true). */
    openFirst?: boolean;
}

export class StorybookNativeApp implements StorybookView<StoryView> {
    private _controller = new StorybookController<StoryView>(this, (story) => this._buildControls(story));
    private _options: StorybookNativeOptions;

    /** The single root view the host adds to its page — a collapsed navigation
     *  split view (master story list ⇄ detail preview). */
    readonly root: AdwNavigationSplitView;

    private _listColumn!: StackLayout;
    private _previewSlot!: StackLayout;
    private _previewTitle!: AdwWindowTitle;
    private _controlsGroup!: AdwPreferencesGroup;
    /** Right controls overlay (the GTK OverlaySplitView, sidebar_position=END). */
    private _controlsSplit!: AdwOverlaySplitView;

    private _rowByTitle = new Map<string, StackLayout>();

    constructor(options: StorybookNativeOptions) {
        this._options = options;
        // Always collapsed: the NS app is phone-sized, so the sidebar + detail
        // never sit side-by-side — selecting a story navigates to the detail and a
        // back button returns to the list (matching the GTK NavigationSplitView
        // when collapsed at narrow width).
        this.root = new AdwNavigationSplitView();
        this.root.collapsed = true;
        this.root.className = 'sb-window';
    }

    /** Build the UI, instantiate stories, and select the first one. Returns the root view. */
    mount(): View {
        this._buildUI();
        this._controller.mount(this._options.stories, this._options.openFirst !== false);
        return this.root;
    }

    // --- control surface (delegates to the controller; driven by the host
    //     @gjsify/devtools-nativescript agent over CDP) ---

    /** The currently-displayed story, or null. */
    get activeStory(): StoryView | null {
        return this._controller.activeStory;
    }

    /** Every story flattened to a summary. */
    listStories(): StorySummary[] {
        return this._controller.listStories();
    }

    /** Select + show a story by its full `Category/Name` title. */
    openStoryByTitle(title: string): boolean {
        return this._controller.openStoryByTitle(title);
    }

    /** The active story as `{ title, story, args }`, or null. */
    getCurrentStory(): { title: string; story: string; args: Record<string, unknown> } | null {
        return this._controller.getCurrentStory();
    }

    /** Set one arg on the active story — drives the same path as the controls. */
    setActiveArg(name: string, value: StoryArgValue): boolean {
        return this._controller.setActiveArg(name, value);
    }

    /** The underlying controller (e.g. to build a devtools extension over it). */
    get controller(): StorybookController<StoryView> {
        return this._controller;
    }

    // --- StorybookView<StoryView> render seams (driven by the controller) ---

    renderSidebar(groups: Array<CategoryGroup<StoryView>>, onSelect: (instance: StoryView) => void): void {
        this._listColumn.removeChildren();
        this._rowByTitle.clear();

        for (const { category, stories } of groups) {
            const header = new Label();
            header.text = category;
            header.className = 'sb-category';
            this._listColumn.addChild(header);

            for (const { instance, name } of stories) {
                const row = new StackLayout();
                row.orientation = 'vertical';
                row.className = 'sb-story-row';
                const rowLabel = new Label();
                rowLabel.text = name;
                rowLabel.className = 'sb-story-row-label';
                row.addChild(rowLabel);
                // Tapping a story selects it AND navigates to the detail pane
                // (the collapsed split view hides the sidebar) — the phone
                // master→detail step of the GTK NavigationSplitView.
                row.addEventListener('tap', () => {
                    onSelect(instance);
                    this.root.hideSidebarPane();
                });

                this._listColumn.addChild(row);
                this._rowByTitle.set(instance.meta.title, row);
            }
        }
    }

    markSelected(title: string): void {
        for (const [rowTitle, row] of this._rowByTitle) {
            row.className = rowTitle === title ? 'sb-story-row sb-story-row-selected' : 'sb-story-row';
        }
    }

    setPreviewTitle(title: string): void {
        this._previewTitle.title = title;
    }

    showPreview(instance: StoryView): void {
        this._previewSlot.removeChildren();
        this._previewSlot.addChild(instance.view);
    }

    renderControls(rows: Array<ControlRow<unknown>>): void {
        this._controlsGroup.listbox.removeChildren();
        for (const row of rows) this._controlsGroup.addRow(row.view as View);
    }

    private _buildControls(story: StoryView): Array<ControlRow<unknown>> {
        const rows: Array<ControlRow<unknown>> = [];
        const controls = story.meta.controls;
        if (Array.isArray(controls)) {
            for (const control of controls) {
                if (!control?.name || !control?.type) {
                    console.warn('Invalid control configuration:', control);
                    continue;
                }
                const built = createControlRow(story, control);
                if (built) rows.push(built);
            }
        }
        return rows;
    }

    private _buildUI(): void {
        // Each pane is an AdwToolbarView with its OWN header bar — the collapsed
        // navigation split shows one pane at a time, so only that pane's header is
        // visible. There is NO page-level ActionBar (set on the NS Page), so the
        // app shows a SINGLE header bar, matching the GTK storybook where each
        // Adw.NavigationPage carries its own Adw.HeaderBar.

        // --- Sidebar pane (master): header "Adwaita Storybook" + story list ---
        const sidebar = new AdwToolbarView();
        sidebar.className = `${sidebar.className} sb-sidebar-pane`.trim();

        const sidebarHeader = new AdwHeaderBar();
        sidebarHeader.className = `${sidebarHeader.className} sb-sidebar-header`.trim();
        const sidebarTitle = new AdwWindowTitle();
        sidebarTitle.title = this._options.title ?? 'Stories';
        sidebarHeader.setTitleWidget(sidebarTitle);
        sidebar.addTopBar(sidebarHeader);

        this._listColumn = new StackLayout();
        this._listColumn.orientation = 'vertical';
        this._listColumn.className = 'sb-sidebar-list';
        const sidebarScroll = new ScrollView();
        sidebarScroll.className = 'sb-sidebar-scroll';
        sidebarScroll.content = this._listColumn;
        sidebar.setContent(sidebarScroll);
        this.root.setSidebar(sidebar);

        // --- Detail pane: a header bar (back + story title + a controls toggle)
        //     over an OverlaySplitView whose content is the preview and whose
        //     RIGHT (sidebar_position=END) overlay is the controls — the GTK
        //     preview NavigationPage + its OverlaySplitView controls sidebar. ---
        const detail = new AdwToolbarView();
        detail.className = `${detail.className} sb-content-pane`.trim();

        const header = new AdwHeaderBar();
        header.className = `${header.className} sb-detail-header`.trim();
        const back = new AdwImageButton();
        back.icon = goPreviousSymbolic;
        back.className = `${back.className} sb-back-button`.trim();
        back.addEventListener('tap', () => this.root.showSidebarPane());
        header.packStart(back);

        this._previewTitle = new AdwWindowTitle();
        this._previewTitle.title = 'Preview';
        header.setTitleWidget(this._previewTitle);

        const controlsToggle = new AdwImageButton();
        controlsToggle.icon = sidebarShowRightSymbolic;
        controlsToggle.className = `${controlsToggle.className} sb-controls-toggle`.trim();
        controlsToggle.addEventListener('tap', () => {
            this._controlsSplit.showSidebar = !this._controlsSplit.showSidebar;
        });
        header.packEnd(controlsToggle);
        detail.addTopBar(header);

        // The overlay split: preview as content, controls as a right overlay.
        this._controlsSplit = new AdwOverlaySplitView();
        this._controlsSplit.collapsed = true;
        this._controlsSplit.sidebarPosition = 'end';
        this._controlsSplit.sidebarWidth = 320;
        this._controlsSplit.className = `${this._controlsSplit.className} sb-controls-split`.trim();

        this._previewSlot = new StackLayout();
        this._previewSlot.orientation = 'vertical';
        this._previewSlot.className = 'sb-preview-pane';
        const previewScroll = new ScrollView();
        previewScroll.className = 'sb-preview-scroll';
        previewScroll.content = this._previewSlot;
        this._controlsSplit.setContent(previewScroll);

        this._controlsGroup = new AdwPreferencesGroup();
        this._controlsGroup.title = 'Controls';
        this._controlsGroup.className = `${this._controlsGroup.className} sb-controls-group`.trim();
        const controlsScroll = new ScrollView();
        controlsScroll.className = 'sb-controls-scroll';
        controlsScroll.content = this._controlsGroup;
        this._controlsSplit.setSidebar(controlsScroll);
        // Controls start hidden (full-width preview); the toggle reveals the right
        // overlay — the phone form of the GTK collapsed OverlaySplitView.
        this._controlsSplit.hideSidebarPane();

        detail.setContent(this._controlsSplit);
        this.root.setContent(detail);

        // Start on the story list (the master pane).
        this.root.showSidebarPane();
    }
}

/** Construct, mount, and return a {@link StorybookNativeApp} root view + controller. */
export function runStorybook(options: StorybookNativeOptions): StorybookNativeApp {
    const app = new StorybookNativeApp(options);
    app.mount();
    return app;
}
