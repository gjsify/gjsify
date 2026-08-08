// Parameter binding helpers for SQLite statements via Gda
// Reference: Node.js lib/sqlite.js
// Reimplemented for GJS using Gda-6.0

import type Gda from '@girs/gda-6.0';
import type GObject from '@girs/gobject-2.0';
import { SqliteError } from './errors.ts';

/**
 * GJS auto-converts plain JS primitives to the matching `GObject.Value` when calling
 * `Gda.Holder.set_value()`, but the GIR-typed signature only accepts
 * `GObject.Value | null`. This helper hides the necessary structural cast once and lets
 * the call sites stay free of `as any`.
 */
function setHolderString(holder: Gda.Holder, value: string): boolean {
    return holder.set_value(value as unknown as GObject.Value);
}

/**
 * Bind the string parameters of one execution to the holders libgda created for them.
 *
 * Only strings are bound. Every other type is rendered as a SQL literal by
 * `sqlLiteral()`, because those alphabets cannot break out of the statement — whereas a
 * string can, and did: libgda reads `\` as an escape inside `'…'` where SQLite does not.
 *
 * A missing holder is a bug in this package (the SQL and the holder set come from the
 * same `convertParameterSyntax` pass), so it raises rather than binding nothing and
 * silently writing NULL.
 */
export function bindStringHolders(paramSet: Gda.Set | null, strings: Map<string, string>): void {
    if (strings.size === 0) return;
    if (!paramSet) {
        throw new SqliteError('Failed to bind parameters: statement has no parameter set');
    }
    for (const [gdaId, value] of strings) {
        const holder = paramSet.get_holder(gdaId);
        if (!holder) {
            throw new SqliteError(`Failed to bind parameter '${gdaId}'`);
        }
        setHolderString(holder, value);
    }
}
