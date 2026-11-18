// @gjsify/adwaita-app — runApplication inside a main loop that is already running.
// GJS-only (`test.gtk.mts`): the subject is a real `Gio.Application`; no display is involved.
// The test body is itself dispatched by the running loop, which is exactly the shape of a CLI
// that iterates its own `GLib.MainLoop` and starts the GUI from a subcommand.

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import { describe, expect, it } from '@gjsify/unit';

import { runApplication } from './application.js';

export default async () => {
    await describe('runApplication under a running MainLoop', async () => {
        await it('emits activate and resolves with the exit code, like a bare script', async () => {
            const app = new Gio.Application({
                application_id: 'org.gjsify.test.RunApplicationUnderLoop',
                flags: Gio.ApplicationFlags.DEFAULT_FLAGS,
            });
            let activated = false;
            app.connect('activate', () => {
                activated = true;
                app.hold();
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
                    app.release();
                    return GLib.SOURCE_REMOVE;
                });
            });

            const started = new Promise<number>((resolve, reject) => {
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    runApplication(app, ['test']).then(resolve, reject);
                    return GLib.SOURCE_REMOVE;
                });
            });
            // Unfixed, `activate` never comes and `started` never settles; the guard keeps that a failure.
            const guard = new Promise<null>((resolve) => {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
                    resolve(null);
                    return GLib.SOURCE_REMOVE;
                });
            });
            const code = await Promise.race([started, guard]);

            expect(activated).toBe(true);
            expect(code).toBe(0);
        });
    });
};
