// @gjsify/adwaita-app — confirm-dialog model tests.
// Runs on GJS + Node (pure helper, no platform imports).

import { describe, expect, it } from '@gjsify/unit';
import { resolveDefaultResponse } from './dialog-model.js';

export default async () => {
    await describe('resolveDefaultResponse', async () => {
        await it('keeps confirm as the default when unset', () => {
            expect(resolveDefaultResponse()).toBe('confirm');
            expect(resolveDefaultResponse(undefined)).toBe('confirm');
        });

        await it('makes the requested response the default', () => {
            expect(resolveDefaultResponse('cancel')).toBe('cancel');
            expect(resolveDefaultResponse('confirm')).toBe('confirm');
        });

        await it('rejects a response the dialog does not have', () => {
            // Adw would take 'delete' and silently leave the dialog without a
            // default widget, so an unknown id has to fail loudly here instead.
            expect(() => resolveDefaultResponse('delete')).toThrow(TypeError);
            expect(() => resolveDefaultResponse('delete')).toThrow('delete');
            expect(() => resolveDefaultResponse('')).toThrow(TypeError);
        });
    });
};
