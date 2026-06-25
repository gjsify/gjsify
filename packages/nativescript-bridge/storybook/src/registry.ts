// StoryRegistry — collects NativeScript story modules and instantiates their
// views.
//
// The registration/instantiation logic (validate, filter, decorator reduceRight
// fold over initialize()) is renderer-agnostic and now lives in
// @gjsify/storybook-core. This file just re-exports the generic class; callers
// type it as `StoryRegistry<StoryView>`.

export { StoryRegistry } from '@gjsify/storybook-core';
