// StoryRegistryService — the GTK story registry, a thin subclass of the
// renderer-agnostic StoryRegistry from @gjsify/storybook-core specialised to
// StoryWidget. Keeps the public name + methods (registerStory/registerStories/
// getStories/createStoryInstances) stable; all logic lives in core.

import { StoryRegistry } from '@gjsify/storybook-core';
import type { StoryWidget } from './story-widget.js';

// Re-export the generic core registry for anything importing it by that name.
export { StoryRegistry } from '@gjsify/storybook-core';

/**
 * Manages story-module registration and instantiation for the GTK renderer.
 * One registry per {@link runStorybook} run (no shared singleton). All behaviour
 * — validation, defensive copies, decorator `reduceRight` composition — is the
 * core {@link StoryRegistry}.
 */
export class StoryRegistryService extends StoryRegistry<StoryWidget> {}
