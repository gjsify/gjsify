// @gjsify/storybook-core — StorybookController tests.
// Runs on GJS + Node + browser (pure TS, no platform imports).

import { describe, expect, it } from '@gjsify/unit';
import { ControlType, type StoryArgs, type StoryArgValue, type StoryControl, type StoryMeta } from '@gjsify/stories';
import { StorybookController, type CategoryGroup, type StoryInstanceLike, type StorybookView } from './controller.js';
import type { ControlRow } from './controls.js';
import type { StoryModuleLike } from './registry.js';

/** A mock story instance with the controller's required surface + an args bag. */
class MockStory implements StoryInstanceLike {
    private _args: StoryArgs;
    private _listeners = new Set<(a: StoryArgs) => void>();
    initialized = false;
    constructor(
        readonly meta: { title: string; description?: string; controls?: StoryControl[] },
        readonly story = 'Default',
    ) {
        this._args = {};
        for (const c of meta.controls ?? [])
            this._args[c.name] = (c as { defaultValue?: StoryArgValue }).defaultValue ?? null;
    }
    initialize(): void {
        this.initialized = true;
    }
    get args(): StoryArgs {
        return this._args;
    }
    setArg(name: string, value: StoryArgValue): void {
        this._args = { ...this._args, [name]: value };
        for (const l of this._listeners) l(this._args);
    }
    onArgsChanged(listener: (a: StoryArgs) => void): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }
}

/** A recording mock view that captures every render seam call. */
class MockView implements StorybookView<MockStory> {
    sidebar: Array<CategoryGroup<MockStory>> = [];
    onSelect: ((s: MockStory) => void) | null = null;
    selectedTitle: string | null = null;
    previewTitle: string | null = null;
    shown: MockStory | null = null;
    controls: Array<ControlRow<unknown>> = [];
    renderControlsCalls = 0;

    renderSidebar(groups: Array<CategoryGroup<MockStory>>, onSelect: (s: MockStory) => void): void {
        this.sidebar = groups;
        this.onSelect = onSelect;
    }
    markSelected(title: string): void {
        this.selectedTitle = title;
    }
    setPreviewTitle(title: string): void {
        this.previewTitle = title;
    }
    showPreview(instance: MockStory): void {
        this.shown = instance;
    }
    renderControls(rows: Array<ControlRow<unknown>>): void {
        this.controls = rows;
        this.renderControlsCalls++;
    }
}

const ctrl = (name: string): StoryControl => ({ type: ControlType.TEXT, name, label: name });

function makeModule(...metas: StoryMeta[]): StoryModuleLike<MockStory, new () => MockStory> {
    return {
        stories: metas.map(
            (m) =>
                class extends MockStory {
                    constructor() {
                        super(m);
                    }
                },
        ),
    };
}

export default async () => {
    await describe('StorybookController.mount', async () => {
        await it('groups stories by category and selects the first', () => {
            const view = new MockView();
            const controller = new StorybookController<MockStory>(view, () => []);
            const module = makeModule(
                { title: 'Rows/Action', controls: [] },
                { title: 'Rows/Switch', controls: [] },
                { title: 'Chrome/Button', controls: [] },
            );
            controller.mount([module]);

            expect(view.sidebar.map((g) => g.category)).toStrictEqual(['Rows', 'Chrome']);
            expect(view.sidebar[0]!.stories.map((s) => s.name)).toStrictEqual(['Action', 'Switch']);
            // First story selected.
            expect(view.previewTitle).toBe('Rows/Action — Default');
            expect(view.selectedTitle).toBe('Rows/Action');
            expect(view.shown).not.toBeNull();
        });

        await it('lands on the story the sidebar leads with, not the one found first', () => {
            // The two were the same list until categories gained a declared
            // order. Discovery hands `Buttons` over first here while the sidebar
            // has to lead with `Overview`; reading the landing story off the
            // registry instead opens a story the sidebar does not show at the
            // top, which is what the reordering first shipped.
            const view = new MockView();
            const controller = new StorybookController<MockStory>(view, () => []);
            controller.mount([
                makeModule({ title: 'Buttons/Button Content', controls: [] }),
                makeModule({ title: 'Overview/Widgets', controls: [] }),
            ]);

            expect(view.sidebar.map((g) => g.category)).toStrictEqual(['Overview', 'Buttons']);
            expect(view.selectedTitle).toBe('Overview/Widgets');
            expect(view.previewTitle).toBe('Overview/Widgets — Default');
        });

        await it('honours openFirst=false', () => {
            const view = new MockView();
            const controller = new StorybookController<MockStory>(view, () => []);
            controller.mount([makeModule({ title: 'Rows/X', controls: [] })], false);
            expect(view.previewTitle).toBeNull();
            expect(controller.activeStory).toBeNull();
        });

        await it('falls back name to the full title when there is no slash', () => {
            const view = new MockView();
            const controller = new StorybookController<MockStory>(view, () => []);
            controller.mount([makeModule({ title: 'Standalone', controls: [] })], false);
            expect(view.sidebar[0]!.stories[0]!.name).toBe('Standalone');
        });
    });

    await describe('StorybookController.select → wire → refresh', async () => {
        await it('builds controls, renders them, and refreshes on args change', () => {
            const view = new MockView();
            const refreshed: StoryArgs[] = [];
            const buildControls = (instance: MockStory): Array<ControlRow<unknown>> =>
                (instance.meta.controls ?? []).map((c) => ({
                    view: c.name,
                    refresh: (args: StoryArgs) => refreshed.push(args),
                }));
            const controller = new StorybookController<MockStory>(view, buildControls);
            controller.mount([makeModule({ title: 'Rows/Action', controls: [ctrl('title')] })]);

            expect(view.controls.length).toBe(1);
            // Args change fires the refreshers.
            controller.activeStory!.setArg('title', 'Changed');
            expect(refreshed.length).toBe(1);
            expect(refreshed[0]!.title).toBe('Changed');
        });

        await it('unsubscribes the previous story when selecting another', () => {
            const view = new MockView();
            const refreshed: string[] = [];
            const buildControls = (instance: MockStory): Array<ControlRow<unknown>> =>
                (instance.meta.controls ?? []).map((c) => ({
                    view: c.name,
                    refresh: () => refreshed.push(instance.meta.title),
                }));
            const controller = new StorybookController<MockStory>(view, buildControls);
            const m1 = makeModule({ title: 'A/One', controls: [ctrl('x')] });
            const m2 = makeModule({ title: 'B/Two', controls: [ctrl('y')] });
            controller.mount([m1, m2]);

            const first = m1.instances![0]!;
            const second = m2.instances![0]!;
            // First is active; select second.
            controller.select(second);
            // Mutating the first must no longer trigger refreshers.
            first.setArg('x', '1');
            expect(refreshed).toStrictEqual([]);
            // Mutating the active (second) does.
            second.setArg('y', '2');
            expect(refreshed).toStrictEqual(['B/Two']);
        });
    });

    await describe('StorybookController MCP/devtools surface', async () => {
        const setup = () => {
            const view = new MockView();
            const controller = new StorybookController<MockStory>(view, () => []);
            controller.mount([
                makeModule({ title: 'Rows/Action', controls: [ctrl('title')] }, { title: 'Rows/Switch', controls: [] }),
            ]);
            return controller;
        };

        await it('listStories flattens every story to a summary', () => {
            const list = setup().listStories();
            expect(list.map((s) => s.title)).toStrictEqual(['Rows/Action', 'Rows/Switch']);
            expect(list[0]!.category).toBe('Rows');
            expect(list[0]!.story).toBe('Default');
            expect(list[0]!.controls.length).toBe(1);
        });

        await it('openStoryByTitle selects a known title and returns false otherwise', () => {
            const controller = setup();
            expect(controller.openStoryByTitle('Rows/Switch')).toBe(true);
            expect(controller.activeStory!.meta.title).toBe('Rows/Switch');
            expect(controller.openStoryByTitle('Nope/Missing')).toBe(false);
        });

        await it('getCurrentStory returns the active story shape, setActiveArg writes', () => {
            const controller = setup();
            expect(controller.getCurrentStory()!.title).toBe('Rows/Action');
            expect(controller.setActiveArg('title', 'X')).toBe(true);
            expect(controller.getCurrentStory()!.args.title).toBe('X');
        });

        await it('setActiveArg returns false with no active story', () => {
            const view = new MockView();
            const controller = new StorybookController<MockStory>(view, () => []);
            controller.mount([makeModule({ title: 'A/B', controls: [] })], false);
            expect(controller.setActiveArg('x', 1)).toBe(false);
            expect(controller.getCurrentStory()).toBeNull();
        });
    });
};
