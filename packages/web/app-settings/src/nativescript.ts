// NativeScript entry: `Gio.Settings` over `ApplicationSettings` (SharedPreferences on Android)
// — ADR 0099 § 3. Same storage key as the browser: `<path><key>`. An array key is a string, its
// `print(false)` text (ADR 0118 § 3); one that does not parse counts as unset and logs once.

import { ApplicationSettings } from '@nativescript/core';

import {
    defineSettings,
    isArrayKeyType,
    parseArrayValue,
    printArrayValue,
    type ArrayKeyType,
    type SettingValue,
    type SettingsStorage,
} from './settings.js';

export type { Schema, SchemaKey, SettingValue, SettingsProps, SettingsStorage, KeyType } from './settings.js';
export { defineSettings } from './settings.js';

const warned = new Set<string>();

function readArray(storageKey: string, type: ArrayKeyType): SettingValue | undefined {
    try {
        return parseArrayValue(type, ApplicationSettings.getString(storageKey));
    } catch {
        if (!warned.has(storageKey)) {
            warned.add(storageKey);
            console.warn(`Gio.Settings: stored value of '${storageKey}' is not a '${type}'; using the default`);
        }
        return undefined;
    }
}

export const applicationSettingsStorage: SettingsStorage = {
    read(storageKey, type) {
        if (!ApplicationSettings.hasKey(storageKey)) return undefined;
        if (isArrayKeyType(type)) return readArray(storageKey, type);
        if (type === 'b') return ApplicationSettings.getBoolean(storageKey);
        if (type === 's') return ApplicationSettings.getString(storageKey);
        return ApplicationSettings.getNumber(storageKey);
    },
    write(storageKey, type, value) {
        if (isArrayKeyType(type)) ApplicationSettings.setString(storageKey, printArrayValue(type, value));
        else if (type === 'b') ApplicationSettings.setBoolean(storageKey, value as boolean);
        else if (type === 's') ApplicationSettings.setString(storageKey, value as string);
        else ApplicationSettings.setNumber(storageKey, value as number);
    },
};

export const Settings = defineSettings(applicationSettingsStorage);
export type Settings = InstanceType<typeof Settings>;
