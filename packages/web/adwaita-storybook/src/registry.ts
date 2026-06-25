// StoryRegistry — collects web story modules and instantiates their elements.
//
// The registration/instantiation logic (validate, filter, decorator reduceRight
// fold over initialize()) is renderer-agnostic and now lives in
// @gjsify/storybook-core. This file just re-exports the generic class; callers
// type it as `StoryRegistry<StoryElement>`.

export { StoryRegistry } from '@gjsify/storybook-core';
