// Storybook devtools wiring — expose the running NS storybook's control surface
// (ListStories / GetCurrentStory / OpenStory / SetStoryArg / GetStoryArgs) to an
// MCP/CDP agent via `@gjsify/devtools-nativescript`'s in-app agent. The NS
// counterpart of @gjsify/storybook's `storybookDevtoolsExtension` (DBus) and the
// browser app's `window.__storybook` bridge.
//
// The renderer-neutral method set lives in @gjsify/storybook-core's
// `buildStorybookDevtoolsExtension(controller)`. This file adapts its
// positional-args handlers to the NS devtools `params`-record shape (the NS
// transport sends `{ method, params }`) and installs them through the
// `extensions` hook on `installDevtools`.

import { buildStorybookDevtoolsExtension, type StorybookController } from '@gjsify/storybook-core';
import {
    installDevtools,
    type InstallNsDevtoolsOptions,
    type NsDevtoolsAgent,
    type NsDevtoolsExtension,
    type NsDevtoolsMethod,
} from '@gjsify/devtools-nativescript';
import type { StoryView } from './story-view.js';

/** Per-method param-name list — maps the NS `params` record to positional args. */
const METHOD_ARG_NAMES: Record<string, string[]> = {
    ListStories: [],
    GetCurrentStory: [],
    OpenStory: ['title'],
    SetStoryArg: ['name', 'valueJson'],
    GetStoryArgs: [],
};

/**
 * Build the NS devtools extension over a storybook controller — the
 * renderer-neutral storybook method set from `@gjsify/storybook-core`, adapted to
 * the NS devtools `params`-record handler shape.
 */
export function buildStorybookNsExtension(controller: StorybookController<StoryView>): NsDevtoolsExtension {
    const core = buildStorybookDevtoolsExtension(controller);
    const methods: NsDevtoolsMethod[] = core.methods.map((method) => {
        const argNames = METHOD_ARG_NAMES[method.name] ?? [];
        const positional = method.handler as (...args: unknown[]) => unknown;
        return {
            name: method.name,
            kind: method.kind,
            handler: (params) => positional(...argNames.map((name) => params[name])),
        };
    });
    return { methods, contributeStatus: core.contributeStatus };
}

/**
 * Install the in-app NativeScript devtools agent with the storybook control
 * surface wired in. A no-op returning `null` unless `GJSIFY_DEVTOOLS` is set (or
 * `options.enabled`), so it is safe to leave in production. Call once after
 * `runStorybook(...)`.
 *
 * @example
 * ```ts
 * import { Application, Frame } from '@nativescript/core';
 * import { runStorybook, installStorybookDevtools } from '@gjsify/storybook-nativescript';
 * const app = runStorybook({ stories });
 * installStorybookDevtools(app.controller, { application: Application, frame: Frame });
 * ```
 */
export function installStorybookDevtools(
    controller: StorybookController<StoryView>,
    options: Omit<InstallNsDevtoolsOptions, 'extensions'> = {},
): NsDevtoolsAgent | null {
    return installDevtools({ ...options, extensions: [buildStorybookNsExtension(controller)] });
}
