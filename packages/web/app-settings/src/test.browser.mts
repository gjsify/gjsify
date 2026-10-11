import { describe, expect, it, run } from '@gjsify/unit';

import { Settings } from './browser.js';
import { FIXTURE_SCHEMA, driveSettingsVectors } from './conformance/settings.js';

run({
    async SettingsBrowserTest() {
        Settings.register(FIXTURE_SCHEMA);
        await driveSettingsVectors(
            {
                name: 'subset over localStorage',
                isOracle: false,
                Settings,
                reset: () => globalThis.localStorage.clear(),
            },
            { describe, it, expect },
        );
    },
});
