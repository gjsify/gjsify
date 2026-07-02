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

import type { DevtoolsToolProfile, McpToolContext } from '../profile.js';

// `@gjsify/devtools-cdp` is an OPTIONAL PEER (Tier 3, experimental) loaded lazily
// in `loadDevtoolsCdp()`. It is kept OUT of the static import graph entirely — not
// even at the TYPE level — so `@gjsify/devtools-mcp` compiles WITHOUT the peer being
// present or pre-built (build-order-independent) and stays Tier 2 (ADR 0003). The
// narrow surface we use is mirrored locally below; the real package's shapes are the
// source of truth — keep these compatible.
type CdpJsType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'unknown';
interface CdpToolParam {
    name: string;
    jsType: CdpJsType;
    enum?: string[];
    description?: string;
    optional?: boolean;
}
interface CdpToolDescriptor {
    name: string;
    method: string;
    description?: string;
    parameters: CdpToolParam[];
}
interface DevtoolsCdpModule {
    PROTOCOL_SPEC: unknown;
    generateCdpTools(
        spec: unknown,
        options: { include: (domain: string, command: string) => boolean },
    ): CdpToolDescriptor[];
}

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

/**
 * Lazily load the OPTIONAL Tier-3 peer `@gjsify/devtools-cdp`. Throwing a clear,
 * actionable error when the peer is absent keeps `@gjsify/devtools-mcp` usable
 * (and buildable) without it — the generic / storybook / browser profiles never
 * touch this path, so they do not require the experimental package.
 */
async function loadDevtoolsCdp(): Promise<DevtoolsCdpModule> {
    try {
        // The specifier is widened to `string` so tsc does not statically resolve
        // the optional peer's (possibly-unbuilt or absent) declarations; the module
        // is loaded at runtime and typed via the local DevtoolsCdpModule mirror.
        const cdpModuleId: string = '@gjsify/devtools-cdp';
        return (await import(cdpModuleId)) as DevtoolsCdpModule;
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
            'The CDP devtools profile requires the optional peer dependency ' +
                '`@gjsify/devtools-cdp` (Tier 3, experimental). Add it to your app to use ' +
                `\`gjsify debug --profile cdp\` / \`cdpProfile\` / \`registerCdpTools\`. (import failed: ${detail})`,
        );
    }
}

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

/**
 * Register the transport-level CDP tools. These marshal through the app's
 * `org.gjsify.Devtools` DBus surface and need NO code from the optional peer, so
 * they register synchronously and stay available even when `@gjsify/devtools-cdp`
 * is not installed.
 */
function registerCoreCdpTools(ctx: McpToolContext): void {
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
}

/**
 * Register the curated, typed CDP tools generated from the embedded protocol
 * spec. This is the ONLY path that needs the optional `@gjsify/devtools-cdp`
 * peer, so it is loaded lazily here — awaiting `loadDevtoolsCdp()` throws a
 * clear error when the peer is absent.
 */
async function registerCuratedCdpTools(ctx: McpToolContext): Promise<void> {
    const { server, ok, dbusError } = ctx;
    const { PROTOCOL_SPEC, generateCdpTools } = await loadDevtoolsCdp();

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

/**
 * Register all CDP tools: the sync transport tools first (so they exist even if
 * the optional peer is missing), then the curated typed tools which lazily load
 * `@gjsify/devtools-cdp`. Async because the curated set needs the peer; callers
 * that fire-and-forget it (e.g. `runDevtoolsMcp`) must `.catch()` the rejection
 * so a missing peer surfaces cleanly instead of as an unhandled rejection.
 */
export async function registerCdpTools(ctx: McpToolContext): Promise<void> {
    registerCoreCdpTools(ctx);
    await registerCuratedCdpTools(ctx);
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
