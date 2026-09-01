// @gjsify/devtools — build GLib.Variant action parameters from plain JS values.
// Adapted from the PixelRPG map-editor (apps/maker-gjs/src/services/gvariant.ts).
// Copyright (c) PixelRPG. MIT.

import GLib from 'gi://GLib?version=2.0';

/** The `GLib.Variant` scalar kinds the action plane marshals to. */
export type VariantKind = 's' | 'b' | 'i' | 'u' | 'd';

/**
 * Decide which `GLib.Variant` scalar kind to build for an action
 * parameter/state: the action's declared variant type string when it's a
 * known scalar, otherwise inferred from the JS runtime type (string → `s`,
 * boolean → `b`, integer → `i`, non-integer number → `d`). Throws when
 * neither a known declared type nor an inferable JS type applies. Pure (no
 * GLib) so the marshalling decision is unit-testable on node + gjs.
 */
export function variantKindFor(declaredType: string | null, value: unknown): VariantKind {
    switch (declaredType) {
        case 's':
        case 'b':
        case 'i':
        case 'u':
        case 'd':
            return declaredType;
    }
    if (typeof value === 'string') return 's';
    if (typeof value === 'boolean') return 'b';
    if (typeof value === 'number') return Number.isInteger(value) ? 'i' : 'd';
    throw new Error(`Cannot build a GLib.Variant from ${typeof value}`);
}

/**
 * Build a `GLib.Variant` for an action parameter/state from a plain JS value,
 * using the action's declared type when known and otherwise inferring from
 * the JS runtime type (see {@link variantKindFor}).
 */
export function buildVariant(type: GLib.VariantType | null, value: unknown): GLib.Variant {
    switch (variantKindFor(type?.dup_string() ?? null, value)) {
        case 's':
            return GLib.Variant.new_string(String(value));
        case 'b':
            return GLib.Variant.new_boolean(Boolean(value));
        case 'i':
            return GLib.Variant.new_int32(Number(value));
        case 'u':
            return GLib.Variant.new_uint32(Number(value));
        case 'd':
            return GLib.Variant.new_double(Number(value));
    }
}
