// Browser renderer for the `@gjsify/stories` contract, the web counterpart of
// `@gjsify/storybook`: `*.web.ts` files author `StoryElement` subclasses, rendered in
// an Adwaita component browser built from `@gjsify/adwaita-web`.
//
// A thin DOM adapter over `@gjsify/storybook-core`, which owns the renderer-agnostic
// logic (story base, registry, control binding, app controller) — this package is only
// the view layer. Nothing compares the two renderers by screenshot (#1052); what holds
// their behaviour together is the `@gjsify/adwaita-core/conformance` vector tables both
// renderer suites assert their real widgets against.

// The authoring contract is re-exported so a story needs one import only. The
// web-specific WebStoryModule / WebStoryDecorator intentionally shadow the generic
// ones from `@gjsify/stories`, because they reference `StoryElement`.
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
