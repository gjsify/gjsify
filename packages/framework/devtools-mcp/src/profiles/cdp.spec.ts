// @gjsify/devtools-mcp — cdpProfile — original implementation.
// GJS-only (builds real GLib.Variant replies). Mocks the McpServer + DbusClient
// to assert the cdp tools register + marshal through CdpSend correctly.

import GLib from '@girs/glib-2.0';
import { describe, expect, it, on } from '@gjsify/unit';

import { cdpProfile, registerCdpTools } from './cdp.js';
import type { McpToolContext } from '../profile.js';

interface CapturedTool {
    name: string;
    handler: (args: Record<string, unknown>) => Promise<unknown>;
}

interface CapturedCall {
    method: string;
    args: unknown[];
}

function makeContext() {
    const tools: CapturedTool[] = [];
    const calls: CapturedCall[] = [];
    const server = {
        registerTool(name: string, _def: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) {
            tools.push({ name, handler });
        },
    };
    const client = {
        async control(_instance: string | undefined, method: string, params: GLib.Variant | null) {
            const unpacked = params ? (params.recursiveUnpack() as unknown[]) : [];
            calls.push({ method, args: unpacked });
            // CdpSend → '(s)' result_json; CdpConnect → '(b)' ok.
            if (method === 'CdpConnect') return GLib.Variant.new_tuple([GLib.Variant.new_boolean(true)]);
            return GLib.Variant.new_tuple([GLib.Variant.new_string('{"echo":true}')]);
        },
        async jsonCall(_instance: string | undefined, method: string) {
            calls.push({ method, args: [] });
            return `["${method}"]`;
        },
    };
    const ctx = {
        server,
        client,
        ok: (text: string) => ({ kind: 'ok', text }),
        fail: (text: string) => ({ kind: 'fail', text }),
        dbusError: (error: unknown) => ({ kind: 'error', error }),
    } as unknown as McpToolContext;
    return { ctx, tools, calls };
}

export default async () => {
    await on('Gjs', async () => {
        await describe('cdpProfile', async () => {
            await it('has the expected profile shape', async () => {
                const profile = cdpProfile('org.example.Browser');
                expect(profile.busNameBase).toBe('org.example.Browser');
                expect(typeof profile.registerTools).toBe('function');
            });
        });

        await describe('registerCdpTools', async () => {
            await it('registers the four core tools', async () => {
                const { ctx, tools } = makeContext();
                await registerCdpTools(ctx);
                const names = tools.map((t) => t.name);
                for (const core of ['cdp_send', 'cdp_discover_targets', 'cdp_connect', 'cdp_drain_events']) {
                    expect(names.includes(core)).toBeTruthy();
                }
            });

            await it('registers curated typed tools from the generated descriptors', async () => {
                const { ctx, tools } = makeContext();
                await registerCdpTools(ctx);
                const names = tools.map((t) => t.name);
                expect(names.includes('cdp_runtime_evaluate')).toBeTruthy();
                expect(names.includes('cdp_dom_get_document')).toBeTruthy();
                expect(names.includes('cdp_css_get_computed_style_for_node')).toBeTruthy();
                // 4 core + 13 curated.
                expect(tools.length).toBe(17);
            });

            await it('cdp_send marshals method + params through CdpSend', async () => {
                const { ctx, tools, calls } = makeContext();
                await registerCdpTools(ctx);
                const send = tools.find((t) => t.name === 'cdp_send')!;
                await send.handler({ method: 'Page.reload', params: { ignoreCache: true } });
                const call = calls.find((c) => c.method === 'CdpSend')!;
                expect(call.args[0]).toBe('Page.reload');
                expect(JSON.parse(call.args[1] as string)).toStrictEqual({ ignoreCache: true });
            });

            await it('a curated tool marshals its typed args through CdpSend', async () => {
                const { ctx, tools, calls } = makeContext();
                await registerCdpTools(ctx);
                const evaluate = tools.find((t) => t.name === 'cdp_runtime_evaluate')!;
                await evaluate.handler({ expression: '1 + 1', returnByValue: true, instance: undefined });
                const call = calls.find((c) => c.method === 'CdpSend')!;
                expect(call.args[0]).toBe('Runtime.evaluate');
                const params = JSON.parse(call.args[1] as string);
                expect(params.expression).toBe('1 + 1');
                expect(params.returnByValue).toBe(true);
                // `instance` must NOT leak into the protocol params.
                expect('instance' in params).toBeFalsy();
            });

            await it('cdp_connect calls CdpConnect', async () => {
                const { ctx, tools, calls } = makeContext();
                await registerCdpTools(ctx);
                const connect = tools.find((t) => t.name === 'cdp_connect')!;
                await connect.handler({});
                expect(calls.some((c) => c.method === 'CdpConnect')).toBeTruthy();
            });
        });
    });
};
