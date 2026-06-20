// @gjsify/devtools-mcp — the generic, app-agnostic MCP tools.
// Original implementation; tool bodies adapted from the map-editor bridge.

import GLib from '@girs/glib-2.0';
import { z } from 'zod';
import type { GenericToolName, McpToolContext } from './profile.js';
import { image } from './tool-result.js';

const strv = (value: string) => GLib.Variant.new_string(value);

const instanceArg = { instance: z.string().optional().describe('App instance label; omit for the default app') };

/** Resolve after `ms`, letting the (single-threaded) GLib main loop run meanwhile. */
function delay(ms: number): Promise<void> {
    return new Promise((res) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            res();
            return GLib.SOURCE_REMOVE;
        });
    });
}

/** Register the requested generic tools (default: all) against the bridge context. */
export function registerGenericTools(ctx: McpToolContext, which: GenericToolName[] | 'all' = 'all'): void {
    const { server, client, ok, fail, dbusError } = ctx;
    const want = (name: GenericToolName): boolean => which === 'all' || which.includes(name);

    if (want('get_status')) {
        server.registerTool(
            'get_status',
            {
                description:
                    'JSON snapshot of the running app: app id, active window, toplevel count, focused widget, ' +
                    'pause state, plus any app-specific status contributed by extensions.',
                inputSchema: z.object({ ...instanceArg }),
            },
            async ({ instance }) => {
                try {
                    return ok(await client.jsonCall(instance, 'GetStatus'));
                } catch (error) {
                    return dbusError(error, instance);
                }
            },
        );
    }

    if (want('screenshot')) {
        server.registerTool(
            'screenshot',
            {
                description:
                    'Capture a PNG screenshot of the active window via the GTK GSK pipeline. Needs a visible ' +
                    'window (auto-raises + retries once when the capture comes back empty).',
                inputSchema: z.object({ scope: z.string().optional(), ...instanceArg }),
            },
            async ({ scope, instance }) => {
                try {
                    const grab = async (): Promise<Uint8Array | null> => {
                        const reply = await client.control(
                            instance,
                            'Screenshot',
                            GLib.Variant.new_tuple([strv(scope ?? 'window')]),
                            '(ay)',
                        );
                        return reply.get_child_value(0).deepUnpack() as Uint8Array | null;
                    };
                    let data = await grab();
                    if (!data || data.length === 0) {
                        await client.control(instance, 'PresentWindow', null, null);
                        await delay(350);
                        data = await grab();
                    }
                    if (!data || data.length === 0) {
                        return fail(
                            'Screenshot returned no data — the window is likely occluded or minimized. ' +
                                'Bring it to the foreground (present_window) and retry.',
                        );
                    }
                    return image(GLib.base64_encode(data));
                } catch (error) {
                    return dbusError(error, instance);
                }
            },
        );
    }

    if (want('list_actions')) {
        server.registerTool(
            'list_actions',
            {
                description:
                    'List the app.* and win.* GActions (name, enabled, parameter/state types) that ' +
                    'activate_action / change_action_state can drive.',
                inputSchema: z.object({ ...instanceArg }),
            },
            async ({ instance }) => {
                try {
                    return ok(await client.jsonCall(instance, 'ListActions'));
                } catch (error) {
                    return dbusError(error, instance);
                }
            },
        );
    }

    if (want('activate_action')) {
        server.registerTool(
            'activate_action',
            {
                description:
                    "Activate a GAction by scope + name, with an optional parameter (a plain JSON value coerced " +
                    "to the action's declared type).",
                inputSchema: z.object({
                    scope: z.enum(['app', 'win']),
                    name: z.string(),
                    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
                    ...instanceArg,
                }),
            },
            async ({ scope, name, value, instance }) => {
                try {
                    const json = value === undefined ? '' : JSON.stringify(value);
                    await client.control(
                        instance,
                        'ActivateAction',
                        GLib.Variant.new_tuple([strv(scope), strv(name), strv(json)]),
                        null,
                    );
                    return ok(`Activated ${scope}.${name}`);
                } catch (error) {
                    return dbusError(error, instance);
                }
            },
        );
    }

    if (want('change_action_state')) {
        server.registerTool(
            'change_action_state',
            {
                description: 'Set a stateful GAction’s state — for idempotent toggles like win.toggle-grid.',
                inputSchema: z.object({
                    scope: z.enum(['app', 'win']),
                    name: z.string(),
                    value: z.union([z.string(), z.number(), z.boolean()]),
                    ...instanceArg,
                }),
            },
            async ({ scope, name, value, instance }) => {
                try {
                    await client.control(
                        instance,
                        'ChangeActionState',
                        GLib.Variant.new_tuple([strv(scope), strv(name), strv(JSON.stringify(value))]),
                        null,
                    );
                    return ok(`Set state ${scope}.${name} = ${JSON.stringify(value)}`);
                } catch (error) {
                    return dbusError(error, instance);
                }
            },
        );
    }

    if (want('present_window')) {
        server.registerTool(
            'present_window',
            { description: "Raise + focus the app’s active window.", inputSchema: z.object({ ...instanceArg }) },
            async ({ instance }) => {
                try {
                    await client.control(instance, 'PresentWindow', null, null);
                    return ok('Presented the window.');
                } catch (error) {
                    return dbusError(error, instance);
                }
            },
        );
    }

    if (want('resize_window')) {
        server.registerTool(
            'resize_window',
            {
                description:
                    'Resize the active window to an absolute pixel size (exercises responsive breakpoints). ' +
                    'Returns the requested size.',
                inputSchema: z.object({ width: z.number(), height: z.number(), ...instanceArg }),
            },
            async ({ width, height, instance }) => {
                try {
                    const reply = await client.control(
                        instance,
                        'ResizeWindow',
                        GLib.Variant.new_tuple([GLib.Variant.new_int32(width), GLib.Variant.new_int32(height)]),
                        '(ii)',
                    );
                    const [w, h] = reply.recursiveUnpack() as [number, number];
                    return ok(`Resized to ${w}×${h}.`);
                } catch (error) {
                    return dbusError(error, instance);
                }
            },
        );
    }

    if (want('list_instances')) {
        server.registerTool(
            'list_instances',
            {
                description: 'List devtools-enabled app instances on the session bus (default + labelled).',
                inputSchema: z.object({}),
            },
            async () => {
                try {
                    return ok(JSON.stringify(await client.listInstances(), null, 2));
                } catch (error) {
                    return dbusError(error);
                }
            },
        );
    }
}
