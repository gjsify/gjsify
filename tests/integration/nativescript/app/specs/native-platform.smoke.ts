// SPDX-License-Identifier: MIT
// Smoke spec for @gjsify/native-platform (nativescript:'native' slot) on NS V8.
// Unlike the portable polyfills, this package's WHOLE point is to read the
// NativeScript platform globals (java/android.os.Build on Android,
// NSFileManager/UIDevice on iOS). Running it on a real device/emulator is the
// only way to confirm the detection + info reads actually work — off-platform
// (GJS/Node) it can only ever report 'unknown' (covered by its unit spec).
import {
    isAndroid,
    isIOS,
    isNativeScript,
    platformName,
    assertNativeScript,
    platformInfo,
} from '@gjsify/native-platform';
import { describe, it, expect } from '../reporter.js';

export default async function nativePlatformSmoke(): Promise<void> {
    await describe('@gjsify/native-platform', async () => {
        await it('detects the NativeScript runtime', () => {
            expect(isNativeScript).toBe(true);
        });

        await it('reports exactly one of android / ios', () => {
            // XOR: precisely one platform flag is set on a real device.
            expect(isAndroid !== isIOS).toBe(true);
        });

        await it('platformName() is android or ios', () => {
            expect(['android', 'ios']).toContain(platformName());
        });

        await it('assertNativeScript() does not throw on-device', () => {
            assertNativeScript();
            expect(true).toBe(true);
        });

        await it('platformInfo() matches the detected platform', () => {
            const info = platformInfo();
            expect(info.platform).toBe(platformName());
        });

        await it('platformInfo() reports a real OS version', () => {
            const info = platformInfo();
            expect(typeof info.osVersion).toBe('string');
            // A real device reports a concrete version, never the off-platform
            // 'unknown' sentinel.
            expect(info.osVersion === 'unknown').toBe(false);
            expect(info.osVersion.length > 0).toBe(true);
        });

        await it('platformInfo() reports a device model', () => {
            const info = platformInfo();
            expect(typeof info.deviceModel).toBe('string');
            expect(info.deviceModel.length > 0).toBe(true);
        });

        await it('sdkInt is a positive number on Android, null on iOS', () => {
            const info = platformInfo();
            if (isAndroid) {
                expect(typeof info.sdkInt).toBe('number');
                expect((info.sdkInt ?? 0) > 0).toBe(true);
            } else {
                expect(info.sdkInt).toBe(null);
            }
        });
    });
}
