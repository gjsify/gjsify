// cdpProfile — MCP tools for the WebKit Remote Inspector Protocol exposed by a
// @gjsify/devtools-cdp-enabled app (e.g. `gjsify browse --inspector-port`).
//
// Mirrors profiles/browser.ts: each tool marshals through the app's
// org.gjsify.Devtools `Cdp*` methods via the DbusDevtoolsClient. v1 ships:
//   - cdp_send — the universal escape hatch to ANY Domain.command
//   - cdp_discover_targets / cdp_connect / cdp_drain_events
//   - ~14 CURATED, typed tools (zod schemas generated from the embedded protocol
//     spec by @gjsify/devtools-cdp's tool-generator) — each a thin CdpSend wrapper.
// The full ~248-command surface stays reachable through cdp_send; only the
// curated set gets first-class typed tools, to keep the tool list legible.

import GLib from '@girs/glib-2.0';
import { z } from 'zod';

import { PROTOCOL_SPEC, type CdpJsType, generateCdpTools } from '@gjsify/devtools-cdp';

import type { DevtoolsToolProfile, McpToolContext } from '../profile.js';

const strv = (value: string): GLib.Variant => GLib.Variant.new_string(value);
const instanceArg = {
    instance: z.string().optional().describe('App instance label; omit for the default app'),
};

/** Curated v1 commands that get first-class typed tools (everything else: cdp_send). */
const CURATED = new Set<string>([
    'Runtime.evaluate',
    'Runtime.callFunctionOn',
    'Runtime.getProperties',
    'Runtime.getPreview',
    'DOM.getDocument',
    'DOM.querySelector',
    'DOM.querySelectorAll',
    'DOM.getOuterHTML',
    'DOM.setAttributeValue',
    'CSS.getComputedStyleForNode',
    'CSS.getMatchedStylesForNode',
    'Debugger.setBreakpoint',
    'Debugger.setPauseOnExceptions',
]);

/** Build a zod type for a generated parameter. */
function zodForParam(jsType: CdpJsType, enumValues: string[] | undefined): z.ZodTypeAny {
    if (enumValues && enumValues.length > 0) return z.enum(enumValues as [string, ...string[]]);
    switch (jsType) {
        case 'string':
            return z.string();
        case 'number':
            return z.number();
        case 'boolean':
            return z.boolean();
        case 'array':
            return z.array(z.unknown());
        case 'object':
            return z.record(z.string(), z.unknown());
        default:
            return z.unknown();
    }
}

/** Send a `Domain.command` with params through the app's CdpSend method. */
async function cdpSend(
    ctx: McpToolContext,
    instance: string | undefined,
    method: string,
    params: Record<string, unknown>,
): Promise<string> {
    const reply = await ctx.client.control(
        instance,
        'CdpSend',
        GLib.Variant.new_tuple([strv(method), strv(JSON.stringify(params))]),
        '(s)',
    );
    const [json] = reply.recursiveUnpack() as [string];
    return json;
}

export function registerCdpTools(ctx: McpToolContext): void {
    const { server, client, ok, dbusError } = ctx;

    // --- escape hatch ---
    server.registerTool(
        'cdp_send',
        {
            description:
                'Send any WebKit Remote Inspector command `Domain.command` (e.g. "Page.reload", "Network.enable") ' +
                'with optional params, and return its result JSON. The universal fallback for commands without a ' +
                'curated tool. Requires a prior cdp_connect.',
            inputSchema: z.object({
                method: z.string().describe('Protocol method, e.g. "Runtime.evaluate".'),
                params: z.record(z.string(), z.unknown()).optional(),
                ...instanceArg,
            }),
        },
        async ({ method, params, instance }) => {
            try {
                return ok(await cdpSend(ctx, instance, method, params ?? {}));
            } catch (error) {
                return dbusError(error, instance);
            }
        },
    );

    // --- discovery / connection / events ---
    server.registerTool(
        'cdp_discover_targets',
        {
            description: 'List the inspectable targets (web-page / service-worker / …) on the inspector server.',
            inputSchema: z.object({ ...instanceArg }),
        },
        async ({ instance }) => {
            try {
                return ok(await client.jsonCall(instance, 'CdpDiscoverTargets'));
            } catch (error) {
                return dbusError(error, instance);
            }
        },
    );

    server.registerTool(
        'cdp_connect',
        {
            description:
                'Connect to an inspector target (defaults to the first web-page) and auto-enable the Inspector / ' +
                'Runtime / DOM / Console domains. Call before cdp_send / the curated tools.',
            inputSchema: z.object({
                target: z
                    .record(z.string(), z.unknown())
                    .optional()
                    .describe('Optional target selector, e.g. {targetId} or {wsUrl}; omit for the first web-page.'),
                ...instanceArg,
            }),
        },
        async ({ target, instance }) => {
            try {
                const reply = await client.control(
                    instance,
                    'CdpConnect',
                    GLib.Variant.new_tuple([strv(target ? JSON.stringify(target) : '')]),
                    '(b)',
                );
                const [okFlag] = reply.recursiveUnpack() as [boolean];
                return okFlag ? ok('Connected to inspector target.') : ctx.fail('No inspectable target found.');
            } catch (error) {
                return dbusError(error, instance);
            }
        },
    );

    server.registerTool(
        'cdp_drain_events',
        {
            description: 'Return + clear the buffered protocol events (console messages, DOM mutations, …).',
            inputSchema: z.object({ ...instanceArg }),
        },
        async ({ instance }) => {
            try {
                return ok(await client.jsonCall(instance, 'CdpDrainEvents'));
            } catch (error) {
                return dbusError(error, instance);
            }
        },
    );

    // --- curated typed tools (generated from the embedded protocol spec) ---
    const curated = generateCdpTools(PROTOCOL_SPEC, { include: (d, c) => CURATED.has(`${d}.${c}`) });
    for (const tool of curated) {
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const param of tool.parameters) {
            const base = zodForParam(param.jsType, param.enum);
            const described = param.description ? base.describe(param.description) : base;
            shape[param.name] = param.optional ? described.optional() : described;
        }
        server.registerTool(
            tool.name,
            {
                description: tool.description ?? tool.method,
                inputSchema: z.object({ ...shape, ...instanceArg }),
            },
            async (args: Record<string, unknown>) => {
                const instance = args.instance as string | undefined;
                try {
                    const params: Record<string, unknown> = {};
                    for (const param of tool.parameters) {
                        if (args[param.name] !== undefined) params[param.name] = args[param.name];
                    }
                    return ok(await cdpSend(ctx, instance, tool.method, params));
                } catch (error) {
                    return dbusError(error, instance);
                }
            },
        );
    }
}

/** Tool profile for a @gjsify/devtools-cdp-enabled app. */
export function cdpProfile(busNameBase: string): DevtoolsToolProfile {
    return {
        name: 'gjsify-cdp-devtools',
        version: '0.11.0',
        busNameBase,
        registerTools: registerCdpTools,
    };
}
