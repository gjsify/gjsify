// Code-behind for the storybook page. Builds the full native Adwaita storybook
// (sidebar + preview + controls) from @gjsify/storybook-nativescript and mounts
// its root view, then installs the in-app devtools agent (with the storybook
// control surface) so an MCP agent can drive it over the V8 CDP inspector —
// list/open stories, set args, dump the native view tree, screenshot.

import { type NavigatedData, type Page, Application, ContentView, Frame } from '@nativescript/core';
import { installStorybookDevtools, runStorybook } from '@gjsify/storybook-nativescript';
import { stories } from '../src/stories';

const APP_ID = 'studio.artandcode.gjsify.adwaita.storybook';

export function onNavigatingTo(args: NavigatedData): void {
    const page = args.object as Page;

    // Build + mount the storybook (returns the app with its root view + controller).
    const app = runStorybook({ stories, title: 'Adwaita Storybook' });

    const host = page.getViewById<ContentView>('host');
    if (host) {
        host.content = app.root;
    } else {
        page.content = app.root;
    }

    // Wire the in-app devtools agent + the storybook control surface over the
    // shared controller. Forced on here (normally env-gated by GJSIFY_DEVTOOLS)
    // so an MCP agent can attach via `nativescript debug android` without
    // injecting env onto the device.
    installStorybookDevtools(app.controller, {
        enabled: true,
        application: Application,
        frame: Frame,
        appId: APP_ID,
    });

    console.log(`[adwaita-storybook] mounted ${app.listStories().length} stories`);
}
