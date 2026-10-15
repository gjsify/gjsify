// @gjsify/adwaita-app — `WindowCommon` is a true subset of `Gtk.Window` (ADR 0098 Amendment 4).
// The proof is the type check: `@girs/gtk-4.0`'s windows are assigned to it, and `gjsify tsc`
// fails here when the subset names a member GTK does not have, or types one differently.
// The ports prove their own windows in their own packages.

import type Adw from 'gi://Adw?version=1';
import type Gtk from 'gi://Gtk?version=4.0';
import type { WindowCommon } from '@gjsify/adwaita-core';
import { describe, expect, it } from '@gjsify/unit';

type IsWindowCommon<T> = [T] extends [WindowCommon<Gtk.Widget>] ? true : false;

const GIRS_WINDOWS_ARE_COMMON: [
    IsWindowCommon<Gtk.Window>,
    IsWindowCommon<Gtk.ApplicationWindow>,
    IsWindowCommon<Adw.Window>,
    IsWindowCommon<Adw.ApplicationWindow>,
] = [true, true, true, true];

export default async () => {
    await describe('WindowCommon', async () => {
        await it('is satisfied by the @girs/gtk-4.0 and @girs/adw-1 windows', () => {
            expect(GIRS_WINDOWS_ARE_COMMON.every(Boolean)).toBe(true);
        });
    });
};
