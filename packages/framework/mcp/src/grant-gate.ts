// @gjsify/mcp — default-deny gate for tools whose write is granted per capability and target.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mcpError } from './tool-result.js';

/** One permission the app holds: a capability name the APP defines, bound to exactly one target. */
export interface Grant {
    capability: string;
    target: string;
}

/** How a tool declares the write it performs and where the call aims it. */
export interface CapabilitySpec<Args = Record<string, unknown>> {
    capability: string;
    /** Derive the target from the call's arguments. Empty, non-string or a throw refuses the call. */
    targetOf(args: Args): string;
}

// A WeakMap keyed by the config object keeps the declaration out of `_meta` (which the SDK sends to
// clients in `tools/list`, and which cannot carry a function) and out of the SDK's config type.
const declared = new WeakMap<object, CapabilitySpec>();

/** Declare the capability a tool needs. Returns `config` itself, so it composes inline. */
export function requiresCapability<C extends object, Args = Record<string, unknown>>(
    config: C,
    spec: CapabilitySpec<Args>,
): C {
    declared.set(config, spec as CapabilitySpec);
    return config;
}

/**
 * Gate tools by grant, DEFAULT-DENY — the successor to {@link applyReadOnlyGate} for apps whose
 * writes are permitted per capability.
 *
 * Registration: a tool registers if `annotations.readOnlyHint === true`, or if it declared a
 * capability (via {@link requiresCapability}) and at least one grant for that capability exists.
 * Anything else — no annotations, `readOnlyHint: false` without a capability, an ungranted
 * capability — is DROPPED, so a forgotten declaration shows up as a missing tool, never as a
 * reachable mutation.
 *
 * Call: THIS wrapper, not the tool, performs the check. A capability tool's handler is reached only
 * after `targetOf(args)` returned a non-empty target that equals a grant's target for that
 * capability, EXACTLY (no wildcards, no prefixes). Otherwise the call answers with an MCP error
 * naming the capability. Because the check lives in the registration path, a tool cannot be
 * registered with the check left out — and a forgotten check is the one failure that looks exactly
 * like a working gate.
 *
 * gjsify holds no capability names: they, and the grants, belong to the app. The grant set is
 * copied at call time of this function; later edits to the caller's array do not apply.
 *
 * Call this BEFORE registering anything — it wraps `registerTool`.
 */
export function applyGrantGate(server: McpServer, grants: readonly Grant[]): void {
    const held = new Map<string, Set<string>>();
    for (const g of grants) {
        if (typeof g.capability !== 'string' || g.capability === '') throw new Error('grant: empty capability');
        if (typeof g.target !== 'string' || g.target === '') {
            throw new Error(`grant for ${g.capability}: empty target`);
        }
        let targets = held.get(g.capability);
        if (!targets) held.set(g.capability, (targets = new Set()));
        targets.add(g.target);
    }

    const orig = server.registerTool.bind(server) as (...a: unknown[]) => unknown;
    server.registerTool = ((
        name: string,
        config: { annotations?: { readOnlyHint?: boolean }; inputSchema?: unknown } | undefined,
        handler: (...a: unknown[]) => unknown,
    ) => {
        const spec = config && typeof config === 'object' ? declared.get(config) : undefined;
        const readOnly = config?.annotations?.readOnlyHint === true;
        if (!spec) return readOnly ? orig(name, config, handler) : undefined;

        const targets = held.get(spec.capability);
        if (!readOnly && !targets) return undefined;

        const hasInput = config?.inputSchema !== undefined;
        const checked = async (...a: unknown[]) => {
            // Without an inputSchema the SDK calls handler(extra), so there are no arguments to read.
            const args = (hasInput ? a[0] : {}) as Record<string, unknown>;
            let target: unknown;
            try {
                target = spec.targetOf(args);
            } catch {
                target = undefined;
            }
            if (typeof target !== 'string' || target === '' || !targets?.has(target)) {
                return mcpError(`capability ${spec.capability} is not granted for this call`);
            }
            return handler(...a);
        };
        return orig(name, config, checked);
    }) as typeof server.registerTool;
}
