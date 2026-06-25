// buildStorybookDevtoolsExtension — renderer-neutral storybook devtools surface.
//
// Original implementation, extracting the method set from @gjsify/storybook's
// devtools-extension.ts (`storybookDevtoolsExtension`) so the GTK and NS
// devtools bridges share ONE definition of the storybook control methods. The
// GTK extension built a `DevtoolsExtension` ({ methodsXml, handlers, methodKinds,
// contributeStatus }) bound to its `StorybookWindow`; here the same five methods
// delegate to a {@link StorybookController}, returned as a plain handlers record
// each bridge adapts (the GTK bridge wraps it back into a `DevtoolsExtension`,
// the NS bridge into its MethodRegistry entries).

import type { StoryArgs } from '@gjsify/stories';
import type { StorybookController, StoryInstanceLike, StorySummary } from './controller.js';

/** Pause classification for a devtools method (matches @gjsify/devtools-protocol's MethodKind). */
export type StorybookMethodKind = 'read-only' | 'mutating';

/** One renderer-neutral storybook devtools method. */
export interface StorybookDevtoolsMethod {
    /** Method name (the same names the GTK extension used). */
    name: string;
    /** Whether the method mutates state (the pause guard rejects mutating methods when paused). */
    kind: StorybookMethodKind;
    /** Implementation — positional args, JSON-string-or-boolean return (the DBus shape). */
    handler: (...args: never[]) => unknown;
}

/** The renderer-neutral storybook devtools surface. */
export interface StorybookDevtoolsExtension {
    /** The five storybook methods, keyed by name + as an ordered list. */
    methods: StorybookDevtoolsMethod[];
    /** Extra keys for `GetStatus()` — `{ storybook: { currentStory, storyCount } }`. */
    contributeStatus: () => Record<string, unknown>;
}

/**
 * Build the renderer-neutral storybook devtools surface over a controller. The
 * five methods preserve the names + JSON shapes the GTK extension defined:
 *
 *   - `ListStories`     → JSON array of {@link StorySummary}      (read-only)
 *   - `GetCurrentStory` → JSON `{ title, story, args } | null`    (read-only)
 *   - `OpenStory(title)`→ boolean opened                          (mutating)
 *   - `SetStoryArg(name, valueJson)` → boolean applied            (mutating)
 *   - `GetStoryArgs`    → JSON of the active story's args         (read-only)
 */
export function buildStorybookDevtoolsExtension<TInstance extends StoryInstanceLike>(
    controller: StorybookController<TInstance>,
): StorybookDevtoolsExtension {
    const currentStory = (): { title: string; story: string; args: StoryArgs } | null => controller.getCurrentStory();

    const methods: StorybookDevtoolsMethod[] = [
        {
            name: 'ListStories',
            kind: 'read-only',
            handler: (() => JSON.stringify(controller.listStories(), null, 2)) as (...args: never[]) => unknown,
        },
        {
            name: 'GetCurrentStory',
            kind: 'read-only',
            handler: (() => JSON.stringify(currentStory(), null, 2)) as (...args: never[]) => unknown,
        },
        {
            name: 'OpenStory',
            kind: 'mutating',
            handler: ((title: string) => controller.openStoryByTitle(title)) as (...args: never[]) => unknown,
        },
        {
            name: 'SetStoryArg',
            kind: 'mutating',
            handler: ((name: string, valueJson: string) =>
                controller.setActiveArg(name, valueJson ? JSON.parse(valueJson) : null)) as (
                ...args: never[]
            ) => unknown,
        },
        {
            name: 'GetStoryArgs',
            kind: 'read-only',
            handler: (() => JSON.stringify(currentStory()?.args ?? {}, null, 2)) as (...args: never[]) => unknown,
        },
    ];

    return {
        methods,
        contributeStatus: () => {
            const s = currentStory();
            const list: StorySummary[] = controller.listStories();
            return {
                storybook: {
                    currentStory: s ? { title: s.title, story: s.story } : null,
                    storyCount: list.length,
                },
            };
        },
    };
}
