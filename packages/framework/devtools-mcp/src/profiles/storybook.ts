// @gjsify/devtools-mcp — built-in profile for @gjsify/storybook.
// Registers story-specific MCP tools that drive the storybook devtools
// extension (ListStories/OpenStory/SetStoryArg/... over org.gjsify.Devtools),
// on top of the generic tools. Original implementation.

import GLib from '@girs/glib-2.0';
import { z } from 'zod';
import type { DevtoolsProfileOptions, DevtoolsToolProfile, McpToolContext } from '../profile.js';

const strv = (value: string) => GLib.Variant.new_string(value);

const instanceArg = { instance: z.string().optional().describe('Storybook instance label; omit for the default app') };

/** Register the storybook-specific tools (list/open stories, read/set args). */
export function registerStorybookTools(ctx: McpToolContext): void {
    const { server, client, ok, dbusError } = ctx;

    server.registerTool(
        'list_stories',
        {
            description: 'List every registered story: title, story variant, category, and controls.',
            inputSchema: z.object({ ...instanceArg }),
        },
        async ({ instance }) => {
            try {
                return ok(await client.jsonCall(instance, 'ListStories'));
            } catch (error) {
                return dbusError(error, instance);
            }
        },
    );

    server.registerTool(
        'get_current_story',
        {
            description: 'The currently-displayed story (title, variant, live args), or null.',
            inputSchema: z.object({ ...instanceArg }),
        },
        async ({ instance }) => {
            try {
                return ok(await client.jsonCall(instance, 'GetCurrentStory'));
            } catch (error) {
                return dbusError(error, instance);
            }
        },
    );

    server.registerTool(
        'open_story',
        {
            description: 'Open a story by its full "Category/Name" title (updates the sidebar selection).',
            inputSchema: z.object({ title: z.string(), ...instanceArg }),
        },
        async ({ title, instance }) => {
            try {
                const reply = await client.control(instance, 'OpenStory', GLib.Variant.new_tuple([strv(title)]), '(b)');
                const [opened] = reply.recursiveUnpack() as [boolean];
                return ok(opened ? `Opened "${title}".` : `No story titled "${title}".`);
            } catch (error) {
                return dbusError(error, instance);
            }
        },
    );

    server.registerTool(
        'set_story_arg',
        {
            description:
                'Set one arg on the active story (drives the same path as the control panel; the row refreshes).',
            inputSchema: z.object({
                name: z.string(),
                value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
                ...instanceArg,
            }),
        },
        async ({ name, value, instance }) => {
            try {
                const reply = await client.control(
                    instance,
                    'SetStoryArg',
                    GLib.Variant.new_tuple([strv(name), strv(JSON.stringify(value))]),
                    '(b)',
                );
                const [applied] = reply.recursiveUnpack() as [boolean];
                return ok(applied ? `Set ${name} = ${JSON.stringify(value)}.` : 'No active story to set an arg on.');
            } catch (error) {
                return dbusError(error, instance);
            }
        },
    );
}

/** A ready-made profile for a storybook app: generic tools + the story tools. */
export function storybookProfile(busNameBase: string, options: DevtoolsProfileOptions = {}): DevtoolsToolProfile {
    return {
        name: 'gjsify-storybook-devtools',
        version: '0.8.0',
        busNameBase,
        address: options.address,
        registerTools: registerStorybookTools,
    };
}
