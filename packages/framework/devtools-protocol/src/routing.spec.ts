// @gjsify/devtools-protocol — instance routing tests.
// Cross-platform (pure TS): runs identically on Node and GJS.

import { describe, expect, it } from '@gjsify/unit';
import {
    DEVTOOLS_ADDRESS_ENV,
    devtoolsAddressFilePath,
    isDevtoolsEnabledValue,
    resolveBusAddress,
    sanitizeInstanceId,
} from './routing.js';

export default async () => {
    await describe('sanitizeInstanceId', async () => {
        await it('lowercases and strips non-alphanumerics', async () => {
            expect(sanitizeInstanceId('Host-1')).toBe('host1');
            expect(sanitizeInstanceId('My Editor!')).toBe('myeditor');
        });

        await it('prefixes a leading non-letter (and empties)', async () => {
            expect(sanitizeInstanceId('2nd')).toBe('i2nd');
            expect(sanitizeInstanceId('')).toBe('i0');
            expect(sanitizeInstanceId('___')).toBe('i0');
        });
    });

    await describe('resolveBusAddress', async () => {
        await it('keeps the bare base for the default instance', async () => {
            const expected = {
                busName: 'org.example.App',
                objectPath: '/org/example/App/devtools',
                instance: 'default',
            };
            expect(resolveBusAddress('org.example.App')).toStrictEqual(expected);
            expect(resolveBusAddress('org.example.App', 'default')).toStrictEqual(expected);
        });

        await it('suffixes a named instance on both bus name and path', async () => {
            expect(resolveBusAddress('org.example.App', 'Host-1')).toStrictEqual({
                busName: 'org.example.App.host1',
                objectPath: '/org/example/App/host1/devtools',
                instance: 'host1',
            });
        });
    });

    await describe('isDevtoolsEnabledValue', async () => {
        await it('treats unset, empty, 0 and false as OFF', async () => {
            expect(isDevtoolsEnabledValue(null)).toBe(false);
            expect(isDevtoolsEnabledValue(undefined)).toBe(false);
            expect(isDevtoolsEnabledValue('')).toBe(false);
            expect(isDevtoolsEnabledValue('0')).toBe(false);
            expect(isDevtoolsEnabledValue('False')).toBe(false);
        });

        await it('treats any other value as ON', async () => {
            expect(isDevtoolsEnabledValue('1')).toBe(true);
            expect(isDevtoolsEnabledValue('yes')).toBe(true);
        });
    });

    await describe('devtoolsAddressFilePath', async () => {
        await it('derives the file name from the same bus name as resolveBusAddress', async () => {
            expect(devtoolsAddressFilePath('/run/user/1000', 'org.example.App')).toBe(
                '/run/user/1000/gjsify-devtools/org.example.App.address',
            );
            // The instance label must route the peer transport exactly like it
            // routes the bus name — otherwise the app writes one file and the
            // bridge reads another.
            const labelled = devtoolsAddressFilePath('/run/user/1000', 'org.example.App', 'Host-1');
            expect(labelled).toBe('/run/user/1000/gjsify-devtools/org.example.App.host1.address');
            expect(labelled).toContain(resolveBusAddress('org.example.App', 'Host-1').busName);
        });
    });

    await describe('env contract', async () => {
        await it('names the address variable both sides read', async () => {
            expect(DEVTOOLS_ADDRESS_ENV).toBe('GJSIFY_DEVTOOLS_ADDRESS');
        });
    });
};
