// @gjsify/storybook — devtools extension exposing the story surface over org.gjsify.Devtools.
// Original implementation.

import type { DevtoolsExtension } from '@gjsify/devtools';
import type { StoryRegistryService } from './registry.js';
import type { StorybookWindow } from './window.js';

/**
 * Build a {@link DevtoolsExtension} that exposes the storybook's story surface
 * — list/open stories, read/set the active story's args — so an agent (via the
 * MCP bridge) can drive and debug widgets in isolation. Wired by
 * {@link runStorybook} when `GJSIFY_DEVTOOLS` is set.
 */
export function storybookDevtoolsExtension(
    registry: StoryRegistryService,
    window: StorybookWindow,
): DevtoolsExtension {
    const listStories = () =>
        registry.getStories().flatMap((module) =>
            (module.instances ?? []).map((instance) => ({
                title: instance.meta.title,
                story: instance.story,
                category: instance.meta.title.split('/')[0],
                controls: instance.meta.controls ?? [],
            })),
        );

    return {
        methodsXml: [
            '<method name="ListStories"><arg type="s" direction="out" name="stories_json"/></method>',
            '<method name="GetCurrentStory"><arg type="s" direction="out" name="story_json"/></method>',
            '<method name="OpenStory"><arg type="s" direction="in" name="title"/><arg type="b" direction="out" name="opened"/></method>',
            '<method name="SetStoryArg"><arg type="s" direction="in" name="name"/><arg type="s" direction="in" name="value_json"/><arg type="b" direction="out" name="applied"/></method>',
            '<method name="GetStoryArgs"><arg type="s" direction="out" name="args_json"/></method>',
        ],
        handlers: {
            ListStories: () => JSON.stringify(listStories(), null, 2),
            GetCurrentStory: () => {
                const s = window.activeStory;
                return JSON.stringify(s ? { title: s.meta.title, story: s.story, args: s.args } : null, null, 2);
            },
            OpenStory: (title: string) => window.openStoryByTitle(title),
            SetStoryArg: (name: string, valueJson: string) =>
                window.setActiveArg(name, valueJson ? JSON.parse(valueJson) : null),
            GetStoryArgs: () => JSON.stringify(window.activeStory?.args ?? {}, null, 2),
        },
        methodKinds: {
            ListStories: 'read-only',
            GetCurrentStory: 'read-only',
            OpenStory: 'mutating',
            SetStoryArg: 'mutating',
            GetStoryArgs: 'read-only',
        },
        contributeStatus: () => {
            const s = window.activeStory;
            return {
                storybook: {
                    currentStory: s ? { title: s.meta.title, story: s.story } : null,
                    storyCount: listStories().length,
                },
            };
        },
    };
}
