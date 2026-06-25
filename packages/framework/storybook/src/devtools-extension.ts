// @gjsify/storybook — devtools extension exposing the story surface over org.gjsify.Devtools.
//
// The five methods (ListStories/GetCurrentStory/OpenStory/SetStoryArg/
// GetStoryArgs) + their handlers + contributeStatus are built renderer-neutrally
// by @gjsify/storybook-core's buildStorybookDevtoolsExtension(controller); this
// adapter wraps that into the GTK `DevtoolsExtension` shape (methodsXml +
// handlers + methodKinds) the org.gjsify.Devtools bridge consumes. The DBus
// method names + JSON shapes are unchanged.

import type { DevtoolsExtension } from '@gjsify/devtools';
import { buildStorybookDevtoolsExtension } from '@gjsify/storybook-core';
import type { StorybookWindow } from './window.js';

/** The pause classification for each storybook method (core `read-only`/`mutating` ⊆ MethodKind). */
type StorybookMethodKind = 'read-only' | 'mutating';

/** The static `<method>` XML — the DBus signatures the bridge merges in. */
const METHODS_XML: Record<string, string> = {
    ListStories: '<method name="ListStories"><arg type="s" direction="out" name="stories_json"/></method>',
    GetCurrentStory: '<method name="GetCurrentStory"><arg type="s" direction="out" name="story_json"/></method>',
    OpenStory:
        '<method name="OpenStory"><arg type="s" direction="in" name="title"/><arg type="b" direction="out" name="opened"/></method>',
    SetStoryArg:
        '<method name="SetStoryArg"><arg type="s" direction="in" name="name"/><arg type="s" direction="in" name="value_json"/><arg type="b" direction="out" name="applied"/></method>',
    GetStoryArgs: '<method name="GetStoryArgs"><arg type="s" direction="out" name="args_json"/></method>',
};

/**
 * Build a {@link DevtoolsExtension} that exposes the storybook's story surface
 * — list/open stories, read/set the active story's args — so an agent (via the
 * MCP bridge) can drive and debug widgets in isolation. Wired by
 * {@link StorybookApplication} when `GJSIFY_DEVTOOLS` is set.
 *
 * Delegates the method set to the window's {@link StorybookController}.
 */
export function storybookDevtoolsExtension(window: StorybookWindow): DevtoolsExtension {
    const ext = buildStorybookDevtoolsExtension(window.controller);

    const methodsXml: string[] = [];
    const handlers: Record<string, (...args: never[]) => unknown> = {};
    const methodKinds: Record<string, StorybookMethodKind> = {};

    for (const method of ext.methods) {
        const xml = METHODS_XML[method.name];
        if (xml) methodsXml.push(xml);
        handlers[method.name] = method.handler;
        methodKinds[method.name] = method.kind;
    }

    return {
        methodsXml,
        handlers,
        methodKinds,
        contributeStatus: ext.contributeStatus,
    };
}
