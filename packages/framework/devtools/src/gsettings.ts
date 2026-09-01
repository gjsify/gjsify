// @gjsify/devtools — read a GSettings schema's keys + values. Original implementation.

import Gio from 'gi://Gio?version=2.0';
import { formatDbusErrorMessage } from '@gjsify/devtools-protocol';

/**
 * Dump every key + current value of an installed GSettings schema (read-only).
 * Throws a `not-found`-coded error (the code survives the DBus wire) when the
 * schema id is not installed.
 */
export function dumpGSettings(schemaId: string): Record<string, unknown> {
    const source = Gio.SettingsSchemaSource.get_default();
    const schema = source?.lookup(schemaId, true);
    if (!schema) {
        throw new Error(formatDbusErrorMessage('not-found', `GSettings schema '${schemaId}' is not installed`));
    }
    const settings = new Gio.Settings({ settings_schema: schema });
    const out: Record<string, unknown> = {};
    for (const key of schema.list_keys()) {
        out[key] = settings.get_value(key).recursiveUnpack();
    }
    return out;
}
