// NativeScript story-module contract — the NS specialisation of
// @gjsify/storybook-core's generic StoryModuleLike, bound to the NS StoryView
// base (mirrors @gjsify/adwaita-storybook's WebStoryModule over StoryElement).

import type { StoryMeta } from '@gjsify/stories';
import type { StoryModuleLike } from '@gjsify/storybook-core';
import type { StoryView } from './story-view.js';

/** Constructor contract for a NS story class: zero-arg `new`, static metadata. */
export interface NsStoryConstructor {
    new (): StoryView;
    getMetadata(): StoryMeta;
}

/** Wraps a story's content-build step (e.g. to install a shared environment). */
export type NsStoryDecorator = (build: () => void, story: StoryView) => void;

/**
 * A group of related NativeScript stories, optionally wrapped by module-level
 * decorators. The NS binding of {@link StoryModuleLike} over {@link StoryView} +
 * {@link NsStoryConstructor}.
 */
export interface NsStoryModule extends StoryModuleLike<StoryView, NsStoryConstructor> {
    stories: NsStoryConstructor[];
    /** Populated by {@link StoryRegistry.createStoryInstances}. */
    instances?: StoryView[];
    /** Decorators applied around every story's `initialize()` in this module. */
    decorators?: NsStoryDecorator[];
}

/** Narrowing guard — `true` when `value` is a {@link NsStoryModule}. */
export function isNsStoryModule(value: unknown): value is NsStoryModule {
    return typeof value === 'object' && value !== null && Array.isArray((value as { stories?: unknown }).stories);
}
