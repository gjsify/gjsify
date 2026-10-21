// Parameter binding helpers for SQLite statements via Gda
// Reference: Node.js lib/sqlite.js
// Reimplemented for GJS using Gda-6.0

import type Gda from '@girs/gda-6.0';
import type GObject from '@girs/gobject-2.0';
import { SqliteError } from './errors.ts';

/**
 * The GType a value is bound through, spelled the same way in the `##id::type`
 * placeholder and in the holder libgda creates from it.
 *
 * Measured against a TEXT read-back of the stored value: `gint64` round-trips every
 * int64 exactly — 2^53 + 1 and both extremes included — and `gdouble` yields a REAL, so
 * `42` reads back as `42.0`, `Infinity` as `Inf` and `NaN` as NULL. Value for value that
 * is what the SQL literals these replaced produced.
 */
export type HolderType = 'gchararray' | 'gint64' | 'gdouble';

/** One parameter of one execution, bound rather than written into the SQL. */
export interface HolderBinding {
    type: HolderType;
    value: string | number | bigint;
}

/**
 * GJS auto-converts a plain JS primitive to the matching `GObject.Value` when calling
 * `Gda.Holder.set_value()`, but the GIR-typed signature only accepts
 * `GObject.Value | null`. This helper hides the necessary structural cast once and lets
 * the call sites stay free of `as any`.
 */
function setHolderValue(holder: Gda.Holder, value: string | number | bigint): boolean {
    return holder.set_value(value as unknown as GObject.Value);
}

/**
 * Bind the parameters of one execution to the holders libgda created for them.
 *
 * A bound parameter is what lets the SQL TEXT stay the same across executions, which is
 * what lets the parsed statement — and the connection's compiled `sqlite3_stmt` behind it
 * — be reused (see execution.ts). NULL and BLOBs are the two values that cannot take this
 * route and stay SQL literals: libgda refuses NULL through a holder by every spelling
 * (`set_value(null)`, `Gda.value_new_null()`, `force_invalid()`, and leaving it unset all
 * raise), and a `Uint8Array` is "Could not guess unspecified GValue type" while a
 * `GLib.Bytes` is a type mismatch.
 *
 * A string is the one type that MUST be bound: libgda reads `\` as an escape inside `'…'`
 * where SQLite does not, so a value ending in a backslash ran the quoted region past its
 * intended end (see parse-sql.ts).
 *
 * A missing holder is a bug in this package — the SQL and the holder set come from the
 * same `convertParameterSyntax` pass — so it raises rather than binding nothing and
 * silently writing NULL.
 */
export function bindHolders(paramSet: Gda.Set | null, bindings: Map<string, HolderBinding>): void {
    if (bindings.size === 0) return;
    if (!paramSet) {
        throw new SqliteError('Failed to bind parameters: statement has no parameter set');
    }
    for (const [gdaId, binding] of bindings) {
        const holder = paramSet.get_holder(gdaId);
        if (!holder) {
            throw new SqliteError(`Failed to bind parameter '${gdaId}'`);
        }
        setHolderValue(holder, binding.value);
    }
}
