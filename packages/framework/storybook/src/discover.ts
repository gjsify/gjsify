// Story discovery — the GTK renderer re-exports the renderer-agnostic
// collectStoryModules from @gjsify/storybook-core, specialised to the GTK
// StoryModule type so the `gjsify storybook` generated entry keeps importing
// `{ collectStoryModules } from '@gjsify/storybook'`.

import { collectStoryModules as collectStoryModulesCore } from '@gjsify/storybook-core';
import type { StoryModule } from './story-widget.js';

/**
 * Flatten a list of module namespaces (the `import * as m from './x.story.js'`
 * objects the `gjsify storybook` command generates) into the GTK story modules
 * they export — regardless of the export name. Any exported value shaped like a
 * story module (an object with a `stories` array) is collected.
 */
export function collectStoryModules(namespaces: Array<Record<string, unknown>>): StoryModule[] {
    return collectStoryModulesCore<StoryWidgetLike>(namespaces) as unknown as StoryModule[];
}

/** The minimal shape the core registry requires of a story instance. */
interface StoryWidgetLike {
    initialize(): void;
}
