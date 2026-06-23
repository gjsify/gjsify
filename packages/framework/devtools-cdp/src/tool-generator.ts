// tool-generator.ts — turn the embedded protocol spec into MCP-tool descriptors.
//
// Pure + data-driven: `generateCdpTools(spec)` walks every domain's commands and
// emits a {@link CdpToolDescriptor} per command — a stable tool name
// (`cdp_<domain>_<command>`), the wire method (`Domain.command`), and a flattened
// parameter list with simplified JS types ($ref resolved one level to its base
// type). The MCP `cdpProfile` (a later phase, in @gjsify/devtools-mcp where zod
// lives) turns these descriptors into registered tools; this module deliberately
// has no zod / MCP dependency so it stays unit-testable headless.

import {
    type ProtocolParameter,
    type ProtocolSpec,
    type ProtocolType,
    buildTypeIndex,
    resolveRef,
} from './protocol-spec.js';

/** Simplified JS type used to build an input schema. */
export type CdpJsType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'unknown';

/** A flattened command parameter ready for schema generation. */
export interface CdpToolParam {
    name: string;
    jsType: CdpJsType;
    optional: boolean;
    description?: string;
    enum?: string[];
}

/** One generated tool descriptor (1:1 with a protocol command). */
export interface CdpToolDescriptor {
    /** MCP tool name, e.g. `cdp_dom_query_selector`. */
    name: string;
    /** Wire method, e.g. `DOM.querySelector` — pass to CdpSend. */
    method: string;
    domain: string;
    command: string;
    description?: string;
    parameters: CdpToolParam[];
}

export interface GenerateCdpToolsOptions {
    /** Tool-name prefix. Default `cdp`. */
    prefix?: string;
    /** Filter which `(domain, command)` pairs become tools. Default: all. */
    include?: (domain: string, command: string) => boolean;
}

/** `getOuterHTML` → `get_outer_html`, `DOM` → `dom`. */
export function snakeCase(value: string): string {
    return value
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .toLowerCase();
}

/** MCP tool name for a `(domain, command)`, e.g. `cdp_dom_query_selector`. */
export function cdpToolName(domain: string, command: string, prefix = 'cdp'): string {
    return `${prefix}_${snakeCase(domain)}_${snakeCase(command)}`;
}

const PRIMITIVE: Record<string, CdpJsType> = {
    string: 'string',
    integer: 'number',
    number: 'number',
    boolean: 'boolean',
    object: 'object',
    array: 'array',
};

function jsTypeFor(param: ProtocolParameter, domain: string, index: Map<string, ProtocolType>): CdpJsType {
    if (param.type) return PRIMITIVE[param.type] ?? 'unknown';
    if (param.$ref) {
        const target = resolveRef(param.$ref, domain, index);
        if (target) return PRIMITIVE[target.type] ?? 'unknown';
        return 'object'; // unresolved ref → treat as a structured object
    }
    return 'unknown';
}

/** Generate one {@link CdpToolDescriptor} per command across the spec. */
export function generateCdpTools(spec: ProtocolSpec, options: GenerateCdpToolsOptions = {}): CdpToolDescriptor[] {
    const prefix = options.prefix ?? 'cdp';
    const include = options.include;
    const index = buildTypeIndex(spec);
    const tools: CdpToolDescriptor[] = [];
    for (const domain of spec) {
        for (const command of domain.commands ?? []) {
            if (include && !include(domain.domain, command.name)) continue;
            const parameters: CdpToolParam[] = (command.parameters ?? []).map((p) => ({
                name: p.name,
                jsType: jsTypeFor(p, domain.domain, index),
                optional: Boolean(p.optional),
                description: p.description,
                enum: p.enum,
            }));
            tools.push({
                name: cdpToolName(domain.domain, command.name, prefix),
                method: `${domain.domain}.${command.name}`,
                domain: domain.domain,
                command: command.name,
                description: command.description,
                parameters,
            });
        }
    }
    return tools;
}
