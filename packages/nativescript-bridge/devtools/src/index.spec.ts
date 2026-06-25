// @gjsify/devtools-nativescript — unit tests.
//
// Run on GJS + Node where neither the NativeScript runtime nor a real View
// tree is present. Two things are checked off-device:
//   1. `installDevtools()` throws 'Platform not supported' via the
//      `assertNativeScript()` guard (mirrors @gjsify/native-fs-bridge).
//   2. The method registry + agent dispatch round-trip works against a MOCK
//      view tree — `DumpTree`/`GetStatus`/`GetProperty` produce the expected
//      JSON DevtoolsResponse without any NS API.

import { describe, expect, it } from '@gjsify/unit';

import { createAgent, installDevtools } from './install.js';
import { createNativescriptRegistry, type NsDevtoolsContext } from './handlers.js';
import type { DevtoolsResponse, DevtoolsResponseErr } from '@gjsify/devtools-protocol';
import type { NsView } from './view-tree.js';

/** A minimal mock NativeScript view that supports `eachChildView()`. */
function mockView(type: string, props: Partial<NsView> = {}, children: NsView[] = []): NsView {
    return {
        typeName: type,
        isLoaded: true,
        visibility: 'visible',
        ...props,
        eachChildView(callback: (child: NsView) => boolean): void {
            for (const child of children) {
                if (callback(child) === false) break;
            }
        },
    };
}

function mockContext(): NsDevtoolsContext {
    const root = mockView('Page', { id: 'main-page' }, [
        mockView('ActionBar', { text: 'Home' }),
        mockView('StackLayout', { cssClasses: new Set(['content']) }, [
            mockView('Label', { text: 'Hello', id: 'greeting' }),
            mockView('Button', { text: 'Tap me' }),
        ]),
    ]);
    return {
        instance: 'test',
        appId: 'org.example.NsApp',
        application: { getRootView: () => root },
        frame: null,
    };
}

export default async () => {
    await describe('@gjsify/devtools-nativescript install guard (off-device)', async () => {
        await it('installDevtools throws Platform not supported', async () => {
            expect(() => installDevtools()).toThrow('Platform not supported');
        });
    });

    await describe('@gjsify/devtools-nativescript registry round-trip (mock view tree)', async () => {
        const ctx = mockContext();
        const registry = createNativescriptRegistry(ctx);
        const agent = createAgent(registry, ctx);

        await it('DumpTree returns a NodeInfo tree as JSON', async () => {
            const json = await agent.dispatch(JSON.stringify({ method: 'DumpTree', params: { depth: 8 }, id: 1 }));
            const res = JSON.parse(json) as DevtoolsResponse;
            expect(res.ok).toBe(true);
            if (res.ok) {
                const tree = res.result as {
                    path: string;
                    type: string;
                    name: string | null;
                    children: Array<{ type: string; children: unknown[] }>;
                };
                expect(tree.path).toBe('toplevel:0');
                expect(tree.type).toBe('Page');
                expect(tree.name).toBe('main-page');
                expect(tree.children.length).toBe(2);
                // StackLayout (second child) has two children of its own.
                expect(tree.children[1].type).toBe('StackLayout');
                expect(tree.children[1].children.length).toBe(2);
            }
        });

        await it('GetStatus reports platform nativescript + instance', async () => {
            const json = await agent.dispatch(JSON.stringify({ method: 'GetStatus', id: 2 }));
            const res = JSON.parse(json) as DevtoolsResponse;
            expect(res.ok).toBe(true);
            if (res.ok) {
                const status = res.result as { platform: string; instance: string; devtools: boolean; appId: string };
                expect(status.platform).toBe('nativescript');
                expect(status.instance).toBe('test');
                expect(status.devtools).toBe(true);
                expect(status.appId).toBe('org.example.NsApp');
            }
        });

        await it('GetProperty reads a nested view property by path', async () => {
            // toplevel:0/child:1/child:0 = the Label inside the StackLayout.
            const json = await agent.dispatch(
                JSON.stringify({ method: 'GetProperty', params: { path: 'toplevel:0/child:1/child:0', prop: 'text' }, id: 3 }),
            );
            const res = JSON.parse(json) as DevtoolsResponse;
            expect(res.ok).toBe(true);
            if (res.ok) expect(res.result).toBe('Hello');
        });

        await it('unknown method yields a not-found error response', async () => {
            const json = await agent.dispatch(JSON.stringify({ method: 'Nope', id: 4 }));
            const res = JSON.parse(json) as DevtoolsResponse;
            expect(res.ok).toBe(false);
            expect((res as DevtoolsResponseErr).error.code).toBe('not-found');
        });

        await it('malformed JSON yields an invalid-params error response', async () => {
            const json = await agent.dispatch('{not json');
            const res = JSON.parse(json) as DevtoolsResponse;
            expect(res.ok).toBe(false);
            expect((res as DevtoolsResponseErr).error.code).toBe('invalid-params');
        });
    });
};
