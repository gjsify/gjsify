// StorybookWebApp — the browser component browser: a sidebar of stories grouped
// by category, a preview pane, and a controls panel that renders live-bound
// adwaita-web rows from each story's controls. The web counterpart of
// @gjsify/storybook's StorybookWindow, built from @gjsify/adwaita-web custom
// elements so it looks and behaves like the native GTK storybook.
//
// The app state machine (register/instantiate, category grouping, show + wire
// controls, the MCP control surface) lives in @gjsify/storybook-core's
// StorybookController. This class is the browser StorybookView<StoryElement>:
// it owns ONLY the adwaita-web split-views chrome (_buildUI), the browser-only
// responsive breakpoint fold (_observeBreakpoint/_applyBreakpoint), and the
// window.__storybook MCP bridge (_exposeGlobal, delegating to the controller).

import '@gjsify/adwaita-web'; // registers the custom elements + self-injects the adwaita stylesheet
import type { StoryArgValue } from '@gjsify/stories';
import {
    type CategoryGroup,
    type ControlRow,
    StorybookController,
    type StorybookView,
    type StorySummary,
} from '@gjsify/storybook-core';
import { createControlRow } from './controls.js';
import type { StoryElement } from './story-element.js';
import { injectStorybookStyles } from './styles.js';
import type { WebStoryModule } from './types.js';

export type { StorySummary } from '@gjsify/storybook-core';

/**
 * Width (px) below which the controls panel folds into an on-demand overlay so
 * the sidebar + preview keep their room. It docks only in a genuinely roomy
 * standalone window — both embeds sit below this (the docs page ~712px and the
 * home-page slideshow ~907px), so they show sidebar + preview with the controls
 * closed by default (reopen via the header button).
 */
const CONTROLS_BREAKPOINT = 1000;

/** Width (px) below which even the sidebar folds away and nav goes single-pane. */
const NAV_BREAKPOINT = 620;

/** Options that adapt the storybook to a host project. */
export interface StorybookWebOptions {
    /** Story modules to display. */
    stories: WebStoryModule[];
    /** Window title (shown in the sidebar header). */
    title?: string;
    /** Auto-select the first story on mount (default true). */
    openFirst?: boolean;
}

/** Tiny element builder — sets attributes and appends children. */
function h(tag: string, attrs: Record<string, string> = {}, children: Array<Node | string> = []): HTMLElement {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    for (const child of children) el.append(child);
    return el;
}

export class StorybookWebApp implements StorybookView<StoryElement> {
    private _controller = new StorybookController<StoryElement>(this, (story) => this._buildControls(story));
    private _options: StorybookWebOptions;
    private _container: HTMLElement;

    private _listEl!: HTMLElement;
    private _previewEl!: HTMLElement;
    private _previewTitle!: HTMLElement;
    private _controlsGroup!: HTMLElement;
    private _navSplit!: HTMLElement;
    private _controlsSplit!: HTMLElement;
    private _backBtn!: HTMLElement;

    private _rowByTitle = new Map<string, HTMLElement>();

    constructor(container: HTMLElement, options: StorybookWebOptions) {
        this._container = container;
        this._options = options;
    }

    /** Build the UI, instantiate stories, and select the first one. */
    mount(): void {
        injectStorybookStyles();
        this._buildUI();
        this._observeBreakpoint();
        this._exposeGlobal();
        this._controller.mount(this._options.stories, this._options.openFirst !== false);
    }

    /**
     * Adapt the two split views to the available width, the way a desktop
     * Adwaita window sheds panes as it narrows. There are two thresholds:
     *
     *   - below {@link CONTROLS_BREAKPOINT} the controls panel folds away into an
     *     on-demand overlay, so the sidebar + preview keep their room (this is
     *     what a medium embed — e.g. the docs page — wants);
     *   - below {@link NAV_BREAKPOINT} there isn't room for the sidebar either,
     *     so the whole thing goes single-pane and navigates one column at a time.
     */
    private _observeBreakpoint(): void {
        const apply = (): void => this._applyBreakpoint();
        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(apply).observe(this._navSplit);
        } else {
            globalThis.addEventListener?.('resize', apply);
        }
        apply();
    }

    private _applyBreakpoint(): void {
        const width = this._navSplit.clientWidth;
        if (width === 0) return; // not laid out yet — the observer will re-fire
        const navCollapsed = width < NAV_BREAKPOINT;
        const controlsCollapsed = width < CONTROLS_BREAKPOINT;
        const nav = this._navSplit as HTMLElement & { collapsed: boolean };
        const osv = this._controlsSplit as HTMLElement & { collapsed: boolean; showSidebar: boolean };
        if (nav.collapsed !== navCollapsed) nav.collapsed = navCollapsed;
        if (osv.collapsed !== controlsCollapsed) osv.collapsed = controlsCollapsed;
        // Single-pane nav shows the story list first (like native); the back
        // button only appears once a story is pushed onto the content pane.
        this._navSplit.removeAttribute('show-content');
        this._backBtn.hidden = true;
        // The controls panel docks only when there's room; otherwise it's an
        // on-demand overlay so the sidebar + preview keep their space.
        osv.showSidebar = !controlsCollapsed;
    }

    // --- control surface (delegates to the controller; driven by host-level MCP via window.__storybook) ---

    /** The currently-displayed story, or null. */
    get activeStory(): StoryElement | null {
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

    // --- StorybookView<StoryElement> render seams (driven by the controller) ---

    renderSidebar(
        groups: Array<CategoryGroup<StoryElement>>,
        onSelect: (instance: StoryElement) => void,
    ): void {
        this._listEl.replaceChildren();
        this._rowByTitle.clear();

        for (const { category, stories } of groups) {
            this._listEl.append(h('div', { class: 'sb-category' }, [category]));
            for (const { instance, name } of stories) {
                const row = h('div', { class: 'sb-story-row', role: 'button', tabindex: '0' }, [name]);
                row.addEventListener('click', () => onSelect(instance));
                row.addEventListener('keydown', (e) => {
                    if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
                        e.preventDefault();
                        onSelect(instance);
                    }
                });
                this._listEl.append(row);
                this._rowByTitle.set(instance.meta.title, row);
            }
        }
    }

    markSelected(title: string): void {
        for (const [rowTitle, row] of this._rowByTitle) {
            row.classList.toggle('selected', rowTitle === title);
        }
    }

    setPreviewTitle(title: string): void {
        this._previewTitle.setAttribute('title', title);
    }

    showPreview(instance: StoryElement): void {
        this._previewEl.replaceChildren(instance.element);
        // When collapsed (narrow), selecting a story navigates to the content
        // pane (push-navigation), mirroring the native split view.
        if ((this._navSplit as HTMLElement & { collapsed: boolean }).collapsed) {
            this._navSplit.setAttribute('show-content', '');
        }
    }

    renderControls(rows: Array<ControlRow<unknown>>): void {
        const listbox = this._controlsGroup.querySelector('.adw-preferences-group-listbox');
        if (!listbox) return;
        listbox.replaceChildren();
        for (const row of rows) listbox.append(row.view as HTMLElement);
    }

    private _buildControls(story: StoryElement): Array<ControlRow<unknown>> {
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
        // --- Sidebar pane: header + scrollable story list ---
        this._listEl = h('div', { class: 'sb-sidebar-list navigation-sidebar' });
        const sidebarScroll = h('div', { class: 'sb-sidebar-scroll' }, [this._listEl]);
        const sidebarHeader = h('adw-header-bar', { slot: 'top' }, [
            h('adw-window-title', { slot: 'center', title: this._options.title ?? 'Stories' }),
        ]);
        const sidebarPane = h('div', { slot: 'sidebar', class: 'sb-sidebar-pane' }, [
            h('adw-toolbar-view', {}, [sidebarHeader, sidebarScroll]),
        ]);

        // --- Content pane: preview header + (preview | controls) split ---
        this._previewEl = h('div', { class: 'sb-preview-scroll' });

        this._controlsGroup = h('adw-preferences-group', { title: 'Controls' });
        const controlsScroll = h('div', { slot: 'sidebar', class: 'sb-controls-scroll' }, [
            h('div', { class: 'sb-controls-page' }, [this._controlsGroup]),
        ]);
        const previewSlot = h('div', { slot: 'content', class: 'sb-preview-pane' }, [this._previewEl]);

        const controlsSplit = h(
            'adw-overlay-split-view',
            {
                'sidebar-position': 'end',
                'show-sidebar': '',
                'min-sidebar-width': '280',
                'max-sidebar-width': '360',
            },
            [previewSlot, controlsScroll],
        );

        this._controlsSplit = controlsSplit;

        // Back button — only shown when collapsed, returns to the story list.
        this._backBtn = h('button', {
            class: 'adw-header-btn sb-back-btn',
            slot: 'start',
            title: 'Back to stories',
            'aria-label': 'Back to stories',
        });
        this._backBtn.append(h('span', { class: 'adw-icon adw-icon--go-previous' }));
        this._backBtn.hidden = true;
        this._backBtn.addEventListener('click', () => this._navSplit.removeAttribute('show-content'));

        this._previewTitle = h('adw-window-title', { slot: 'center', title: 'Preview' });
        const toggleControls = h('button', {
            class: 'adw-header-btn sb-toggle-controls',
            title: 'Toggle Controls',
            'aria-label': 'Toggle Controls',
        });
        toggleControls.append(h('span', { class: 'adw-icon adw-icon--sidebar-show' }));
        toggleControls.setAttribute('slot', 'end');
        toggleControls.addEventListener('click', () => {
            (controlsSplit as HTMLElement & { showSidebar: boolean }).showSidebar = !(
                controlsSplit as HTMLElement & { showSidebar: boolean }
            ).showSidebar;
        });
        const previewHeader = h('adw-header-bar', { slot: 'top' }, [this._backBtn, this._previewTitle, toggleControls]);

        const contentPane = h('div', { slot: 'content', class: 'sb-content-pane' }, [
            h('adw-toolbar-view', {}, [previewHeader, controlsSplit]),
        ]);

        // --- Outer split + window ---
        this._navSplit = h('adw-navigation-split-view', { 'min-sidebar-width': '220', 'max-sidebar-width': '320' }, [
            sidebarPane,
            contentPane,
        ]);
        const window_ = h('adw-window', { class: 'sb-window' }, [this._navSplit]);
        this._container.replaceChildren(window_);
    }

    private _exposeGlobal(): void {
        // Expose a tiny control surface so the host browser's MCP `eval_js` can
        // drive stories without an in-page devtools channel.
        (globalThis as unknown as { __storybook?: unknown }).__storybook = {
            listStories: () => this.listStories(),
            openStory: (title: string) => this.openStoryByTitle(title),
            getCurrentStory: () => this.getCurrentStory(),
            setArg: (name: string, value: StoryArgValue) => this.setActiveArg(name, value),
            getArgs: () => this.activeStory?.args ?? null,
        };
    }
}

/** Construct, mount, and return a {@link StorybookWebApp}. */
export function mountStorybook(container: HTMLElement, options: StorybookWebOptions): StorybookWebApp {
    const app = new StorybookWebApp(container, options);
    app.mount();
    return app;
}
