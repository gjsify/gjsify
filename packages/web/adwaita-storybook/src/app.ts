// StorybookWebApp — the browser component browser: a sidebar of stories grouped
// by category, a preview pane, and a controls panel that renders live-bound
// adwaita-web rows from each story's controls. The web counterpart of
// @gjsify/storybook's StorybookWindow, built from @gjsify/adwaita-web custom
// elements so it looks and behaves like the native GTK storybook.

import '@gjsify/adwaita-web'; // registers the custom elements + self-injects the adwaita stylesheet
import type { StoryArgValue } from '@gjsify/stories';
import { createControlRow } from './controls.js';
import { StoryRegistry } from './registry.js';
import type { StoryElement } from './story-element.js';
import { injectStorybookStyles } from './styles.js';
import type { WebStoryModule } from './types.js';

/**
 * Width (px) below which the controls panel folds into an on-demand overlay so
 * the sidebar + preview keep their room — a medium embed (e.g. the docs page)
 * sits below this, a full storybook window above it.
 */
const CONTROLS_BREAKPOINT = 900;

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

/** A flat description of a story, returned by {@link StorybookWebApp.listStories}. */
export interface StorySummary {
    title: string;
    story: string;
    category: string;
    controls: unknown[];
}

/** Tiny element builder — sets attributes and appends children. */
function h(tag: string, attrs: Record<string, string> = {}, children: Array<Node | string> = []): HTMLElement {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    for (const child of children) el.append(child);
    return el;
}

export class StorybookWebApp {
    private _registry = new StoryRegistry();
    private _options: StorybookWebOptions;
    private _container: HTMLElement;

    private _listEl!: HTMLElement;
    private _previewEl!: HTMLElement;
    private _previewTitle!: HTMLElement;
    private _controlsGroup!: HTMLElement;
    private _navSplit!: HTMLElement;
    private _controlsSplit!: HTMLElement;
    private _backBtn!: HTMLElement;

    private _activeStory: StoryElement | null = null;
    private _rowByTitle = new Map<string, HTMLElement>();
    private _refreshers: Array<(args: Record<string, unknown>) => void> = [];
    private _unsubArgs: (() => void) | null = null;

    constructor(container: HTMLElement, options: StorybookWebOptions) {
        this._container = container;
        this._options = options;
    }

    /** Build the UI, instantiate stories, and select the first one. */
    mount(): void {
        injectStorybookStyles();
        this._registry.registerStories(this._options.stories);
        const modules = this._registry.createStoryInstances();
        this._buildUI();
        this._populateSidebar(modules);
        this._observeBreakpoint();
        this._exposeGlobal();

        if (this._options.openFirst !== false) {
            const first = this._firstStory();
            if (first) this._showStory(first);
        }
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

    // --- control surface (mirrors StorybookWindow; driven by host-level MCP via window.__storybook) ---

    /** The currently-displayed story, or null. */
    get activeStory(): StoryElement | null {
        return this._activeStory;
    }

    /** Every story flattened to a summary. */
    listStories(): StorySummary[] {
        return this._registry.getStories().flatMap((module) =>
            (module.instances ?? []).map((instance) => ({
                title: instance.meta.title,
                story: instance.story,
                category: instance.meta.title.split('/')[0],
                controls: instance.meta.controls ?? [],
            })),
        );
    }

    /** Select + show a story by its full `Category/Name` title. */
    openStoryByTitle(title: string): boolean {
        const instance = this._findByTitle(title);
        if (!instance) return false;
        this._showStory(instance);
        return true;
    }

    /** The active story as `{ title, story, args }`, or null. */
    getCurrentStory(): { title: string; story: string; args: Record<string, unknown> } | null {
        const s = this._activeStory;
        return s ? { title: s.meta.title, story: s.story, args: s.args } : null;
    }

    /** Set one arg on the active story — drives the same path as the controls. */
    setActiveArg(name: string, value: StoryArgValue): boolean {
        const story = this._activeStory;
        if (!story) return false;
        story.setArg(name, value);
        return true;
    }

    private _findByTitle(title: string): StoryElement | null {
        for (const module of this._registry.getStories()) {
            for (const instance of module.instances ?? []) {
                if (instance.meta.title === title) return instance;
            }
        }
        return null;
    }

    private _firstStory(): StoryElement | null {
        for (const module of this._registry.getStories()) {
            const first = (module.instances ?? [])[0];
            if (first) return first;
        }
        return null;
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

    private _populateSidebar(modules: WebStoryModule[]): void {
        this._listEl.replaceChildren();
        this._rowByTitle.clear();

        const categories = new Map<string, StoryElement[]>();
        for (const module of modules) {
            for (const instance of module.instances ?? []) {
                const [category] = instance.meta.title.split('/');
                if (!categories.has(category)) categories.set(category, []);
                categories.get(category)!.push(instance);
            }
        }

        for (const [category, stories] of categories) {
            this._listEl.append(h('div', { class: 'sb-category' }, [category]));
            for (const story of stories) {
                const parts = story.meta.title.split('/');
                const name = parts.length > 1 ? parts[1] : story.meta.title;
                const row = h('div', { class: 'sb-story-row', role: 'button', tabindex: '0' }, [name || 'Unnamed']);
                row.addEventListener('click', () => this._showStory(story));
                row.addEventListener('keydown', (e) => {
                    if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
                        e.preventDefault();
                        this._showStory(story);
                    }
                });
                this._listEl.append(row);
                this._rowByTitle.set(story.meta.title, row);
            }
        }
    }

    private _showStory(story: StoryElement): void {
        this._previewTitle.setAttribute('title', `${story.meta.title} — ${story.story}`);
        this._previewEl.replaceChildren(story.element);

        for (const [title, row] of this._rowByTitle) {
            row.classList.toggle('selected', title === story.meta.title);
        }

        this._updateControlPanel(story);
        this._activeStory = story;

        // When collapsed (narrow), selecting a story navigates to the content
        // pane (push-navigation), mirroring the native split view.
        if ((this._navSplit as HTMLElement & { collapsed: boolean }).collapsed) {
            this._navSplit.setAttribute('show-content', '');
        }
    }

    private _updateControlPanel(story: StoryElement): void {
        const listbox = this._controlsGroup.querySelector('.adw-preferences-group-listbox');
        if (listbox) listbox.replaceChildren();
        this._refreshers = [];
        if (this._unsubArgs) {
            this._unsubArgs();
            this._unsubArgs = null;
        }

        const controls = story.meta.controls;
        if (Array.isArray(controls) && listbox) {
            for (const control of controls) {
                if (!control?.name || !control?.type) {
                    console.warn('Invalid control configuration:', control);
                    continue;
                }
                const built = createControlRow(story, control);
                if (built) {
                    listbox.append(built.element);
                    this._refreshers.push(built.refresh);
                }
            }
        }

        // Re-sync every control widget when the story's args change (e.g. a
        // toggle clicked directly in the preview, or a host-driven setArg).
        this._unsubArgs = story.onArgsChanged((args) => {
            for (const refresh of this._refreshers) refresh(args);
        });
    }

    private _exposeGlobal(): void {
        // Expose a tiny control surface so the host browser's MCP `eval_js` can
        // drive stories without an in-page devtools channel.
        (globalThis as unknown as { __storybook?: unknown }).__storybook = {
            listStories: () => this.listStories(),
            openStory: (title: string) => this.openStoryByTitle(title),
            getCurrentStory: () => this.getCurrentStory(),
            setArg: (name: string, value: StoryArgValue) => this.setActiveArg(name, value),
            getArgs: () => this._activeStory?.args ?? null,
        };
    }
}

/** Construct, mount, and return a {@link StorybookWebApp}. */
export function mountStorybook(container: HTMLElement, options: StorybookWebOptions): StorybookWebApp {
    const app = new StorybookWebApp(container, options);
    app.mount();
    return app;
}
