// Browser entry: `Gio.Settings` over `localStorage` — ADR 0099 § 3. Encoding: `b` as
// "true"/"false", `i u d` decimal, `s` the string, an array key its `print(false)` text (ADR 0118
// § 3). An unparsable stored value counts as unset and logs once per key. A `storage` event from
// another tab emits `changed::key`.

import {
    defineSettings,
    isArrayKeyType,
    parseArrayValue,
    printArrayValue,
    type KeyType,
    type SettingValue,
    type SettingsStorage,
} from './settings.js';

export type { Schema, SchemaKey, SettingValue, SettingsProps, SettingsStorage, KeyType } from './settings.js';
export { defineSettings } from './settings.js';

const warned = new Set<string>();

function decode(storageKey: string, type: KeyType, raw: string): SettingValue | undefined {
    let value: SettingValue | undefined;
    if (isArrayKeyType(type)) {
        try {
            value = parseArrayValue(type, raw);
        } catch {
            value = undefined;
        }
    } else if (type === 's') value = raw;
    else if (type === 'b') value = raw === 'true' ? true : raw === 'false' ? false : undefined;
    else {
        const n = Number(raw);
        value = raw.trim() !== '' && Number.isFinite(n) && (type === 'd' || Number.isInteger(n)) ? n : undefined;
    }
    if (value === undefined && !warned.has(storageKey)) {
        warned.add(storageKey);
        console.warn(`Gio.Settings: stored value of '${storageKey}' is not a '${type}'; using the default`);
    }
    return value;
}

export const localStorageStorage: SettingsStorage = {
    read(storageKey, type) {
        const raw = globalThis.localStorage.getItem(storageKey);
        return raw === null ? undefined : decode(storageKey, type, raw);
    },
    write(storageKey, type, value) {
        try {
            const text = isArrayKeyType(type) ? printArrayValue(type, value) : String(value);
            globalThis.localStorage.setItem(storageKey, text);
        } catch (error) {
            throw new Error(`Gio.Settings: cannot store '${storageKey}': ${(error as Error).message}`);
        }
    },
};

export const Settings = defineSettings(localStorageStorage);
export type Settings = InstanceType<typeof Settings>;

if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('storage', (event) => {
        const { key } = event as StorageEvent;
        if (key !== null) Settings.notifyStorage(key);
    });
}
