// inspectorProtocolExtension — exposes the WebKit Remote Inspector Protocol over
// the app's `org.gjsify.Devtools` control plane as a second DevtoolsExtension
// (alongside e.g. @gjsify/devtools-browser's browserDevtoolsExtension).
//
// The WebSocket(s) live IN the app process (one InspectorProtocolClient per
// connected target, cached) — NOT in the MCP bridge — so the bridge never runs a
// second GLib main loop; it just calls these DBus methods. Four methods:
//   CdpDiscoverTargets() -> s    list targets (HTML-parse of GET /)
//   CdpConnect(target_json) -> b connect (defaults to the first web-page target)
//   CdpSend(method, params_json) -> s   the universal escape hatch to any command
//   CdpDrainEvents() -> s        poll + clear buffered protocol events
// CdpSend is `mutating` (arbitrary commands edit page state); the rest are
// read-only. The MCP `cdpProfile` (a later phase) is a thin marshaller over these.

import type { DevtoolsExtension } from '@gjsify/devtools';

import { InspectorProtocolClient, type WebSocketFactory } from './inspector-protocol-client.js';
import { discoverInspectorTargets, type InspectorTarget } from './target-discovery.js';

export interface InspectorProtocolExtensionOptions {
    /** Port the WebKit inspector HTTP server is bound to (`WEBKIT_INSPECTOR_HTTP_SERVER`). */
    port: number;
    /** Host the inspector server is bound to. Default `127.0.0.1`. */
    host?: string;
    /** Domains auto-enabled on connect. Default: Inspector, Runtime, DOM, Console. */
    autoEnableDomains?: readonly string[];
    /** WebSocket factory (default: global). Inject a mock for tests. */
    createWebSocket?: WebSocketFactory;
    /** fetch implementation (default: global). Inject for tests. */
    fetchImpl?: typeof fetch;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_DOMAINS = ['Inspector', 'Runtime', 'DOM', 'Console'] as const;

/**
 * Build the {@link DevtoolsExtension} that adds the `Cdp*` methods. Connections
 * are lazy + cached per target ws URL; `CdpConnect` selects the "current" target
 * that `CdpSend` / `CdpDrainEvents` operate on.
 */
export function inspectorProtocolExtension(options: InspectorProtocolExtensionOptions): DevtoolsExtension {
    const { port } = options;
    const host = options.host ?? DEFAULT_HOST;
    const domains = options.autoEnableDomains ?? DEFAULT_DOMAINS;
    const clients = new Map<string, InspectorProtocolClient>();
    let currentWsUrl: string | null = null;

    const discover = (): Promise<InspectorTarget[]> =>
        discoverInspectorTargets(port, { host, fetchImpl: options.fetchImpl });

    async function resolveTarget(targetJson: string): Promise<InspectorTarget | undefined> {
        const arg = targetJson && targetJson.trim() ? (JSON.parse(targetJson) as Partial<InspectorTarget>) : null;
        // An explicit target carrying a wsUrl is used as-is (no discovery needed).
        if (arg && typeof arg.wsUrl === 'string') return arg as InspectorTarget;
        const targets = await discover();
        if (arg && typeof arg.targetId === 'string') {
            const match = targets.find((t) => t.targetId === arg.targetId);
            if (match) return match;
        }
        return targets.find((t) => t.targetType === 'web-page') ?? targets[0];
    }

    async function connect(targetJson: string): Promise<boolean> {
        const target = await resolveTarget(targetJson);
        if (!target) return false;
        let client = clients.get(target.wsUrl);
        if (!client) {
            client = new InspectorProtocolClient(target.wsUrl, { createWebSocket: options.createWebSocket });
            clients.set(target.wsUrl, client);
        }
        if (!client.connected) {
            await client.connect();
            await client.enableDomains(domains);
        }
        currentWsUrl = target.wsUrl;
        return true;
    }

    const currentClient = (): InspectorProtocolClient | null =>
        currentWsUrl ? (clients.get(currentWsUrl) ?? null) : null;

    return {
        methodsXml: [
            '<method name="CdpDiscoverTargets"><arg type="s" direction="out" name="targets_json"/></method>',
            '<method name="CdpConnect"><arg type="s" direction="in" name="target_json"/><arg type="b" direction="out" name="ok"/></method>',
            '<method name="CdpSend"><arg type="s" direction="in" name="method"/><arg type="s" direction="in" name="params_json"/><arg type="s" direction="out" name="result_json"/></method>',
            '<method name="CdpDrainEvents"><arg type="s" direction="out" name="events_json"/></method>',
        ],
        handlers: {
            CdpDiscoverTargets: async (): Promise<string> => JSON.stringify(await discover(), null, 2),
            CdpConnect: async (targetJson: string): Promise<boolean> => connect(targetJson),
            CdpSend: async (method: string, paramsJson: string): Promise<string> => {
                const client = currentClient();
                if (!client) throw new Error('CdpSend: not connected — call CdpConnect first');
                const params =
                    paramsJson && paramsJson.trim() ? (JSON.parse(paramsJson) as Record<string, unknown>) : undefined;
                const result = await client.send(method, params);
                return JSON.stringify(result ?? null, null, 2);
            },
            CdpDrainEvents: (): string => {
                const client = currentClient();
                return JSON.stringify(client ? client.drainEvents() : [], null, 2);
            },
        },
        methodKinds: {
            CdpDiscoverTargets: 'read-only',
            CdpConnect: 'read-only',
            CdpSend: 'mutating',
            CdpDrainEvents: 'read-only',
        },
        contributeStatus: () => {
            const client = currentClient();
            return {
                inspector: {
                    port,
                    host,
                    connected: client?.connected ?? false,
                    targetCount: clients.size,
                },
            };
        },
    };
}
