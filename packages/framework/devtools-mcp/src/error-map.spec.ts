// @gjsify/devtools-mcp — dbusError classification tests.
// Cross-platform (pure string logic): runs identically on Node and GJS.

import { describe, expect, it } from '@gjsify/unit';
import { dbusError } from './error-map.js';

const resolved = { busName: 'org.example.App', instance: 'default' };

function text(result: { content: Array<{ type: string; text?: string }> }): string {
    const block = result.content[0];
    return block.type === 'text' ? (block.text ?? '') : '';
}

export default async () => {
    await describe('dbusError', async () => {
        await it('detects a not-running app from a ServiceUnknown error', async () => {
            const r = dbusError(new Error('GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown: ...'), resolved);
            expect(r.isError).toBe(true);
            expect(text(r)).toContain('No devtools-enabled app');
            expect(text(r)).toContain('org.example.App');
        });

        await it('surfaces a typed devtools rejection from a GDBus remote error', async () => {
            const r = dbusError(
                new Error(
                    'GDBus.Error:org.gtk.GDBus.UnmappedGError.Quark._foo.Code1: paused: external control is paused',
                ),
                resolved,
            );
            expect(r.isError).toBe(true);
            expect(text(r)).toBe('paused: external control is paused');
        });

        await it('falls back for an unrecognised error', async () => {
            const r = dbusError(new Error('some random failure'), resolved);
            expect(r.isError).toBe(true);
            expect(text(r)).toContain('D-Bus call failed');
        });
    });
};
