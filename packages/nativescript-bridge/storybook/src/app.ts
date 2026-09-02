// StorybookNativeApp — the NativeScript component browser (story SIDEBAR, PREVIEW,
// CONTROLS panel), counterpart of @gjsify/adwaita-storybook's StorybookWebApp and
// @gjsify/storybook's StorybookWindow, built from REAL @gjsify/adwaita-nativescript
// widgets. Nothing compares the three renderers' rendered OUTPUT — a screenshot harness
// is NOT implemented (#1052); their behaviour is held by the
// @gjsify/adwaita-core/conformance vectors both renderer suites assert against.
//
// The app state machine (register/instantiate, category grouping, show + wire controls,
// the MCP control surface) lives in @gjsify/storybook-core's StorybookController. This
// class is the NS StorybookView<StoryView> and owns only the chrome (_buildUI): an
// AdwNavigationSplitView that ADAPTS to width via an AdwBreakpoint, collapsed to
// master→detail on a phone and three side-by-side panes above the breakpoint.

import type { StoryArgValue } from '@gjsify/stories';
import {
    type CategoryGroup,
    type ControlRow,
    StorybookController,
    type StorybookView,
    type StorySummary,
} from '@gjsify/storybook-core';
import {
    type AdwPreferencesDialog,
    AdwBreakpoint,
    AdwHeaderBar,
    AdwImageButton,
    AdwNavigationSplitView,
    AdwOverlaySplitView,
    AdwPreferencesGroup,
    AdwToolbarView,
    AdwWindowTitle,
    addBreakpoints,
    attachRowPressFeedback,
    setAdwaitaColorScheme,
} from '@gjsify/adwaita-nativescript';
import { colorSelectSymbolic, goPreviousSymbolic, sidebarShowRightSymbolic } from '@gjsify/adwaita-icons/actions';
import { Label, Screen, ScrollView, StackLayout, type View } from '@nativescript/core';

/** The GTK storybook's own breakpoint: below it phone layout, at or above it three panes. */
const COLLAPSE_CONDITION = 'max-width: 720sp';
import { buildAppearanceDialog, installAppearanceDialog, StorybookNsAppearance } from './appearance.js';
import { createControlRow } from './controls.js';
import type { StoryView } from './story-view.js';
import type { NsStoryModule } from './types.js';

export type { StorySummary } from '@gjsify/storybook-core';

/**
 * The slice of NativeScript's `Application` the storybook reads to follow the OS
 * color scheme. Pass `Application` from `@nativescript/core` — it satisfies this
 * shape. Kept structural so the package needs no `@nativescript/core` value import.
 */
export interface NsAppearanceSource {
    /** Current OS appearance (`'light'` / `'dark'`), or null when unknown. */
    systemAppearance(): 'light' | 'dark' | null | undefined;
}

/** Options that adapt the storybook to a host project. */
export interface StorybookNativeOptions {
    /** Story modules to display. */
    stories: NsStoryModule[];
    /** Title shown in the sidebar header. */
    title?: string;
    /** Auto-select the first story on mount (default true). */
    openFirst?: boolean;
    /**
     * The NativeScript `Application`. When given, the storybook follows the OS color
     * scheme: NS already flips `ns-dark` on the root view, and this keeps the symbolic
     * ICON bitmaps recoloured to match (they are pre-coloured, outside CSS's reach).
     */
    application?: NsAppearanceSource;
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
    /** Back button (visible only in collapsed/phone layout). */
    private _backButton!: AdwImageButton;
    /** Accent for the whole storybook, not for one story. */
    private _appearance = new StorybookNsAppearance();
    private _appearanceDialog: AdwPreferencesDialog | null = null;

    private _rowByTitle = new Map<string, StackLayout>();

    /** Current layout mode — true = collapsed (phone), false = three-pane (wide). */
    private _collapsed = true;
    /** Detaches the responsive breakpoint listeners on teardown. */
    private _disposeBreakpoint: (() => void) | null = null;

    constructor(options: StorybookNativeOptions) {
        this._options = options;
        this.root = new AdwNavigationSplitView();
        // Seed the layout mode from the screen width so a wide tablet/desktop opens
        // straight into three panes (no phone-layout flash); the AdwBreakpoint then
        // keeps it exact against the live window width.
        this._collapsed = !this._isWideWidth(Screen.mainScreen?.widthDIPs ?? 0);
        this.root.collapsed = this._collapsed;
        this.root.className = 'sb-window';
    }

    /** Whether `width` (DIPs) is at/above the three-pane breakpoint (720sp). */
    private _isWideWidth(width: number): boolean {
        return width >= 720;
    }

    /** Build the UI, instantiate stories, and select the first one. Returns the root view. */
    mount(): View {
        this._buildUI();
        this._controller.mount(this._options.stories, this._options.openFirst !== false);
        this._wireColorScheme();
        this._wireBreakpoint();

        // The dialog must already BE in the tree: `present()` only flips its own
        // visibility. Installed ONCE — `mount()` runs on every `onNavigatingTo`, and
        // adding it twice re-parents a view NS refuses to re-parent.
        if (!this._appearanceDialog) {
            this._appearanceDialog = buildAppearanceDialog(this._appearance);
            installAppearanceDialog(this.root, this._appearanceDialog);
        }
        return this.root;
    }

    private _presentAppearance(): void {
        this._appearanceDialog?.present();
    }

    /** Driven by the root view's post-layout width; seeds immediately so the first paint is correct. */
    private _wireBreakpoint(): void {
        const breakpoint = new AdwBreakpoint(COLLAPSE_CONDITION, {
            onApply: () => this._applyLayoutMode(true), // narrow → collapse
            onUnapply: () => this._applyLayoutMode(false), // wide → three panes
        });
        this._disposeBreakpoint = addBreakpoints(this.root, [breakpoint]);
    }

    /**
     * Switch between collapsed (phone) and expanded (wide) chrome. Collapsed: the
     * master/detail nav swaps panes, the controls are a tap-to-reveal overlay, and the
     * back button shows. Expanded: three panes side by side, no back button.
     */
    private _applyLayoutMode(collapsed: boolean): void {
        if (collapsed === this._collapsed && this.root.collapsed === collapsed) return;
        this._collapsed = collapsed;
        this.root.collapsed = collapsed;
        // Hiding/restoring the controls overlay with the collapse is
        // `Adw.OverlaySplitView`'s own unpinned coupling, not something to hand-roll here.
        this._controlsSplit.collapsed = collapsed;
        // Either way, start on the master list. The back button lives in the detail
        // header, so it only makes sense in the phone layout.
        this.root.showSidebarPane();
        this._backButton.visibility = collapsed ? 'visible' : 'collapse';
    }

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

    /**
     * Match the OS color scheme at mount. NS applies `ns-dark` before the first style
     * pass; the pre-coloured symbolic ICON bitmaps are outside CSS's reach, so this sets
     * the global icon scheme to the matching fg.
     *
     * SEED ONLY, deliberately: NS 9.1-alpha does not reliably RE-APPLY the `.ns-dark`
     * overrides at runtime, so a live OS theme switch is picked up on the next launch
     * rather than risking icons that are ahead of a CSS which did not flip.
     */
    private _wireColorScheme(): void {
        const src = this._options.application;
        if (!src?.systemAppearance) return;
        setAdwaitaColorScheme(src.systemAppearance() === 'dark' ? 'dark' : 'light');
    }

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
                attachRowPressFeedback(row);
                // In collapsed layout a tap also navigates to the detail pane; wide, the
                // sidebar stays up and the selection only swaps the preview content.
                row.addEventListener('tap', () => {
                    onSelect(instance);
                    if (this._collapsed) this.root.hideSidebarPane();
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
        // Each pane is an AdwToolbarView with its OWN header bar, and there is NO
        // page-level ActionBar: the collapsed split shows one pane at a time, so exactly
        // one header is visible — as each Adw.NavigationPage carries its own in GTK.

        // --- Sidebar pane (master) ---
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

        // --- Detail pane: header bar (back + title + controls toggle) over an
        //     OverlaySplitView whose content is the preview and whose END overlay is the
        //     controls, as in the GTK storybook. ---
        const detail = new AdwToolbarView();
        detail.className = `${detail.className} sb-content-pane`.trim();

        const header = new AdwHeaderBar();
        header.className = `${header.className} sb-detail-header`.trim();
        const back = new AdwImageButton();
        back.iconName = goPreviousSymbolic;
        back.className = `${back.className} sb-back-button`.trim();
        back.addEventListener('tap', () => this.root.showSidebarPane());
        // Hidden in wide layout — nothing to navigate back from while the sidebar stays
        // up; `_applyLayoutMode` flips it on resize.
        back.visibility = this._collapsed ? 'visible' : 'collapse';
        this._backButton = back;
        header.packStart(back);

        this._previewTitle = new AdwWindowTitle();
        this._previewTitle.title = 'Preview';
        header.setTitleWidget(this._previewTitle);

        const controlsToggle = new AdwImageButton();
        controlsToggle.iconName = sidebarShowRightSymbolic;
        controlsToggle.className = `${controlsToggle.className} sb-controls-toggle`.trim();
        controlsToggle.addEventListener('tap', () => {
            this._controlsSplit.showSidebar = !this._controlsSplit.showSidebar;
        });
        // Appearance belongs to the STORYBOOK, so it sits in the chrome next to the
        // controls toggle rather than in any story's controls.
        const appearance = new AdwImageButton();
        appearance.iconName = colorSelectSymbolic;
        appearance.className = `${appearance.className} sb-appearance-button`.trim();
        appearance.addEventListener('tap', () => this._presentAppearance());
        header.packEnd(appearance);
        header.packEnd(controlsToggle);
        detail.addTopBar(header);

        // Preview as content, controls as a right overlay when collapsed or a permanent
        // right pane when expanded.
        this._controlsSplit = new AdwOverlaySplitView();
        this._controlsSplit.collapsed = this._collapsed;
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
        // No show/hide call: the `collapsed` assignment above already left the controls
        // hidden (phone) or up as a permanent right pane (wide).

        detail.setContent(this._controlsSplit);
        this.root.setContent(detail);

        // Start on the story list; in wide layout both panes are visible regardless.
        this.root.showSidebarPane();
    }
}

/** Construct, mount, and return a {@link StorybookNativeApp} root view + controller. */
export function runStorybook(options: StorybookNativeOptions): StorybookNativeApp {
    const app = new StorybookNativeApp(options);
    app.mount();
    return app;
}
