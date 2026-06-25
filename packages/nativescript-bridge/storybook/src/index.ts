// @gjsify/storybook-nativescript — NativeScript renderer for the @gjsify/stories
// contract. The NS counterpart of @gjsify/storybook (GTK) and
// @gjsify/adwaita-storybook (browser): author `*.ns.ts` files as StoryView
// subclasses and render them in a generic Adwaita component browser built from
// REAL @gjsify/adwaita-nativescript widgets, looking + behaving like the native
// GTK / browser storybooks so all three targets can be screenshot-compared 1:1.
//
// A thin NativeScript adapter over @gjsify/storybook-core — the
// renderer-agnostic logic (story base, registry, control binding, app
// controller, story discovery, devtools surface) lives in core; this package
// keeps only the @gjsify/adwaita-nativescript view layer.
//
// Pure named exports (no top-level side effects).

// Re-export the renderer-agnostic authoring contract so a story only needs one
// import (`@gjsify/storybook-nativescript`). The NS-specific NsStoryModule /
// NsStoryDecorator (which reference StoryView) intentionally shadow the generic
// ones from @gjsify/stories.
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

// Re-export the shared core pieces a host launcher needs (collectStoryModules
// for the `gjsify storybook` generated entry; the controller types the devtools
// wiring references).
export { collectStoryModules, type StorybookController } from '@gjsify/storybook-core';

export { StoryView, type StoryArgsListener } from './story-view.js';
export { StoryRegistry } from './registry.js';
export { createControlRow, type ControlRow } from './controls.js';
export {
    StorybookNativeApp,
    runStorybook,
    type StorybookNativeOptions,
    type StorySummary,
} from './app.js';
export { buildStorybookNsExtension, installStorybookDevtools } from './devtools.js';
export { isNsStoryModule, type NsStoryConstructor, type NsStoryDecorator, type NsStoryModule } from './types.js';
