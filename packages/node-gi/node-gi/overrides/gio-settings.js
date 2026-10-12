// SPDX-License-Identifier: MIT OR LGPL-2.0-or-later
//
// Adapted from GJS (refs/gjs/modules/core/overrides/Gio.js, "Override Gio.Settings and
// Gio.SettingsSchema"). Copyright (c) GJS contributors. MIT OR LGPL-2.0-or-later.
//
// Why this exists: the C API of GSettings does not fail, it ABORTS. An unknown schema id or an
// unknown key is a `g_error` (G_LOG_LEVEL_ERROR, fatal), so on a bare binding one typo kills the
// process with no catchable error — measured on node-gi, GLib 2.88: `new Gio.Settings({schema_id:
// 'no.such'})` and `s.get_int('nope')` both exit the process. GJS wraps both in a JS check that
// throws; this is the same wrapper, so `try { … } catch` means the same on either runtime
// (ADR 0099 conformance row `errors`).
//
// Two deliberate differences from the GJS override:
//   • the constructor check is a Proxy `construct` trap — a node-gi class has no `_init` to wrap;
//   • `set_int` / `set_uint` range-check their value, which in GJS is the argument marshaller's
//     job. node-gi's marshaller wraps modulo 2^32 (`set_uint('k', -1)` stores 4294967295), a
//     general divergence recorded in status/open-todos/node-gi.md; this keeps the settings
//     surface honest without touching the addon, so it also holds in an already-built payload.

const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;
const UINT32_MAX = 2 ** 32 - 1;

const CHECKED = [
    'get_boolean',
    'set_boolean',
    'get_double',
    'set_double',
    'get_enum',
    'set_enum',
    'get_flags',
    'set_flags',
    'get_int',
    'set_int',
    'get_int64',
    'set_int64',
    'get_string',
    'set_string',
    'get_strv',
    'set_strv',
    'get_uint',
    'set_uint',
    'get_uint64',
    'set_uint64',
    'get_value',
    'set_value',
    'bind',
    'bind_writable',
    'create_action',
    'get_default_value',
    'get_user_value',
    'is_writable',
    'reset',
];

/** The range a setter's JS number must be in; GJS's marshaller throws this exact message. */
const RANGES = {
    set_int: [INT32_MIN, INT32_MAX, 'int32'],
    set_uint: [0, UINT32_MAX, 'uint32'],
};

/**
 * Patch `Gio.Settings` / `Gio.SettingsSchema` like GJS does, once, and return the class to hand
 * out (a Proxy whose `new` refuses a schema that is not installed instead of aborting).
 * @param {{ Settings: any, SettingsSchema: any, SettingsSchemaSource: any }} Gio the introspected namespace
 */
export function createGioSettings(Gio) {
    const Settings = Gio.Settings;
    const schemaProto = Gio.SettingsSchema.prototype;
    const proto = Settings.prototype;

    const realGetKey = schemaProto.get_key;
    schemaProto.get_key = function get_key(key) {
        if (!this.has_key(key)) throw new Error(`GSettings key ${key} not found in schema ${this.get_id()}`);
        return realGetKey.call(this, key);
    };

    // The key and child lists are per instance and a schema's keys never change, so one read each.
    const keysOf = new WeakMap();
    const childrenOf = new WeakMap();
    const checkKey = (self, key) => {
        let keys = keysOf.get(self);
        if (keys === undefined) keysOf.set(self, (keys = self.settings_schema.list_keys()));
        if (!keys.includes(key)) throw new Error(`GSettings key ${key} not found in schema ${self.schema_id}`);
    };

    for (const name of CHECKED) {
        const real = proto[name];
        if (typeof real !== 'function') continue;
        const range = RANGES[name];
        proto[name] = function (key, ...args) {
            checkKey(this, key);
            if (range !== undefined) {
                const [min, max, type] = range;
                const value = args[0];
                if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
                    throw new Error(`Argument value: value is out of range for ${type}`);
                }
            }
            return real.call(this, key, ...args);
        };
    }

    const realGetChild = proto.get_child;
    proto.get_child = function get_child(name) {
        let children = childrenOf.get(this);
        if (children === undefined) childrenOf.set(this, (children = this.list_children()));
        if (!children.includes(name)) {
            throw new Error(`Child ${name} not found in GSettings schema ${this.schema_id}`);
        }
        return realGetChild.call(this, name);
    };

    // A boxed instance is a Proxy over a handle with no prototype link to its class, so
    // `instanceof Gio.SettingsSchema` is false for the very schema `lookup` returned. Recognise it
    // by the methods the constructor needs instead.
    const isSchema = (value) =>
        value instanceof Gio.SettingsSchema ||
        (value !== null &&
            typeof value === 'object' &&
            typeof value.get_id === 'function' &&
            typeof value.list_keys === 'function');

    return new Proxy(Settings, {
        construct(target, args) {
            const props = args[0] ?? {};
            const schemaIdProp = ['schema', 'schema-id', 'schema_id', 'schemaId'].find((p) => p in props);
            const schemaProp = ['settings-schema', 'settings_schema', 'settingsSchema'].find((p) => p in props);
            if (!schemaIdProp && !schemaProp) {
                throw new Error("One of property 'schema-id' or 'settings-schema' are required for Gio.Settings");
            }
            if (schemaProp && !isSchema(props[schemaProp])) {
                throw new Error(`Value of property '${schemaProp}' is not of type Gio.SettingsSchema`);
            }
            const schema = schemaProp
                ? props[schemaProp]
                : Gio.SettingsSchemaSource.get_default()?.lookup(props[schemaIdProp], true);
            if (!schema) throw new Error(`GSettings schema ${props[schemaIdProp]} not found`);
            const schemaPath = schema.get_path();
            if (props.path === undefined && !schemaPath) {
                throw new Error(`Attempting to create schema '${schema.get_id()}' without a path`);
            }
            if (props.path !== undefined && schemaPath && props.path !== schemaPath) {
                throw new Error(`GSettings created for path '${props.path}', but schema specifies '${schemaPath}'`);
            }
            // newTarget stays the real class: a node-gi class is an exotic constructor, and the
            // Proxy must not become the `new.target` its wrapper builds the instance from.
            return Reflect.construct(target, args);
        },
    });
}
