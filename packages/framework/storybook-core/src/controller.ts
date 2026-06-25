// StorybookController — the renderer-agnostic app state machine.
//
// Original implementation, extracting the shared controller logic from the
// three app classes:
//   - @gjsify/storybook            StorybookWindow
//   - @gjsify/adwaita-storybook    StorybookWebApp
//   - @gjsify/storybook-nativescript  StorybookNativeApp
//
// All three owned a StoryRegistry, registered + instantiated modules, grouped
// stories by their `Category/Name` title prefix, showed a selected story, wired
// its controls (refreshers + an `onArgsChanged` subscription, unsubscribing the
// previous), and exposed the SAME MCP/devtools surface
// (`activeStory`/`listStories`/`openStoryByTitle`/`getCurrentStory`/`setActiveArg`).
// The only differences were the widget toolkit and the breakpoint/fold — both
// adapter-owned. This controller owns everything else; the renderer supplies a
// {@link StorybookView} (render seams) + a `buildControls` builder.

import type { StoryArgs, StoryArgValue, StoryControl } from '@gjsify/stories';
import type { ControlRow } from './controls.js';
import { StoryRegistry, type StoryModuleLike } from './registry.js';

/** The shape every renderer's story instance exposes to the controller. */
export interface StoryInstanceLike {
    readonly meta: { title: string; description?: string; controls?: StoryControl[] };
    readonly story: string;
    readonly args: StoryArgs;
    initialize(): void;
    setArg(name: string, value: StoryArgValue): void;
    onArgsChanged(listener: (args: StoryArgs) => void): () => void;
}

/** A category group for the sidebar — the category name + its story instances. */
export interface CategoryGroup<TInstance> {
    /** The `Category` prefix of the stories' titles. */
    category: string;
    /** `{ instance, name }` per story — `name` is the post-`/` part of the title. */
    stories: Array<{ instance: TInstance; name: string }>;
}

/** A flat description of a story, returned by {@link StorybookController.listStories}. */
export interface StorySummary {
    title: string;
    story: string;
    category: string;
    controls: unknown[];
}

/**
 * The render seams the controller drives — each is a renderer-specific view
 * operation. The breakpoint/fold is NOT here (adapter-owned).
 *
 * @typeParam TInstance the renderer's story-instance type.
 */
export interface StorybookView<TInstance> {
    /** Build the category-grouped story list; `onSelect(instance)` selects a story. */
    renderSidebar(groups: Array<CategoryGroup<TInstance>>, onSelect: (instance: TInstance) => void): void;
    /** Mark the sidebar row for `title` as selected (others deselected). */
    markSelected(title: string): void;
    /** Set the preview header title. */
    setPreviewTitle(title: string): void;
    /** Show `instance` in the preview area. */
    showPreview(instance: TInstance): void;
    /** Replace the controls panel with `rows` (already built + wired). */
    renderControls(rows: Array<ControlRow<unknown>>): void;
}

/**
 * Drives a storybook: registers + instantiates modules, groups them, shows a
 * story and wires its controls, and exposes the MCP/devtools control surface.
 *
 * @typeParam TInstance the renderer's story-instance type.
 */
export class StorybookController<TInstance extends StoryInstanceLike> {
    private _registry = new StoryRegistry<TInstance>();
    private _view: StorybookView<TInstance>;
    private _buildControls: (instance: TInstance) => Array<ControlRow<unknown>>;

    private _activeStory: TInstance | null = null;
    private _unsubArgs: (() => void) | null = null;

    /**
     * @param view          the render seams.
     * @param buildControls builds + wires the control rows for a story (typically
     *                      `instance.meta.controls.map(c => bindControl(...))`).
     */
    constructor(view: StorybookView<TInstance>, buildControls: (instance: TInstance) => Array<ControlRow<unknown>>) {
        this._view = view;
        this._buildControls = buildControls;
    }

    /**
     * Register + instantiate `modules`, render the sidebar, and (when
     * `openFirst`) select the first story.
     */
    mount(modules: StoryModuleLike<TInstance, new () => TInstance>[], openFirst = true): void {
        this._registry.registerStories(modules);
        const instantiated = this._registry.createStoryInstances();
        this._view.renderSidebar(this._groupByCategory(instantiated), (instance) => this.select(instance));

        if (openFirst) {
            const first = this._firstStory();
            if (first) this.select(first);
        }
    }

    /** Select + show a story instance, wiring its controls. */
    select(instance: TInstance): void {
        this._view.setPreviewTitle(`${instance.meta.title} — ${instance.story}`);
        this._view.showPreview(instance);
        this._view.markSelected(instance.meta.title);
        this._wireControls(instance);
        this._activeStory = instance;
    }

    private _wireControls(instance: TInstance): void {
        // Unsubscribe the previous story's args subscription before rebuilding.
        if (this._unsubArgs) {
            this._unsubArgs();
            this._unsubArgs = null;
        }

        const rows = this._buildControls(instance);
        const refreshers = rows.map((row) => row.refresh);
        this._view.renderControls(rows);

        // Re-sync every control widget when the story's args change (e.g. a
        // toggle clicked directly in the preview, or a host-driven setArg).
        this._unsubArgs = instance.onArgsChanged((args) => {
            for (const refresh of refreshers) refresh(args);
        });
    }

    private _groupByCategory(
        modules: StoryModuleLike<TInstance, new () => TInstance>[],
    ): Array<CategoryGroup<TInstance>> {
        const byCategory = new Map<string, CategoryGroup<TInstance>['stories']>();
        for (const module of modules) {
            for (const instance of module.instances ?? []) {
                const parts = instance.meta.title.split('/');
                const category = parts[0];
                const name = parts.length > 1 ? parts[1] : instance.meta.title;
                if (!byCategory.has(category)) byCategory.set(category, []);
                byCategory.get(category)!.push({ instance, name: name || 'Unnamed' });
            }
        }
        return [...byCategory].map(([category, stories]) => ({ category, stories }));
    }

    // --- MCP / devtools control surface (mirrors all three apps) ---

    /** The currently-displayed story, or null. */
    get activeStory(): TInstance | null {
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
        this.select(instance);
        return true;
    }

    /** The active story as `{ title, story, args }`, or null. */
    getCurrentStory(): { title: string; story: string; args: StoryArgs } | null {
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

    private _findByTitle(title: string): TInstance | null {
        for (const module of this._registry.getStories()) {
            for (const instance of module.instances ?? []) {
                if (instance.meta.title === title) return instance;
            }
        }
        return null;
    }

    private _firstStory(): TInstance | null {
        for (const module of this._registry.getStories()) {
            const first = (module.instances ?? [])[0];
            if (first) return first;
        }
        return null;
    }
}
