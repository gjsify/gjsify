// @gjsify/storybook — GTK/Adwaita renderer for the @gjsify/stories contract.
// A reusable storybook: author *.story.ts files as StoryWidget subclasses and
// run them in a generic Adwaita component browser, either by calling
// runStorybook() or via the `gjsify storybook` CLI command.

// Re-export the renderer-agnostic authoring contract so a story only needs one
// import (`@gjsify/storybook`). The GTK-specific StoryModule / StoryDecorator
// (which reference StoryWidget) are defined locally and intentionally shadow
// the generic ones from @gjsify/stories.
export {
    ControlType,
    argsFromControls,
    isStoryModule,
    type StoryArgs,
    type StoryArgValue,
    type StoryBooleanControl,
    type StoryColorControl,
    type StoryControl,
    type StoryMeta,
    type StoryNumberControl,
    type StorySelectControl,
    type StorySelectOption,
    type StoryTextControl,
} from '@gjsify/stories';

export { StoryWidget } from './story-widget.js';
export type { StoryDecorator, StoryModule, StoryWidgetConstructor } from './story-widget.js';
export { StoryRegistryService } from './registry.js';
export { installActionGroup, withActionGroup, type StoryAction } from './decorators.js';
export { StorybookWindow } from './window.js';
export { StorybookApplication, type StorybookOptions } from './application.js';
export { runStorybook } from './run.js';
export { collectStoryModules } from './discover.js';
export type { StoryRow } from './types.js';
