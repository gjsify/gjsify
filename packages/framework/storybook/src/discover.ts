// Story discovery helper — pure, GTK-free, so it is unit-testable on any
// runtime and importable from the `gjsify storybook` generated entry.

import { isStoryModule, type StoryModule } from '@gjsify/stories';
import type { StoryModule as GtkStoryModule } from './story-widget.js';

/**
 * Flatten a list of module namespaces (the `import * as m from './x.story.js'`
 * objects the `gjsify storybook` command generates) into the story modules
 * they export — regardless of the export name. Any exported value shaped like a
 * {@link StoryModule} (an object with a `stories` array) is collected.
 */
export function collectStoryModules(namespaces: Array<Record<string, unknown>>): GtkStoryModule[] {
    const modules: StoryModule[] = [];
    for (const namespace of namespaces) {
        if (!namespace || typeof namespace !== 'object') continue;
        for (const value of Object.values(namespace)) {
            if (isStoryModule(value)) {
                modules.push(value);
            }
        }
    }
    return modules as GtkStoryModule[];
}
