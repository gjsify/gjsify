// The Linux reader against a REAL D-Bus conversation, on GJS.
//
// A fake `org.freedesktop.portal.Settings` is exported on a peer-to-peer
// `Gio.DBusServer`, so the reader's GVariant marshalling, its `ReadAll`
// unpacking and its `SettingChanged` subscription all run for real — with no
// session bus and no portal installed, which is also the shape of CI.
// GSettings is replaced by a fake `GnomeSettingsLike`: a real one would need the
// GNOME schema installed and would read the developer's own desktop.

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import { describe, expect, it } from '@gjsify/unit';
import type { DesktopAppearance } from '@gjsify/adwaita-core';

import type { GnomeSettingsLike, GnomeSettingsSource } from './gnome-settings.js';
import { PORTAL_OBJECT_PATH, PORTAL_SETTINGS_INTERFACE, type PortalEndpoint } from './portal.js';
import { readDesktopAppearance, watchDesktopAppearance } from './reader.js';

const PORTAL_XML = `<node><interface name="${PORTAL_SETTINGS_INTERFACE}">
  <method name="ReadAll"><arg type="as" direction="in"/><arg type="a{sa{sv}}" direction="out"/></method>
  <signal name="SettingChanged"><arg type="s"/><arg type="s"/><arg type="v"/></signal>
</interface></node>`;

/** The values the fake portal serves, mutable so a test can change the desktop. */
interface FakeDesktop {
    accent?: [number, number, number];
    scheme?: number;
}

interface FakePortal {
    readonly endpoint: PortalEndpoint;
    readonly calls: string[][];
    /** Change the desktop and emit `SettingChanged`, as a real portal does. */
    change(next: FakeDesktop): void;
    close(): void;
}

function portalValues(desktop: FakeDesktop): Record<string, GLib.Variant> {
    const values: Record<string, GLib.Variant> = {};
    if (desktop.accent) values['accent-color'] = new GLib.Variant('(ddd)', desktop.accent);
    if (desktop.scheme !== undefined) values['color-scheme'] = new GLib.Variant('u', desktop.scheme);
    return values;
}

/** Export the fake portal on a peer server and dial it — async, or the export deadlocks against the dial. */
async function startFakePortal(initial: FakeDesktop): Promise<FakePortal> {
    let desktop = initial;
    const calls: string[][] = [];
    const server = Gio.DBusServer.new_sync(
        `unix:tmpdir=${GLib.get_tmp_dir()}`,
        Gio.DBusServerFlags.AUTHENTICATION_REQUIRE_SAME_USER,
        Gio.dbus_generate_guid(),
        null,
        null,
    );
    const exported = Gio.DBusExportedObject.wrapJSObject(PORTAL_XML, {
        ReadAll(namespaces: string[]) {
            calls.push(namespaces);
            return { 'org.freedesktop.appearance': portalValues(desktop) };
        },
    });
    // The export happens when the client dials, which may still be pending when a test
    // closes the portal straight away; unexporting a never-exported object is a GLib CRITICAL.
    let isExported = false;
    server.connect('new-connection', (_server, connection) => {
        exported.export(connection, PORTAL_OBJECT_PATH);
        isExported = true;
        return true;
    });
    server.start();

    const client = await new Promise<Gio.DBusConnection>((resolve, reject) => {
        Gio.DBusConnection.new_for_address(
            server.get_client_address(),
            Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT,
            null,
            null,
            (_source, result) => {
                try {
                    resolve(Gio.DBusConnection.new_for_address_finish(result));
                } catch (error) {
                    reject(error as Error);
                }
            },
        );
    });

    return {
        endpoint: { connection: client, busName: null },
        calls,
        change(next) {
            desktop = next;
            // The value is ignored by the reader, which re-reads; a real portal sends the new one.
            exported.emit_signal(
                'SettingChanged',
                new GLib.Variant('(ssv)', ['org.freedesktop.appearance', 'accent-color', new GLib.Variant('b', true)]),
            );
        },
        close() {
            if (isExported) exported.unexport();
            client.close_sync(null);
            server.stop();
        },
    };
}

function fakeGnomeSettings(
    values: Record<string, string>,
): GnomeSettingsSource & { set(key: string, value: string): void } {
    const handlers = new Map<number, { signal: string; callback: () => void }>();
    let next = 1;
    const settings: GnomeSettingsLike = {
        get_string: (key) => values[key] ?? '',
        connect(signal, callback) {
            handlers.set(next, { signal, callback });
            return next++;
        },
        disconnect: (id) => void handlers.delete(id),
    };
    return {
        settings,
        keys: ['accent-color', 'color-scheme'],
        set(key, value) {
            values[key] = value;
            for (const handler of handlers.values()) if (handler.signal === `changed::${key}`) handler.callback();
        },
    };
}

/** Resolve with the n-th report of a watcher, or reject after `timeoutMs` of main-loop time. */
function nthReport(reports: DesktopAppearance[], n: number, timeoutMs = 5000): Promise<DesktopAppearance> {
    return new Promise((resolve, reject) => {
        const started = GLib.get_monotonic_time();
        const poll = () => {
            if (reports.length >= n) return resolve(reports[n - 1]);
            if ((GLib.get_monotonic_time() - started) / 1000 > timeoutMs) {
                return reject(new Error(`expected ${n} reports, got ${reports.length}`));
            }
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
                poll();
                return GLib.SOURCE_REMOVE;
            });
        };
        poll();
    });
}

export default async () => {
    await describe('readDesktopAppearance on Linux (portal over real D-Bus)', async () => {
        await it('asks ReadAll for the appearance namespace and snaps the accent', async () => {
            const portal = await startFakePortal({ accent: [0x91 / 255, 0x41 / 255, 0xac / 255], scheme: 1 });
            const appearance = await readDesktopAppearance({
                platform: 'linux',
                portal: portal.endpoint,
                gnomeSettings: null,
            });
            expect(appearance).toStrictEqual({ accent: 'purple', accentRgb: '#9141ac', colorScheme: 'dark' });
            expect(portal.calls).toStrictEqual([['org.freedesktop.appearance']]);
            portal.close();
        });

        await it('lets GSettings fill what the portal does not provide', async () => {
            // A portal backend with a scheme but no accent (xdg-desktop-portal-gtk on an older GNOME).
            const portal = await startFakePortal({ scheme: 2 });
            const settings = fakeGnomeSettings({ 'accent-color': 'teal', 'color-scheme': 'prefer-dark' });
            const appearance = await readDesktopAppearance({
                platform: 'linux',
                portal: portal.endpoint,
                gnomeSettings: settings,
            });
            expect(appearance).toStrictEqual({ accent: 'teal', colorScheme: 'light' });
            portal.close();
        });

        await it('falls back to GSettings when no portal answers, without throwing', async () => {
            const portal = await startFakePortal({});
            portal.close();
            const settings = fakeGnomeSettings({ 'accent-color': 'green', 'color-scheme': 'default' });
            const appearance = await readDesktopAppearance({
                platform: 'linux',
                portal: portal.endpoint,
                gnomeSettings: settings,
            });
            expect(appearance).toStrictEqual({ accent: 'green', colorScheme: 'no-preference' });
        });

        await it('answers {} when there is no source at all', async () => {
            expect(await readDesktopAppearance({ platform: 'linux', portal: null, gnomeSettings: null })).toStrictEqual(
                {},
            );
        });
    });

    await describe('watchDesktopAppearance on Linux', async () => {
        await it('reports the start value, then each SettingChanged, and nothing after stop', async () => {
            const portal = await startFakePortal({ accent: [0x35 / 255, 0x84 / 255, 0xe4 / 255], scheme: 0 });
            const reports: DesktopAppearance[] = [];
            const stop = watchDesktopAppearance((appearance) => reports.push(appearance), {
                platform: 'linux',
                portal: portal.endpoint,
                gnomeSettings: null,
            });
            expect((await nthReport(reports, 1)).accent).toBe('blue');

            portal.change({ accent: [0xe6 / 255, 0x2d / 255, 0x42 / 255], scheme: 1 });
            expect(await nthReport(reports, 2)).toStrictEqual({
                accent: 'red',
                accentRgb: '#e62d42',
                colorScheme: 'dark',
            });

            stop();
            portal.change({ accent: [0x3a / 255, 0x94 / 255, 0x4a / 255], scheme: 1 });
            // Give a stray report every chance to arrive before asserting it did not.
            await new Promise<void>((resolve) =>
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => (resolve(), GLib.SOURCE_REMOVE)),
            );
            expect(reports.length).toBe(2);
            portal.close();
        });

        await it('follows a GSettings change and drops a duplicate', async () => {
            const settings = fakeGnomeSettings({ 'accent-color': 'slate', 'color-scheme': 'default' });
            const reports: DesktopAppearance[] = [];
            const stop = watchDesktopAppearance((appearance) => reports.push(appearance), {
                platform: 'linux',
                portal: null,
                gnomeSettings: settings,
            });
            await nthReport(reports, 1);
            settings.set('accent-color', 'slate');
            settings.set('accent-color', 'pink');
            expect((await nthReport(reports, 2)).accent).toBe('pink');
            expect(reports.length).toBe(2);
            stop();
        });
    });
};
