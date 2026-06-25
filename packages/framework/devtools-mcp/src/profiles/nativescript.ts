// @gjsify/devtools-mcp — built-in profile for @gjsify/devtools-nativescript.
//
// Mirrors profiles/browser.ts, but the transport is the V8 CDP inspector
// (NsCdpClient) rather than the session-bus DBus client: each tool ships a
// DevtoolsRequest over `Runtime.evaluate` to the in-app agent
// (`globalThis.__adwDevtools`) and renders the JSON DevtoolsResponse. The
// request/response envelope, method names and error codes are the SAME
// `@gjsify/devtools-protocol` contract the GTK adapter speaks, so an MCP agent
// gets `dump_tree` / `screenshot` / `get_status` / `get_property` on a running
// NativeScript app exactly as it does on a GTK app.
//
// Optional `device_screenshot` host fallback shells out to `adb exec-out
// screencap -p` — works even when the in-app agent is not installed.
//
// Runs on GJS. Original implementation.

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type DevtoolsRequest, type DevtoolsResponse } from '@gjsify/devtools-protocol';
import { z } from 'zod';
import { fail, image, ok, type ToolResult } from '../tool-result.js';
import { GjsStdioTransport } from '../stdio-transport.js';
import { NsCdpClient, type NsCdpConnectOptions } from '../transports/ns-cdp-client.js';
import type { ScreenshotResult } from './nativescript-types.js';

/** Profile descriptor for a NativeScript devtools target. */
export interface NativescriptToolProfile {
    /** MCP server name. */
    readonly name: string;
    /** MCP server version. */
    readonly version: string;
    /** CDP connection (explicit ws url, or inspector host:port to discover). */
    readonly connect?: NsCdpConnectOptions;
    /** Register app-specific tools on top of the generic ones. */
    readonly registerTools?: (ctx: NsMcpToolContext) => void;
}

/** Context handed to NS tool registrations. */
export interface NsMcpToolContext {
    readonly server: McpServer;
    readonly client: NsCdpClient;
    readonly ok: (text: string) => ToolResult;
    readonly fail: (text: string) => ToolResult;
}

/** Send a request to the in-app agent + return its result, or throw the typed error. */
async function call(client: NsCdpClient, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const req: DevtoolsRequest = { method, params };
    const res: DevtoolsResponse = await client.request(req);
    if (!res.ok) throw new Error(`${res.error.code}: ${res.error.message}`);
    return res.result;
}

/** Pretty-print a JSON-able result for an `ok` tool reply. */
function okJson(result: unknown): ToolResult {
    return ok(JSON.stringify(result, null, 2));
}

/**
 * Register the generic NS tools (the toolkit-neutral subset of the GTK generic
 * tools that maps onto a NativeScript view tree): get_status, list_toplevels,
 * dump_tree, get_property, screenshot.
 */
export function registerNsGenericTools(ctx: NsMcpToolContext): void {
    const { server, client } = ctx;

    server.registerTool(
        'get_status',
        {
            description:
                'JSON snapshot of the running NativeScript app: app id, platform, instance, root view, pause state.',
            inputSchema: z.object({}),
        },
        async () => {
            try {
                return okJson(await call(client, 'GetStatus'));
            } catch (error) {
                return ctx.fail(messageOf(error));
            }
        },
    );

    server.registerTool(
        'list_toplevels',
        {
            description: "List the app's toplevel(s) — NativeScript has a single root view (`toplevel:0`).",
            inputSchema: z.object({}),
        },
        async () => {
            try {
                return okJson(await call(client, 'ListToplevels'));
            } catch (error) {
                return ctx.fail(messageOf(error));
            }
        },
    );

    server.registerTool(
        'dump_tree',
        {
            description:
                'Dump the native view tree as JSON from `root` (a view path like "toplevel:0/child:2", or omit for ' +
                'the root view), bounded by `depth`. Each node: path, type (NativeScript component), name, cssClasses, ' +
                'visible, optional text.',
            inputSchema: z.object({ root: z.string().optional(), depth: z.number().optional() }),
        },
        async ({ root, depth }) => {
            try {
                return okJson(await call(client, 'DumpTree', { root: root ?? '', depth: depth ?? 8 }));
            } catch (error) {
                return ctx.fail(messageOf(error));
            }
        },
    );

    server.registerTool(
        'get_property',
        {
            description: "Read a view's property by view path + property name (JSON-safe value).",
            inputSchema: z.object({ path: z.string(), prop: z.string() }),
        },
        async ({ path, prop }) => {
            try {
                return okJson(await call(client, 'GetProperty', { path, prop }));
            } catch (error) {
                return ctx.fail(messageOf(error));
            }
        },
    );

    server.registerTool(
        'screenshot',
        {
            description:
                'Capture a PNG screenshot of the root native view, rendered in-process by the app (no adb, no ' +
                'screen-record permission). Needs the app foregrounded + laid out.',
            inputSchema: z.object({}),
        },
        async () => {
            try {
                const shot = (await call(client, 'Screenshot')) as ScreenshotResult;
                if (!shot || !shot.data) {
                    return ctx.fail(
                        'Screenshot returned no data — the root view is not laid out yet (bring the app to the ' +
                            'foreground and retry), or device_screenshot as a fallback.',
                    );
                }
                return image(shot.data);
            } catch (error) {
                return ctx.fail(messageOf(error));
            }
        },
    );

    // Host-side fallback that does not need the in-app agent at all.
    registerDeviceScreenshot(ctx);
}

/**
 * `device_screenshot` — capture the whole device screen via
 * `adb exec-out screencap -p`. Works regardless of the in-app agent (handy when
 * the app has no devtools build, or to see system chrome around the app). GJS
 * shells out via Gio.Subprocess.
 */
function registerDeviceScreenshot(ctx: NsMcpToolContext): void {
    ctx.server.registerTool(
        'device_screenshot',
        {
            description:
                'PNG of the WHOLE Android device/emulator screen via `adb exec-out screencap -p` (host-side; works ' +
                'without the in-app devtools agent). Pass `serial` to target a specific device.',
            inputSchema: z.object({ serial: z.string().optional() }),
        },
        async ({ serial }) => {
            try {
                const base64 = await adbScreencap(serial);
                if (!base64) return ctx.fail('adb screencap returned no data — is a device connected (`adb devices`)?');
                return image(base64);
            } catch (error) {
                return ctx.fail(`adb screencap failed: ${messageOf(error)}`);
            }
        },
    );
}

/** Run `adb [-s serial] exec-out screencap -p` and base64-encode the PNG bytes. */
function adbScreencap(serial?: string): Promise<string | null> {
    const argv = ['adb', ...(serial ? ['-s', serial] : []), 'exec-out', 'screencap', '-p'];
    const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
    return new Promise((resolve, reject) => {
        proc.communicate_async(null, null, (_p, res) => {
            try {
                const [, stdout] = proc.communicate_finish(res);
                const bytes = stdout?.get_data();
                if (!bytes || bytes.length === 0) return resolve(null);
                resolve(GLib.base64_encode(bytes));
            } catch (error) {
                reject(error);
            }
        });
    });
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** A ready-made profile for a NativeScript app: generic NS tools (+ optional extras). */
export function nativescriptProfile(connect?: NsCdpConnectOptions): NativescriptToolProfile {
    return {
        name: 'gjsify-nativescript-devtools',
        version: '0.11.0',
        connect,
    };
}

/**
 * Run an MCP↔NativeScript-devtools bridge: build the server, register the
 * generic (+ app-specific) tools, connect the CDP transport to the device, and
 * pump the GLib main loop until the client closes stdin. Parallel to
 * `runDevtoolsMcp` (the DBus path) but over the V8 inspector transport. Logs
 * only to stderr so the JSON-RPC stdout stream stays clean.
 */
export async function runNativescriptMcp(profile: NativescriptToolProfile): Promise<void> {
    const client = new NsCdpClient(profile.connect);
    const server = new McpServer({ name: profile.name, version: profile.version });
    const ctx: NsMcpToolContext = { server, client, ok, fail };

    registerNsGenericTools(ctx);
    profile.registerTools?.(ctx);

    const loop = GLib.MainLoop.new(null, false);
    const transport = new GjsStdioTransport(() => loop.quit());

    // Connect the CDP socket first (fire-and-forget, like the DBus path), then
    // run the GLib loop synchronously so the stdio read loop + Soup async ops
    // are pumped. A connect failure is non-fatal: the tools surface the error
    // per-call, so the agent can retry once the device/inspector is up.
    client.connect().then(
        () => console.error(`[gjsify-devtools-mcp] ${profile.name} connected to the NativeScript inspector`),
        (error: unknown) =>
            console.error(`[gjsify-devtools-mcp] NS inspector not reachable yet (tools will retry): ${messageOf(error)}`),
    );

    server.connect(transport).then(
        () => console.error(`[gjsify-devtools-mcp] ${profile.name} on stdio (NativeScript CDP)`),
        (error: unknown) => {
            console.error('[gjsify-devtools-mcp] failed to connect:', error);
            loop.quit();
        },
    );
    loop.run();
}
