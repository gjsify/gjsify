// @gjsify/storybook-core — collectStoryModules + buildStorybookDevtoolsExtension tests.
// Runs on GJS + Node + browser (pure TS, no platform imports).

import { describe, expect, it } from '@gjsify/unit';
import { ControlType, type StoryControl, type StoryMeta } from '@gjsify/stories';
import { collectStoryModules } from './discover.js';
import { buildStorybookDevtoolsExtension } from './devtools.js';
import { StorybookController, type StoryInstanceLike, type StorybookView } from './controller.js';
import type { StoryArgs, StoryArgValue } from '@gjsify/stories';

class FakeStory {
    initialize(): void {}
}

export default async () => {
    await describe('collectStoryModules', async () => {
        await it('collects story-module-shaped exports regardless of name', () => {
            const ns = {
                ButtonStory: { stories: [FakeStory] },
                notAModule: { other: true },
                EntryStory: { stories: [FakeStory], decorators: [] },
            };
            const modules = collectStoryModules<FakeStory>([ns]);
            expect(modules.length).toBe(2);
        });

        await it('skips non-object namespaces and non-module values', () => {
            const modules = collectStoryModules<FakeStory>([
                null as unknown as Record<string, unknown>,
                'str' as unknown as Record<string, unknown>,
                { x: 1, y: 'two', z: { stories: 'no' } },
            ]);
            expect(modules.length).toBe(0);
        });

        await it('flattens across multiple namespaces', () => {
            const a = { S: { stories: [FakeStory] } };
            const b = { T: { stories: [FakeStory] }, U: { stories: [FakeStory] } };
            expect(collectStoryModules<FakeStory>([a, b]).length).toBe(3);
        });
    });

    await describe('buildStorybookDevtoolsExtension', async () => {
        // Minimal controller built over mock stories + a no-op view.
        class MockStory implements StoryInstanceLike {
            private _args: StoryArgs = {};
            private _listeners = new Set<(a: StoryArgs) => void>();
            constructor(
                readonly meta: { title: string; controls?: StoryControl[] },
                readonly story = 'Default',
            ) {}
            initialize(): void {}
            get args(): StoryArgs {
                return this._args;
            }
            setArg(name: string, value: StoryArgValue): void {
                this._args = { ...this._args, [name]: value };
                for (const l of this._listeners) l(this._args);
            }
            onArgsChanged(l: (a: StoryArgs) => void): () => void {
                this._listeners.add(l);
                return () => this._listeners.delete(l);
            }
        }
        const noopView: StorybookView<MockStory> = {
            renderSidebar() {},
            markSelected() {},
            setPreviewTitle() {},
            showPreview() {},
            renderControls() {},
        };
        const titleControl: StoryControl = { type: ControlType.TEXT, name: 'title', label: 'Title' };
        const setup = () => {
            const controller = new StorybookController<MockStory>(noopView, () => []);
            controller.mount([
                {
                    stories: [
                        class extends MockStory {
                            constructor() {
                                super({ title: 'Rows/Action', controls: [titleControl] } as StoryMeta);
                            }
                        },
                    ],
                },
            ]);
            return controller;
        };

        await it('preserves the five method names from the GTK extension', () => {
            const ext = buildStorybookDevtoolsExtension(setup());
            expect(ext.methods.map((m) => m.name)).toStrictEqual([
                'ListStories',
                'GetCurrentStory',
                'OpenStory',
                'SetStoryArg',
                'GetStoryArgs',
            ]);
        });

        await it('classifies read-only vs mutating', () => {
            const ext = buildStorybookDevtoolsExtension(setup());
            const kinds = Object.fromEntries(ext.methods.map((m) => [m.name, m.kind]));
            expect(kinds).toStrictEqual({
                ListStories: 'read-only',
                GetCurrentStory: 'read-only',
                OpenStory: 'mutating',
                SetStoryArg: 'mutating',
                GetStoryArgs: 'read-only',
            });
        });

        await it('ListStories returns JSON of the summaries', () => {
            const ext = buildStorybookDevtoolsExtension(setup());
            const list = JSON.parse((ext.methods.find((m) => m.name === 'ListStories')!.handler as () => string)());
            expect(list.length).toBe(1);
            expect(list[0].title).toBe('Rows/Action');
        });

        await it('OpenStory + SetStoryArg + GetCurrentStory round-trip', () => {
            const ext = buildStorybookDevtoolsExtension(setup());
            const byName = Object.fromEntries(ext.methods.map((m) => [m.name, m.handler]));
            expect((byName.OpenStory as (t: string) => boolean)('Rows/Action')).toBe(true);
            expect((byName.SetStoryArg as (n: string, v: string) => boolean)('title', JSON.stringify('Hi'))).toBe(true);
            const current = JSON.parse((byName.GetCurrentStory as () => string)());
            expect(current.title).toBe('Rows/Action');
            expect(current.args.title).toBe('Hi');
        });

        await it('SetStoryArg with empty value writes null', () => {
            const ext = buildStorybookDevtoolsExtension(setup());
            const byName = Object.fromEntries(ext.methods.map((m) => [m.name, m.handler]));
            (byName.OpenStory as (t: string) => boolean)('Rows/Action');
            (byName.SetStoryArg as (n: string, v: string) => boolean)('title', '');
            const args = JSON.parse((byName.GetStoryArgs as () => string)());
            expect(args.title).toBeNull();
        });

        await it('contributeStatus reports the active story + count', () => {
            const ext = buildStorybookDevtoolsExtension(setup());
            const byName = Object.fromEntries(ext.methods.map((m) => [m.name, m.handler]));
            (byName.OpenStory as (t: string) => boolean)('Rows/Action');
            const status = ext.contributeStatus() as {
                storybook: { currentStory: { title: string }; storyCount: number };
            };
            expect(status.storybook.currentStory.title).toBe('Rows/Action');
            expect(status.storybook.storyCount).toBe(1);
        });
    });
};
