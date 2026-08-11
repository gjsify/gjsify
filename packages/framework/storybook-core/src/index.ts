// @gjsify/storybook-core — renderer-agnostic storybook logic shared by the GTK
// (@gjsify/storybook), browser (@gjsify/adwaita-storybook) and NativeScript
// (@gjsify/storybook-nativescript) renderers.
//
// Pure named exports, zero platform imports. Each renderer composes these
// generic pieces (StoryViewBase, StoryRegistry, bindControl, StorybookController,
// collectStoryModules, buildStorybookDevtoolsExtension) with its own toolkit.

export * from './story-view-base.js';
export * from './registry.js';
export * from './controls.js';
export * from './controller.js';
export * from './discover.js';
export * from './devtools.js';
export * from './settings.js';

// Re-export the story-authoring contract so a consumer needs one import.
export * from '@gjsify/stories';
