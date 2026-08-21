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
                    'Capture a PNG screenshot via the GTK GSK pipeline. `scope` chooses WHAT is captured: the ' +
                    'active window by default, or a single widget inside it by path. Needs a visible window ' +
                    '(auto-raises + retries once when the capture comes back empty).',
                inputSchema: z.object({
                    scope: z
                        .string()
                        .optional()
                        .describe(
                            'What to capture: omitted, "window" or "active" for the active window, or a ' +
                                '`toplevel:N/child:M` path from dump_tree for one widget. An explicit path ' +
                                'matching no live widget is an error, not a silent whole-window shot.',
                        ),
                    ...instanceArg,
                }),
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
                    'Activate a GAction by scope + name, with an optional parameter (a plain JSON value coerced ' +
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
            { description: 'Raise + focus the app’s active window.', inputSchema: z.object({ ...instanceArg }) },
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

    if (want('list_toplevels')) {
        server.registerTool(
            'list_toplevels',
            {
                description: 'List the app’s live toplevel windows (path, type, title, mapped, focused).',
                inputSchema: z.object({ ...instanceArg }),
            },
            async ({ instance }) => {
                try {
                    return ok(await client.jsonCall(instance, 'ListToplevels'));
                } catch (error) {
                    return dbusError(error, instance);
                }
            },
        );
    }

    if (want('dump_tree')) {
        server.registerTool(
            'dump_tree',
            {
                description:
                    'Dump the widget tree as JSON from `root` (a widget path like "toplevel:0/child:2", or omit ' +
                    'for the active window), bounded by `depth`.',
                inputSchema: z.object({ root: z.string().optional(), depth: z.number().optional(), ...instanceArg }),
            },
            async ({ root, depth, instance }) => {
                try {
                    const params = GLib.Variant.new_tuple([strv(root ?? ''), GLib.Variant.new_int32(depth ?? 8)]);
                    return ok(await client.jsonCall(instance, 'DumpTree', params));
                } catch (error) {
                    return dbusError(error, instance);
                }
            },
        );
    }

    if (want('get_property')) {
        server.registerTool(
            'get_property',
            {
                description: 'Read a widget’s GObject property by widget path + property name (JSON-safe value).',
                inputSchema: z.object({ path: z.string(), prop: z.string(), ...instanceArg }),
            },
            async ({ path, prop, instance }) => {
                try {
                    const params = GLib.Variant.new_tuple([strv(path), strv(prop)]);
                    return ok(await client.jsonCall(instance, 'GetProperty', params));
                } catch (error) {
                    return dbusError(error, instance);
                }
            },
        );
    }

    if (want('get_focused')) {
        server.registerTool(
            'get_focused',
            {
                description: 'The currently-focused widget (path, name, type), or null.',
                inputSchema: z.object({ ...instanceArg }),
            },
            async ({ instance }) => {
                try {
                    return ok(await client.jsonCall(instance, 'GetFocused'));
                } catch (error) {
                    return dbusError(error, instance);
                }
            },
        );
    }

    if (want('find_widget')) {
        server.registerTool(
            'find_widget',
            {
                description:
                    'Find the first widget matching a selector and return its widget path, searched ' +
                    'depth-first from the active window. Selector is a GType name, a `:css-class`, or ' +
                    'both (`GtkButton:suggested-action`). Invisible and unmapped subtrees are skipped, so ' +
                    'a hit is something a user can actually reach. Saves dumping the whole tree to hunt ' +
                    'for a path — and unlike a path written down earlier, a selector survives a widget ' +
                    'being inserted above the target. Returns an empty result when nothing matches.',
                inputSchema: z.object({ selector: z.string(), ...instanceArg }),
            },
            async ({ selector, instance }) => {
                try {
                    const reply = await client.control(
                        instance,
                        'FindWidget',
                        GLib.Variant.new_tuple([strv(selector)]),
                        '(s)',
                    );
                    const [path] = reply.recursiveUnpack() as [string];
                    return ok(path ? path : `No visible widget matches "${selector}".`);
                } catch (error) {
                    return dbusError(error, instance);
                }
            },
        );
    }

    if (want('activate_widget')) {
        server.registerTool(
            'activate_widget',
            {
                description:
                    'Activate the widget at a widget path (from dump_tree) — the click-drive counterpart of ' +
                    'get_property: a Button emits clicked, an Entry activates, a Toggle toggles; a list/nav/' +
                    'preference row (GtkListBoxRow/AdwActionRow) is clicked on its GtkListBox (selected + ' +
                    'row-activated). Returns whether the widget activated.',
                inputSchema: z.object({ path: z.string(), ...instanceArg }),
            },
            async ({ path, instance }) => {
                try {
                    const reply = await client.control(
                        instance,
                        'ActivateWidget',
                        GLib.Variant.new_tuple([strv(path)]),
                        '(b)',
                    );
                    const [activated] = reply.recursiveUnpack() as [boolean];
                    return ok(
                        activated
                            ? `Activated widget at "${path}".`
                            : `Widget at "${path}" is not activatable (no default activation).`,
                    );
                } catch (error) {
                    return dbusError(error, instance);
                }
            },
        );
    }

    if (want('dump_gsettings')) {
        server.registerTool(
            'dump_gsettings',
            {
                description: 'Dump every key + value of an installed GSettings schema (read-only).',
                inputSchema: z.object({ schema: z.string(), ...instanceArg }),
            },
            async ({ schema, instance }) => {
                try {
                    return ok(await client.jsonCall(instance, 'DumpGSettings', GLib.Variant.new_tuple([strv(schema)])));
                } catch (error) {
                    return dbusError(error, instance);
                }
            },
        );
    }

    if (want('dump_css')) {
        server.registerTool(
            'dump_css',
            {
                description: 'List the devtools-installed CSS provider names.',
                inputSchema: z.object({ ...instanceArg }),
            },
            async ({ instance }) => {
                try {
                    return ok(await client.jsonCall(instance, 'DumpCss'));
                } catch (error) {
                    return dbusError(error, instance);
                }
            },
        );
    }

    if (want('swap_css')) {
        server.registerTool(
            'swap_css',
            {
                description:
                    'Live-install or replace a named CSS provider (high priority) — re-theme the running app ' +
                    'without a restart. Returns applied.',
                inputSchema: z.object({ name: z.string(), css: z.string(), ...instanceArg }),
            },
            async ({ name, css, instance }) => {
                try {
                    const reply = await client.control(
                        instance,
                        'SwapCss',
                        GLib.Variant.new_tuple([strv(name), strv(css)]),
                        '(b)',
                    );
                    const [applied] = reply.recursiveUnpack() as [boolean];
                    return ok(applied ? `Applied CSS provider "${name}".` : 'No display — CSS not applied.');
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
                description:
                    'List reachable devtools-enabled app instances — every default/labelled bus name on the ' +
                    'session bus, or (on the bus-less peer transport) the single app this bridge is dialling.',
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
