// Story discovery helper — pure, platform-free, so it is unit-testable on any
// runtime and importable from each renderer's `gjsify storybook` generated entry.
//
// Original implementation, moved verbatim from @gjsify/storybook's discover.ts
// and made generic over the renderer's story-module type.

import { isStoryModule } from '@gjsify/stories';
import type { StoryModuleLike } from './registry.js';

/**
 * Flatten a list of module namespaces (the `import * as m from './x.story.js'`
 * objects the `gjsify storybook` command generates) into the story modules they
 * export — regardless of the export name. Any exported value shaped like a story
 * module (an object with a `stories` array) is collected.
 *
 * @typeParam TInstance the renderer's story-instance type.
 */
export function collectStoryModules<TInstance extends { initialize(): void }>(
    namespaces: Array<Record<string, unknown>>,
): StoryModuleLike<TInstance, new () => TInstance>[] {
    const modules: StoryModuleLike<TInstance, new () => TInstance>[] = [];
    for (const namespace of namespaces) {
        if (!namespace || typeof namespace !== 'object') continue;
        for (const value of Object.values(namespace)) {
            if (isStoryModule(value)) {
                modules.push(value as unknown as StoryModuleLike<TInstance, new () => TInstance>);
            }
        }
    }
    return modules;
}
