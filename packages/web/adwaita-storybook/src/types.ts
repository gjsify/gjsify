// Web story-module contract — mirrors @gjsify/storybook's StoryModule but over
// the DOM StoryElement base.

import type { StoryMeta } from '@gjsify/stories';
import type { StoryElement } from './story-element.js';

/** Constructor contract for a web story class: zero-arg `new`, static metadata. */
export interface WebStoryConstructor {
    new (): StoryElement;
    getMetadata(): StoryMeta;
}

/** Wraps a story's content-build step (e.g. to install a shared environment). */
export type WebStoryDecorator = (build: () => void, story: StoryElement) => void;

/** A group of related web stories, optionally wrapped by module-level decorators. */
export interface WebStoryModule {
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
