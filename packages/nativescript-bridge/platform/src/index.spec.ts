// @gjsify/native-platform — unit tests.
// These run on GJS + Node where neither java nor NSFileManager is present, so
// the platform reads as "unknown"/not-NativeScript. On-device behavior (real
// Android/iOS values) is validated separately via the NS integration suite.

import { describe, it, expect } from '@gjsify/unit';

import {
    isAndroid,
    isIOS,
    isNativeScript,
    platformName,
    assertNativeScript,
    platformInfo,
    osVersion,
    sdkInt,
    deviceModel,
} from './index.js';

export default async () => {
    await describe('@gjsify/native-platform outside NativeScript', async () => {
        await it('reports not Android, not iOS, not NativeScript', async () => {
            expect(isAndroid).toBe(false);
            expect(isIOS).toBe(false);
            expect(isNativeScript).toBe(false);
        });

        await it('platformName() is "unknown"', async () => {
            expect(platformName()).toBe('unknown');
        });

        await it('assertNativeScript() throws Platform not supported', async () => {
            expect(() => assertNativeScript()).toThrow('Platform not supported');
        });

        await it('platformInfo() returns a fully "unknown" record (non-throwing)', async () => {
            const info = platformInfo();
            expect(info.platform).toBe('unknown');
            expect(info.osVersion).toBe('unknown');
            expect(info.sdkInt).toBe(null);
            expect(info.deviceModel).toBe('unknown');
            expect(info.manufacturer).toBe('unknown');
        });

        await it('convenience accessors mirror platformInfo()', async () => {
            expect(osVersion()).toBe('unknown');
            expect(sdkInt()).toBe(null);
            expect(deviceModel()).toBe('unknown');
        });
    });
};
