// Web story-module contract — the DOM specialisation of @gjsify/storybook-core's
// generic StoryModuleLike, bound to the DOM StoryElement base.

import type { StoryMeta } from '@gjsify/stories';
import type { StoryModuleLike } from '@gjsify/storybook-core';
import type { StoryElement } from './story-element.js';

/** Constructor contract for a web story class: zero-arg `new`, static metadata. */
export interface WebStoryConstructor {
    new (): StoryElement;
    getMetadata(): StoryMeta;
}

/** Wraps a story's content-build step (e.g. to install a shared environment). */
export type WebStoryDecorator = (build: () => void, story: StoryElement) => void;

/**
 * A group of related web stories, optionally wrapped by module-level decorators.
 * The DOM binding of {@link StoryModuleLike} over {@link StoryElement} +
 * {@link WebStoryConstructor}.
 */
export interface WebStoryModule extends StoryModuleLike<StoryElement, WebStoryConstructor> {
    stories: WebStoryConstructor[];
    /** Populated by {@link StoryRegistry.createStoryInstances}. */
    instances?: StoryElement[];
    /** Decorators applied around every story's `initialize()` in this module. */
    decorators?: WebStoryDecorator[];
}

/** Narrowing guard — `true` when `value` is a {@link WebStoryModule}. */
export function isWebStoryModule(value: unknown): value is WebStoryModule {
    return typeof value === 'object' && value !== null && Array.isArray((value as { stories?: unknown }).stories);
}
