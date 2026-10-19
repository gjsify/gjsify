import { GLibVariant } from '@gjsify/adwaita-core';
import { describe, expect, it } from '@gjsify/unit';

import { FIXTURE_SCHEMA, driveSettingsVectors } from './conformance/settings.js';
import { defineSettings, type SettingValue, type SettingsStorage } from './settings.js';

function memoryStorage(): SettingsStorage & { clear(): void } {
    const map = new Map<string, SettingValue>();
    return {
        read: (key) => map.get(key),
        write: (key, _type, value) => void map.set(key, value),
        clear: () => map.clear(),
    };
}

export default async () => {
    const storage = memoryStorage();
    const Settings = defineSettings(storage);
    Settings.register(FIXTURE_SCHEMA);
    await driveSettingsVectors(
        {
            name: 'subset over an in-memory storage',
            isOracle: false,
            Settings,
            Variant: GLibVariant,
            reset: () => storage.clear(),
        },
        { describe, it, expect },
    );

    await describe('app-settings: registration', async () => {
        await it('refuses a key type outside b i u d s', () => {
            expect(() =>
                Settings.register({ id: 'x', path: '/x/', keys: { k: { type: 'a' as never, default: 0 } } }),
            ).toThrow();
        });
        await it('refuses a nested array key', () => {
            expect(() =>
                Settings.register({ id: 'x', path: '/x/', keys: { k: { type: 'aai' as never, default: [] } } }),
            ).toThrow();
        });
        await it('refuses a schema without a path', () => {
            expect(() => Settings.register({ id: 'x', path: '', keys: {} })).toThrow();
        });
    });
};
