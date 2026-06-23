// @gjsify/storybook-web — browser renderer for the @gjsify/stories contract.
// The web counterpart of @gjsify/storybook: author *.web.ts files as
// StoryElement subclasses and render them in a generic Adwaita component browser
// built from @gjsify/adwaita-web, looking and behaving like the native GTK
// storybook so the two targets can be screenshot-compared 1:1.

// Re-export the renderer-agnostic authoring contract so a story only needs one
// import (`@gjsify/storybook-web`). The web-specific WebStoryModule /
// WebStoryDecorator (which reference StoryElement) intentionally shadow the
// generic ones from @gjsify/stories.
export {
    ControlType,
    argsFromControls,
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

export { StoryElement, type StoryArgsListener } from './story-element.js';
export { StoryRegistry } from './registry.js';
export { createControlRow, type ControlRow } from './controls.js';
export { StorybookWebApp, mountStorybook, type StorybookWebOptions, type StorySummary } from './app.js';
export { STORYBOOK_WEB_CSS, injectStorybookStyles } from './styles.js';
export { isWebStoryModule, type WebStoryConstructor, type WebStoryDecorator, type WebStoryModule } from './types.js';
