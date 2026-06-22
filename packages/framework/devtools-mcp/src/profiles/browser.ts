// browserProfile — MCP tools for the @gjsify/devtools-browser web-debugging
// surface. Mirrors profiles/storybook.ts: each tool calls a Browser* method on
// the app's org.gjsify.Devtools control plane via the DbusDevtoolsClient. The
// generic tools (screenshot of the GTK window, resize_window, present_window, …)
// are registered too (genericTools defaults to 'all').

import GLib from '@girs/glib-2.0';
import { z } from 'zod';

import type { DevtoolsToolProfile, McpToolContext } from '../profile.js';
import { image } from '../tool-result.js';

const strv = (value: string): GLib.Variant => GLib.Variant.new_string(value);
const intv = (value: number): GLib.Variant => GLib.Variant.new_int32(value);
const instanceArg = {
    instance: z.string().optional().describe('Browser instance label; omit for the default app'),
};

export function registerBrowserTools(ctx: McpToolContext): void {
    const { server, client, ok, dbusError } = ctx;

    server.registerTool(
        'navigate',
        {
            description:
                'Navigate to a URL (a `page:*` built-in page or `https://…`). Updates the history stack + URL bar.',
            inputSchema: z.object({ url: z.string(), ...instanceArg }),
        },
        async ({ url, instance }) => {
            try {
                await client.control(instance, 'BrowserNavigate', GLib.Variant.new_tuple([strv(url)]), null);
                return ok(`Navigated to ${url}`);
            } catch (error) {
                return dbusError(error, instance);
            }
        },
    );

    for (const [tool, method, desc] of [
        ['back', 'BrowserBack', 'Go back one entry in browser history.'],
        ['forward', 'BrowserForward', 'Go forward one entry in browser history.'],
        ['reload', 'BrowserReload', 'Reload the current page.'],
    ] as const) {
        server.registerTool(
            tool,
            { description: desc, inputSchema: z.object({ ...instanceArg }) },
            async ({ instance }) => {
                try {
                    await client.control(instance, method, null, null);
                    return ok(desc);
                } catch (error) {
                    return dbusError(error, instance);
                }
            },
        );
    }

    server.registerTool(
        'get_page_info',
        {
            description: 'Current page state: uri, appUrl, title, canGoBack, canGoForward, lastLoadError.',
            inputSchema: z.object({ ...instanceArg }),
        },
        async ({ instance }) => {
            try {
                return ok(await client.jsonCall(instance, 'BrowserGetPageInfo'));
            } catch (error) {
                return dbusError(error, instance);
            }
        },
    );

    server.registerTool(
        'page_screenshot',
        {
            description:
                'PNG of the rendered WEB CONTENT via the WebKit compositor (use this, not the generic `screenshot`, ' +
                'for the page — WebKit composites out-of-process so the GSK shot is blank). region=full (whole ' +
                'scrollable document) | visible (viewport).',
            inputSchema: z.object({ region: z.enum(['full', 'visible']).optional().default('full'), ...instanceArg }),
        },
        async ({ region, instance }) => {
            try {
                const reply = await client.control(
                    instance,
                    'BrowserScreenshot',
                    GLib.Variant.new_tuple([strv(region)]),
                    '(ay)',
                );
                const data = reply.get_child_value(0).deepUnpack() as Uint8Array | null;
                if (!data || data.length === 0) {
                    return ctx.fail('page_screenshot returned no data — is a page loaded and the window realized?');
                }
                return image(GLib.base64_encode(data));
            } catch (error) {
                return dbusError(error, instance);
            }
        },
    );

    server.registerTool(
        'set_viewport',
        {
            description:
                'Set the WebView content-region size in pixels (responsive testing); returns the applied size.',
            inputSchema: z.object({ width: z.number().int(), height: z.number().int(), ...instanceArg }),
        },
        async ({ width, height, instance }) => {
            try {
                const reply = await client.control(
                    instance,
                    'BrowserSetViewport',
                    GLib.Variant.new_tuple([intv(width), intv(height)]),
                    '(ii)',
                );
                const [w, h] = reply.recursiveUnpack() as [number, number];
                return ok(`Viewport set to ${w}x${h}`);
            } catch (error) {
                return dbusError(error, instance);
            }
        },
    );

    server.registerTool(
        'eval_js',
        {
            description:
                'Evaluate a JavaScript EXPRESSION in the page and return its value (JSON round-trip). Wrap ' +
                'multi-statement code in an IIFE, e.g. `(() => { const a = 1; return a + 1; })()`. Page errors ' +
                'surface as an error.',
            inputSchema: z.object({ script: z.string(), ...instanceArg }),
        },
        async ({ script, instance }) => {
            try {
                const reply = await client.control(
                    instance,
                    'BrowserEvalJs',
                    GLib.Variant.new_tuple([strv(script)]),
                    '(s)',
                );
                const [json] = reply.recursiveUnpack() as [string];
                return ok(json);
            } catch (error) {
                return dbusError(error, instance);
            }
        },
    );

    server.registerTool(
        'get_links',
        {
            description: 'Every `<a href>` on the page as {href, text, title}.',
            inputSchema: z.object({ ...instanceArg }),
        },
        async ({ instance }) => {
            try {
                return ok(await client.jsonCall(instance, 'BrowserGetLinks'));
            } catch (error) {
                return dbusError(error, instance);
            }
        },
    );

    server.registerTool(
        'follow_link',
        {
            description:
                'Click the first element matching a CSS selector (or an `<a>` by exact visible text), then wait for ' +
                'the resulting navigation. Returns {clicked, navigated, uri}.',
            inputSchema: z.object({ selectorOrText: z.string(), ...instanceArg }),
        },
        async ({ selectorOrText, instance }) => {
            try {
                const reply = await client.control(
                    instance,
                    'BrowserFollowLink',
                    GLib.Variant.new_tuple([strv(selectorOrText)]),
                    '(s)',
                );
                const [json] = reply.recursiveUnpack() as [string];
                return ok(json);
            } catch (error) {
                return dbusError(error, instance);
            }
        },
    );

    server.registerTool(
        'query_dom',
        {
            description:
                'Metadata for elements matching a CSS selector ({tagName, id, className, text, href?, visible}).',
            inputSchema: z.object({ selector: z.string(), ...instanceArg }),
        },
        async ({ selector, instance }) => {
            try {
                const reply = await client.control(
                    instance,
                    'BrowserQueryDom',
                    GLib.Variant.new_tuple([strv(selector)]),
                    '(s)',
                );
                const [json] = reply.recursiveUnpack() as [string];
                return ok(json);
            } catch (error) {
                return dbusError(error, instance);
            }
        },
    );

    server.registerTool(
        'wait_for_load',
        {
            description:
                'Wait for the next page load to finish (ms; default 30000). Returns whether it loaded in time.',
            inputSchema: z.object({ timeout: z.number().int().optional().default(30000), ...instanceArg }),
        },
        async ({ timeout, instance }) => {
            try {
                const reply = await client.control(
                    instance,
                    'BrowserWaitForLoad',
                    GLib.Variant.new_tuple([intv(timeout)]),
                    '(b)',
                );
                const [loaded] = reply.recursiveUnpack() as [boolean];
                return ok(loaded ? 'Page loaded.' : 'Timed out waiting for the next load.');
            } catch (error) {
                return dbusError(error, instance);
            }
        },
    );

    server.registerTool(
        'get_console',
        {
            description: 'Buffered console.* output captured from the page ({level, args}).',
            inputSchema: z.object({ ...instanceArg }),
        },
        async ({ instance }) => {
            try {
                return ok(await client.jsonCall(instance, 'BrowserGetConsole'));
            } catch (error) {
                return dbusError(error, instance);
            }
        },
    );

    // -- Inspector data (Tier B): the Web Inspector panels via in-page eval. --

    server.registerTool(
        'inspect_element',
        {
            description:
                'Inspect the first element matching a CSS selector — tag/id/class + attributes + bounding rect + ' +
                'box model (margin/border/padding/content) + a curated set of computed styles. The Elements + ' +
                'Computed + Box Model panels in one call.',
            inputSchema: z.object({ selector: z.string(), ...instanceArg }),
        },
        async ({ selector, instance }) => {
            try {
                const reply = await client.control(
                    instance,
                    'BrowserInspectElement',
                    GLib.Variant.new_tuple([strv(selector)]),
                    '(s)',
                );
                const [json] = reply.recursiveUnpack() as [string];
                return ok(json);
            } catch (error) {
                return dbusError(error, instance);
            }
        },
    );

    server.registerTool(
        'dom_tree',
        {
            description:
                'The DOM/Elements tree from a selector (default: document root) down to max_depth, capped per node.',
            inputSchema: z.object({
                selector: z.string().optional().default(''),
                maxDepth: z.number().int().optional().default(3),
                ...instanceArg,
            }),
        },
        async ({ selector, maxDepth, instance }) => {
            try {
                const reply = await client.control(
                    instance,
                    'BrowserDomTree',
                    GLib.Variant.new_tuple([strv(selector), intv(maxDepth)]),
                    '(s)',
                );
                const [json] = reply.recursiveUnpack() as [string];
                return ok(json);
            } catch (error) {
                return dbusError(error, instance);
            }
        },
    );

    server.registerTool(
        'get_network',
        {
            description: 'Page network activity via the Resource Timing API — the navigation entry + each resource.',
            inputSchema: z.object({ ...instanceArg }),
        },
        async ({ instance }) => {
            try {
                return ok(await client.jsonCall(instance, 'BrowserGetNetwork'));
            } catch (error) {
                return dbusError(error, instance);
            }
        },
    );

    server.registerTool(
        'get_accessibility',
        {
            description:
                'Approximate accessibility tree from a selector (default: body) — role + accessible name + aria-* ' +
                'per node, down to max_depth.',
            inputSchema: z.object({
                selector: z.string().optional().default(''),
                maxDepth: z.number().int().optional().default(4),
                ...instanceArg,
            }),
        },
        async ({ selector, maxDepth, instance }) => {
            try {
                const reply = await client.control(
                    instance,
                    'BrowserGetAccessibility',
                    GLib.Variant.new_tuple([strv(selector), intv(maxDepth)]),
                    '(s)',
                );
                const [json] = reply.recursiveUnpack() as [string];
                return ok(json);
            } catch (error) {
                return dbusError(error, instance);
            }
        },
    );

    for (const [tool, method, desc] of [
        ['open_inspector', 'BrowserOpenInspector', 'Open the WebKit Web Inspector panel on the browser window.'],
        ['close_inspector', 'BrowserCloseInspector', 'Close the WebKit Web Inspector panel.'],
    ] as const) {
        server.registerTool(
            tool,
            { description: desc, inputSchema: z.object({ ...instanceArg }) },
            async ({ instance }) => {
                try {
                    await client.control(instance, method, null, null);
                    return ok(desc);
                } catch (error) {
                    return dbusError(error, instance);
                }
            },
        );
    }
}

/** Tool profile for a @gjsify/devtools-browser app. */
export function browserProfile(busNameBase: string): DevtoolsToolProfile {
    return {
        name: 'gjsify-browser-devtools',
        version: '0.10.0',
        busNameBase,
        registerTools: registerBrowserTools,
    };
}
