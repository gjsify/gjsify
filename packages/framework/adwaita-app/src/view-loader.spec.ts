// @gjsify/adwaita-app — LoadToken tests.
// Runs on GJS + Node: LoadToken is pure (the Gtk.Stack side of loadIntoStack is
// exercised only in a real app).

import { describe, expect, it } from '@gjsify/unit';
import { LoadToken } from './view-loader.js';

export default async () => {
    await describe('LoadToken', async () => {
        await it('starts at 0 before the first load', () => {
            expect(new LoadToken().current).toBe(0);
        });

        await it('increments monotonically on next()', () => {
            const token = new LoadToken();
            expect(token.next()).toBe(1);
            expect(token.next()).toBe(2);
            expect(token.current).toBe(2);
        });

        await it('lets a later load supersede an earlier ticket', () => {
            const token = new LoadToken();
            const first = token.next();
            const second = token.next();
            // The stale-guard check `ticket !== token.current`:
            expect(first !== token.current).toBe(true); // first is superseded
            expect(second !== token.current).toBe(false); // second is current
        });
    });
};
