// The driver against libportal's own client code, served by a fake Background portal.
import { describe, expect, it } from '@gjsify/unit';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import { autostartFilePath } from './autostart-file.js';
import {
    realHost,
    requestBackground,
    setBackgroundStatus,
    probeBackgroundPortal,
    type BackgroundHost,
} from './background.js';
import { AUTOSTART_FLAG } from './wish.js';
import { startFakePortal } from './fake-portal.js';

const APP = 'org.example.App';
const CMD = ['/usr/bin/app'];

function hostIn(dir: string): BackgroundHost {
    return { ...realHost, configDir: () => dir };
}
const exists = (dir: string) => Gio.File.new_for_path(autostartFilePath(dir, APP)).query_exists(null);

async function rejection(promise: Promise<unknown>): Promise<GLib.Error | undefined> {
    try {
        await promise;
    } catch (error) {
        return error as GLib.Error;
    }
    return undefined;
}

/**
 * Whether libportal's typelib is installed. Imported dynamically HERE: the driver itself loads it
 * lazily, and a static import would stop the whole suite on a host without it.
 */
async function hasLibportal(): Promise<boolean> {
    try {
        await import('gi://Xdp?version=1.0');
        return true;
    } catch {
        return false;
    }
}

export default async () => {
    const fake = await startFakePortal();
    const libportal = await hasLibportal();
    // These cases go through libportal's client code. A host without the typelib falls back to the
    // file instead, so they fail by design; the marker retires the day the image gains it.
    const portalIt = (name: string, test: () => Promise<void>) =>
        it.failing(name, test, 'the libportal typelib is not installed on this host', { when: !libportal });

    await describe('Background portal conformance (fake portal)', async () => {
        await it('probes a served portal as present', async () => {
            fake.setPresent(true);
            expect(await probeBackgroundPortal(realHost)).toBe('present');
        });
        await portalIt('granted: the portal answers background and autostart true', async () => {
            fake.setPresent(true);
            fake.answerWith({ response: 0, background: true, autostart: true });
            const dir = GLib.dir_make_tmp('xdp-portal-XXXXXX');
            const outcome = await requestBackground(
                { appId: APP, reason: 'because', commandline: CMD, flags: AUTOSTART_FLAG },
                hostIn(dir),
            );
            expect(outcome).toBe('granted');
            expect(exists(dir)).toBe(false);
            const call = fake.calls[fake.calls.length - 1];
            expect(call.reason).toBe('because');
            expect(call.autostart).toBe(true);
            expect(call.commandline?.[0]).toBe('/usr/bin/app');
        });
        await portalIt('denied: the person answered no', async () => {
            fake.setPresent(true);
            fake.answerWith({ response: 0, background: false, autostart: false });
            const outcome = await requestBackground({ appId: APP, commandline: CMD, flags: 1 }, hostIn('/nonexistent'));
            expect(outcome).toBe('denied');
        });
        await portalIt('cancelled: rejects with Gio.IOErrorEnum.CANCELLED', async () => {
            fake.setPresent(true);
            fake.answerWith({ response: 1 });
            const error = await rejection(
                requestBackground({ appId: APP, commandline: CMD, flags: 1 }, hostIn('/nonexistent')),
            );
            expect(error?.matches(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED)).toBe(true);
        });
        await portalIt('a broken portal throws and does NOT fall through to the file', async () => {
            fake.setPresent(true);
            fake.answerWith({ response: 0, fail: true });
            const dir = GLib.dir_make_tmp('xdp-portal-XXXXXX');
            const error = await rejection(requestBackground({ appId: APP, commandline: CMD, flags: 1 }, hostIn(dir)));
            expect(error !== undefined).toBe(true);
            expect(exists(dir)).toBe(false);
        });
        await portalIt('set_background_status reaches the portal', async () => {
            fake.setPresent(true);
            await setBackgroundStatus('syncing');
            expect(fake.statuses[fake.statuses.length - 1]).toBe('syncing');
        });
        await it('absent portal: probes absent and falls through to the file, whole-wish', async () => {
            fake.setPresent(false);
            expect(await probeBackgroundPortal(realHost)).toBe('absent');
            const dir = GLib.dir_make_tmp('xdp-portal-XXXXXX');
            const host = hostIn(dir);
            expect(await requestBackground({ appId: APP, commandline: CMD, flags: 1 }, host)).toBe('granted');
            expect(exists(dir)).toBe(true);
            expect(await requestBackground({ appId: APP, commandline: CMD, flags: 0 }, host)).toBe('granted');
            expect(exists(dir)).toBe(false);
        });
        await it('absent portal: set_background_status completes', async () => {
            fake.setPresent(false);
            await setBackgroundStatus('x');
        });
        await it('absent portal without a command line throws INVALID_ARGUMENT', async () => {
            fake.setPresent(false);
            const error = await rejection(
                requestBackground({ appId: APP, flags: 1 }, hostIn(GLib.dir_make_tmp('xdp-portal-XXXXXX'))),
            );
            expect(error?.matches(Gio.io_error_quark(), Gio.IOErrorEnum.INVALID_ARGUMENT)).toBe(true);
        });
        await it('an unreachable session bus reads as absent', async () => {
            const host = { sessionBus: () => Promise.reject(new Error('no bus')) };
            expect(await probeBackgroundPortal(host)).toBe('absent');
        });
        await it('a missing typelib reads as no portal (stand-in host)', async () => {
            fake.setPresent(true);
            const dir = GLib.dir_make_tmp('xdp-portal-XXXXXX');
            const host: BackgroundHost = { ...hostIn(dir), loadPortal: async () => null };
            expect(await requestBackground({ appId: APP, commandline: CMD, flags: 1 }, host)).toBe('granted');
            expect(exists(dir)).toBe(true);
        });
    });
};
