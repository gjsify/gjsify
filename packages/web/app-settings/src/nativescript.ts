// NativeScript entry: `Gio.Settings` over `ApplicationSettings` (SharedPreferences on Android)
// — ADR 0099 § 3. Same storage key as the browser: `<path><key>`.

import { ApplicationSettings } from '@nativescript/core';

import { defineSettings, type SettingsStorage } from './settings.js';

export type { Schema, SchemaKey, SettingValue, SettingsProps, SettingsStorage, KeyType } from './settings.js';
export { defineSettings } from './settings.js';

export const applicationSettingsStorage: SettingsStorage = {
    read(storageKey, type) {
        if (!ApplicationSettings.hasKey(storageKey)) return undefined;
        if (type === 'b') return ApplicationSettings.getBoolean(storageKey);
        if (type === 's') return ApplicationSettings.getString(storageKey);
        return ApplicationSettings.getNumber(storageKey);
    },
    write(storageKey, type, value) {
        if (type === 'b') ApplicationSettings.setBoolean(storageKey, value as boolean);
        else if (type === 's') ApplicationSettings.setString(storageKey, value as string);
        else ApplicationSettings.setNumber(storageKey, value as number);
    },
};

export const Settings = defineSettings(applicationSettingsStorage);
export type Settings = InstanceType<typeof Settings>;
