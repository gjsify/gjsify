// protocol-spec.ts — the shape of the (embedded) WebKit Remote Inspector
// Protocol, and helpers over it.
//
// The actual data lives in the generated `spec-data.ts` (a pruned snapshot of
// the 27 domain JSONs from refs/webkit, produced by `scripts/generate-spec-data.mjs`)
// so the published package carries no refs/webkit dependency at runtime. These
// types model that snapshot + the tool-generator's input.

/** A command/type parameter or a type's property. */
export interface ProtocolParameter {
    name: string;
    /** Primitive type when not a `$ref`: `string` | `integer` | `number` | `boolean` | `object` | `array`. */
    type?: string;
    /** Reference to a type, `Domain.TypeName` (cross-domain) or `TypeName` (same domain). */
    $ref?: string;
    optional?: boolean;
    description?: string;
    /** Element shape for `type: "array"`. */
    items?: { type?: string; $ref?: string };
    /** Allowed values for an enum-typed parameter. */
    enum?: string[];
}

/** A protocol command (`Domain.command`). */
export interface ProtocolCommand {
    name: string;
    description?: string;
    parameters?: ProtocolParameter[];
    returns?: ProtocolParameter[];
    async?: boolean;
}

/** A named protocol type (`Domain.TypeName`). */
export interface ProtocolType {
    id: string;
    type: string;
    description?: string;
    enum?: string[];
    properties?: ProtocolParameter[];
}

/** A protocol domain (one source JSON). */
export interface ProtocolDomain {
    domain: string;
    description?: string;
    types?: ProtocolType[];
    commands?: ProtocolCommand[];
}

export type ProtocolSpec = readonly ProtocolDomain[];

export { PROTOCOL_SPEC, PROTOCOL_SOURCE } from './spec-data.js';

/**
 * Index every type by its fully-qualified `Domain.TypeName` key (and also by the
 * bare `TypeName` for same-domain lookups, last-writer-wins on collisions —
 * resolve cross-domain refs with the qualified key when ambiguous).
 */
export function buildTypeIndex(spec: ProtocolSpec): Map<string, ProtocolType> {
    const index = new Map<string, ProtocolType>();
    for (const domain of spec) {
        for (const type of domain.types ?? []) {
            index.set(`${domain.domain}.${type.id}`, type);
            if (!index.has(type.id)) index.set(type.id, type);
        }
    }
    return index;
}

/**
 * Resolve a `$ref` to its target {@link ProtocolType}. `Domain.Type` is looked up
 * directly; a bare `Type` is resolved within `fromDomain` first, then globally.
 */
export function resolveRef(
    ref: string,
    fromDomain: string,
    index: Map<string, ProtocolType>,
): ProtocolType | undefined {
    if (ref.includes('.')) return index.get(ref);
    return index.get(`${fromDomain}.${ref}`) ?? index.get(ref);
}
