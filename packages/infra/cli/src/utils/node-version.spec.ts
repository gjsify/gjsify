// SPDX-License-Identifier: MIT
// Unit tests for the native-backend Node-version preflight.

import { describe, it, expect } from '@gjsify/unit';
import { MIN_NODE_MAJOR, parseNodeMajor, nativeBackendNodeError } from './node-version.js';

export default async () => {
    await describe('node-version preflight', async () => {
        await it('parses the major from a version string', () => {
            expect(parseNodeMajor('24.18.0')).toBe(24);
            expect(parseNodeMajor('22.22.2')).toBe(22);
            expect(parseNodeMajor('20.0.0')).toBe(20);
        });

        await it('errors on real Node below the minimum', () => {
            const msg = nativeBackendNodeError('22.22.2', true);
            expect(typeof msg).toBe('string');
            expect(msg).toContain(String(MIN_NODE_MAJOR));
            expect(msg).toContain('22.22.2');
            expect(msg).toContain('--backend npm');
        });

        await it('passes on a supported Node major', () => {
            expect(nativeBackendNodeError(`${MIN_NODE_MAJOR}.0.0`, true)).toBe(null);
            expect(nativeBackendNodeError('24.18.0', true)).toBe(null);
            expect(nativeBackendNodeError('25.1.0', true)).toBe(null);
        });

        await it('never blocks under GJS (onRealNode=false), even on the faked old node', () => {
            // @gjsify/process fakes process.versions.node = '20.0.0' under GJS — must NOT trip.
            expect(nativeBackendNodeError('20.0.0', false)).toBe(null);
        });

        await it('does not block on an unparseable version', () => {
            expect(nativeBackendNodeError('weird', true)).toBe(null);
        });
    });
};
