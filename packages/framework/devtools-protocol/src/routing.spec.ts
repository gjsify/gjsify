// @gjsify/devtools-protocol — instance routing tests.
// Cross-platform (pure TS): runs identically on Node and GJS.

import { describe, expect, it } from '@gjsify/unit';
import { resolveBusAddress, sanitizeInstanceId } from './routing.js';

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
};
