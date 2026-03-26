// Parameter binding helpers for SQLite statements via Gda
// Reference: Node.js lib/sqlite.js
// Reimplemented for GJS using Gda-6.0

import Gda from '@girs/gda-6.0';
import GObject from '@girs/gobject-2.0';
import { InvalidArgTypeError, InvalidArgValueError, InvalidStateError, SqliteError } from './errors.ts';
import type { SQLiteValue } from './types.ts';

const MAX_INT64 = 9223372036854775807n;
const MIN_INT64 = -9223372036854775808n;

function validateBindValue(value: unknown, paramIndex: number): void {
    if (value === null || value === undefined) return;
    const t = typeof value;
    if (t === 'number' || t === 'bigint' || t === 'string' || t === 'boolean') return;
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) return;
    if (ArrayBuffer.isView(value)) return;
    throw new InvalidArgTypeError(
        `Provided value cannot be bound to SQLite parameter ${paramIndex}.`
    );
}

function setHolderValue(holder: Gda.Holder, value: unknown): void {
    if (value === null || value === undefined) {
        holder.set_value(null);
        return;
    }
    if (typeof value === 'number') {
        holder.set_value(value);
        return;
    }
    if (typeof value === 'bigint') {
        if (value > MAX_INT64 || value < MIN_INT64) {
            throw new InvalidArgValueError(
                `BigInt value is too large to bind.`
            );
        }
        holder.set_value(Number(value));
        return;
    }
    if (typeof value === 'string') {
        holder.set_value(value);
        return;
    }
    if (typeof value === 'boolean') {
        holder.set_value(value ? 1 : 0);
        return;
    }
    if (value instanceof Uint8Array || ArrayBuffer.isView(value)) {
        const bytes = value instanceof Uint8Array ? value : new Uint8Array((value as ArrayBufferView).buffer);
        holder.set_value(bytes);
        return;
    }
    holder.set_value(value);
}

export interface BindingContext {
    allowBareNamedParameters: boolean;
    allowUnknownNamedParameters: boolean;
}

export function bindParameters(
    paramSet: Gda.Set | null,
    anonymousArgs: unknown[],
    namedArgs: Record<string, unknown> | null,
    ctx: BindingContext,
): void {
    if (!paramSet) {
        if (anonymousArgs.length > 0) {
            throw new SqliteError('column index out of range', 25, 'column index out of range');
        }
        return;
    }

    const holders = paramSet.get_holders();

    if (namedArgs) {
        // Named parameter binding
        const usedKeys = new Set<string>();

        for (const holder of holders) {
            const id = holder.get_id();
            let value: unknown = undefined;
            let found = false;

            // Try exact match (with prefix): $name, :name, @name
            if (id in namedArgs) {
                value = namedArgs[id];
                usedKeys.add(id);
                found = true;
            }

            // Try bare name (without prefix)
            if (!found && ctx.allowBareNamedParameters) {
                const bareName = id.replace(/^[\$:@]/, '');
                if (bareName in namedArgs) {
                    value = namedArgs[bareName];
                    usedKeys.add(bareName);
                    found = true;
                }
            }

            if (!found && !ctx.allowBareNamedParameters) {
                // Check if user passed bare name — error
                const bareName = id.replace(/^[\$:@]/, '');
                if (bareName in namedArgs) {
                    throw new InvalidStateError(`Unknown named parameter '${bareName}'`);
                }
            }

            if (found) {
                const paramIdx = holders.indexOf(holder) + 1;
                validateBindValue(value, paramIdx);
                setHolderValue(holder, value);
            } else {
                setHolderValue(holder, null);
            }
        }

        // Check for unknown named parameters
        if (!ctx.allowUnknownNamedParameters) {
            for (const key of Object.keys(namedArgs)) {
                if (!usedKeys.has(key)) {
                    // Check if any holder matches this key with prefix
                    const matchesHolder = holders.some(h => {
                        const id = h.get_id();
                        return id === key || id.replace(/^[\$:@]/, '') === key;
                    });
                    if (!matchesHolder) {
                        throw new InvalidStateError(`Unknown named parameter '${key}'`);
                    }
                }
            }
        }
    } else {
        // Positional parameter binding
        if (anonymousArgs.length > holders.length) {
            throw new SqliteError('column index out of range', 25, 'column index out of range');
        }

        for (let i = 0; i < holders.length; i++) {
            const value = i < anonymousArgs.length ? anonymousArgs[i] : undefined;
            validateBindValue(value, i + 1);
            setHolderValue(holders[i], value ?? null);
        }
    }
}
