// `Gio.Settings` as a strict subset — ADR 0099. The class is written once, over a
// `SettingsStorage` a platform entry supplies (`localStorage`, NativeScript
// `ApplicationSettings`); what GIO has and this does not is refused by name, never ignored.
//
// `changed` follows the GJS memory backend (the oracle of `SETTINGS_VECTORS`): a write fires
// when the stored value differs from the new one, and a never-written key counts as different,
// so the first write of the default fires. A write equal to the stored value is silent. The
// keyfile backend fires on every write; the subset does not copy that.
//
// Reference: glib gio/gsettings.c

export type KeyType = 'b' | 'i' | 'u' | 'd' | 's';
export type SettingValue = boolean | number | string;

export interface SchemaKey {
    readonly type: KeyType;
    readonly default: SettingValue;
}

/** What the build step (`?schema`) carries per schema: type and default per key, nothing else. */
export interface Schema {
    readonly id: string;
    readonly path: string;
    readonly keys: Readonly<Record<string, SchemaKey>>;
}

/** The storage below `Settings`. `read` returns `undefined` for a key never written. */
export interface SettingsStorage {
    read(storageKey: string, type: KeyType): SettingValue | undefined;
    write(storageKey: string, type: KeyType, value: SettingValue): void;
}

export interface SettingsProps {
    schema_id: string;
    path?: string;
}

type ChangedHandler = (settings: object, key: string) => void;

const REFUSED_METHODS = [
    'list_keys',
    'get_value',
    'set_value',
    'get_user_value',
    'get_default_value',
    'reset',
    'apply',
    'delay',
    'revert',
    'sync',
    'get_has_unapplied',
    'is_writable',
    'list_children',
    'get_child',
    'bind',
    'bind_with_mapping',
    'bind_writable',
    'create_action',
] as const;

const INT32 = { min: -(2 ** 31), max: 2 ** 31 - 1 };
const UINT32 = { min: 0, max: 2 ** 32 - 1 };

const TYPE_NAMES: Record<KeyType, string> = {
    b: 'boolean',
    i: 'int',
    u: 'uint',
    d: 'double',
    s: 'string',
};

const BUILD_TYPES = new Set<string>(['b', 'i', 'u', 'd', 's']);

function refuse(feature: string, detail: string): Error {
    return new Error(`Gio.Settings: ${feature} ${detail}, which is outside the Gio.Settings subset (ADR 0099 § 2).`);
}

function checkValue(type: KeyType, value: SettingValue, key: string): void {
    const bad = (): TypeError => new TypeError(`Gio.Settings: key '${key}' is of type '${type}', not ${typeof value}`);
    if (type === 'b') {
        if (typeof value !== 'boolean') throw bad();
    } else if (type === 's') {
        if (typeof value !== 'string') throw bad();
    } else {
        if (typeof value !== 'number' || Number.isNaN(value)) throw bad();
        if (type !== 'd') {
            const range = type === 'i' ? INT32 : UINT32;
            if (!Number.isInteger(value) || value < range.min || value > range.max) {
                throw new RangeError(
                    `Gio.Settings: value ${value} for key '${key}' is out of range for ${TYPE_NAMES[type]}`,
                );
            }
        }
    }
}

/** The public instance surface; spelled out because declaration emit cannot carry `#private` members. */
export interface Settings {
    readonly schema_id: string;
    readonly path: string;
    get_boolean(key: string): boolean;
    get_int(key: string): number;
    get_uint(key: string): number;
    get_double(key: string): number;
    get_string(key: string): string;
    set_boolean(key: string, value: boolean): boolean;
    set_int(key: string, value: number): boolean;
    set_uint(key: string, value: number): boolean;
    set_double(key: string, value: number): boolean;
    set_string(key: string, value: string): boolean;
    connect(signal: string, run: ChangedHandler): number;
    disconnect(id: number): void;
}

export interface SettingsClass {
    new (props: SettingsProps): Settings;
    /** The only addition to GIO's names: the build step calls it with the `?schema` module. */
    register(schema: Schema): void;
    /** A write made elsewhere (another tab's `storage` event): emits `changed::key` for it. */
    notifyStorage(storageKey: string): void;
}

/** The one `Settings` class for a storage. Registered schemas and live instances are per class. */
export function defineSettings(storage: SettingsStorage): SettingsClass {
    const schemas = new Map<string, Schema>();
    const live = new Map<string, Set<Settings>>();

    class Settings {
        readonly schema_id: string;
        readonly path: string;
        #schema: Schema;
        #nextId = 1;
        #handlers = new Map<number, { key: string | null; run: ChangedHandler }>();

        /** The only addition to GIO's names: the build step calls it with the `?schema` module. */
        static register(schema: Schema): void {
            if (!schema.path) throw new Error(`Gio.Settings: schema '${schema.id}' has no path`);
            for (const [key, def] of Object.entries(schema.keys)) {
                if (!BUILD_TYPES.has(def.type)) {
                    throw refuse(
                        `key '${key}' of type '${def.type}' in schema '${schema.id}'`,
                        'is not a b i u d s key',
                    );
                }
            }
            schemas.set(schema.id, schema);
        }

        constructor(props: SettingsProps) {
            for (const name of Object.keys(props ?? {})) {
                if (name !== 'schema_id' && name !== 'path') {
                    throw refuse(`the '${name}' construct property`, 'is not implemented');
                }
            }
            const schema = schemas.get(props?.schema_id);
            if (!schema) throw new Error(`GSettings schema ${props?.schema_id} not found`);
            if (props.path !== undefined && props.path !== schema.path) {
                throw new Error(`Gio.Settings: path '${props.path}' differs from the schema's '${schema.path}'`);
            }
            this.#schema = schema;
            this.schema_id = schema.id;
            this.path = schema.path;
            let siblings = live.get(schema.path);
            if (!siblings) live.set(schema.path, (siblings = new Set()));
            siblings.add(this);
        }

        #keyOf(key: string, expected: KeyType): SchemaKey {
            const def = this.#schema.keys[key];
            if (!def) throw new Error(`GSettings key ${key} not found in schema ${this.schema_id}`);
            if (def.type !== expected) {
                throw new TypeError(
                    `Gio.Settings: key '${key}' is of type '${def.type}', not '${expected}' (${TYPE_NAMES[expected]})`,
                );
            }
            return def;
        }

        #get(key: string, expected: KeyType): SettingValue {
            const def = this.#keyOf(key, expected);
            const stored = storage.read(this.path + key, expected);
            return stored === undefined ? def.default : stored;
        }

        #set(key: string, expected: KeyType, value: SettingValue): boolean {
            this.#keyOf(key, expected);
            checkValue(expected, value, key);
            const storageKey = this.path + key;
            const before = storage.read(storageKey, expected);
            storage.write(storageKey, expected, value);
            if (before !== value) this.notifyAll(key);
            return true;
        }

        /** Every instance on this path, this one included: two `Settings` on a schema agree. */
        notifyAll(key: string): void {
            Settings.#fanOut(this.path, key);
        }

        static #fanOut(path: string, key: string): void {
            for (const other of live.get(path) ?? []) other.#emit(key);
        }

        /** A write made elsewhere (another tab's `storage` event): emits `changed::key` for it. */
        static notifyStorage(storageKey: string): void {
            for (const [path, instances] of live) {
                if (!storageKey.startsWith(path)) continue;
                const key = storageKey.slice(path.length);
                const [first] = instances;
                if (first && key in first.#schema.keys) Settings.#fanOut(path, key);
            }
        }

        #emit(key: string): void {
            for (const { key: only, run } of Array.from(this.#handlers.values())) {
                if (only === null || only === key) run(this, key);
            }
        }

        get_boolean(key: string): boolean {
            return this.#get(key, 'b') as boolean;
        }
        get_int(key: string): number {
            return this.#get(key, 'i') as number;
        }
        get_uint(key: string): number {
            return this.#get(key, 'u') as number;
        }
        get_double(key: string): number {
            return this.#get(key, 'd') as number;
        }
        get_string(key: string): string {
            return this.#get(key, 's') as string;
        }
        set_boolean(key: string, value: boolean): boolean {
            return this.#set(key, 'b', value);
        }
        set_int(key: string, value: number): boolean {
            return this.#set(key, 'i', value);
        }
        set_uint(key: string, value: number): boolean {
            return this.#set(key, 'u', value);
        }
        set_double(key: string, value: number): boolean {
            return this.#set(key, 'd', value);
        }
        set_string(key: string, value: string): boolean {
            return this.#set(key, 's', value);
        }

        connect(signal: string, run: ChangedHandler): number {
            const at = signal.indexOf('::');
            const name = at === -1 ? signal : signal.slice(0, at);
            if (name !== 'changed') throw new Error(`No signal '${signal}' on object 'GSettings'`);
            const id = this.#nextId++;
            this.#handlers.set(id, { key: at === -1 ? null : signal.slice(at + 2), run });
            return id;
        }

        disconnect(id: number): void {
            if (!this.#handlers.delete(id)) throw new Error(`No handler with id ${id} is connected to GSettings`);
        }
    }

    for (const name of REFUSED_METHODS) {
        Object.defineProperty(Settings.prototype, name, {
            value() {
                throw refuse(`${name}()`, 'is not implemented');
            },
        });
    }
    for (const name of ['new', 'new_with_path', 'new_full']) {
        Object.defineProperty(Settings, name, {
            value() {
                throw refuse(`Settings.${name}()`, 'is not implemented; construct with { schema_id }');
            },
        });
    }
    return Settings as unknown as SettingsClass;
}
