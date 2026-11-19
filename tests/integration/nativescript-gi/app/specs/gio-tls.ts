// ADR 0117 stage 2, TLS half, ON THE DEVICE: does `@gjsify/gi-runtime-android-tls` give Gio a
// working TLS backend, and does it trust what Android trusts?
//
// Three statements, each one a case:
//  1. a loopback handshake against a throwaway test CA succeeds (the backend works at all);
//  2. a public host verifies through the default database node-gi installed from
//     /system/etc/security/cacerts (ADR 0134 § 3);
//  3. the test leaf is REJECTED against that default database, and so is a self-signed public
//     host — a trust store that accepts everything would pass 1 and 2.
//
// Cases 2 and the public half of 3 are NETWORK-DEPENDENT. Only built in when the app depends on
// the add-on (`GJSIFY_GI_TLS=1`, see ../../vite.config.ts).
import { knownFolders } from '@nativescript/core';

import { describe, expect, info, it } from '../reporter.js';
import { requireGi } from '../opt-in.js';
import { TEST_CA_PEM, loopbackHandshake, publicHandshake, rejection } from './gio-tls.core.js';

export default async function gioTlsSpec(): Promise<void> {
    await describe('Gio TLS through @gjsify/gi-runtime-android-tls', async () => {
        // biome-ignore lint/suspicious/noExplicitAny: GI proxies
        const Gio = requireGi('Gio', '2.0') as any;
        // biome-ignore lint/suspicious/noExplicitAny: GI proxies
        const GLib = requireGi('GLib', '2.0') as any;
        const setup = (globalThis as { __NODE_GI_ANDROID_TLS?: unknown }).__NODE_GI_ANDROID_TLS;
        info(`setup: ${JSON.stringify(setup)}`);

        await it('the backend supports TLS and node-gi installed the system trust', () => {
            expect(Gio.TlsBackend.get_default().supports_tls()).toBe(true);
            const trust = (setup as { trust?: { count?: number } } | undefined)?.trust;
            expect((trust?.count ?? 0) > 50).toBe(true);
        });

        const caFile = `${knownFolders.temp().path}/gjsify-test-ca.pem`;
        GLib.file_set_contents(caFile, new TextEncoder().encode(TEST_CA_PEM));
        const testDb = Gio.TlsFileDatabase.new(caFile);
        const systemDb = Gio.TlsBackend.get_default().get_default_database();

        await it('loopback handshake against the test CA', async () => {
            // The first handshake pays for OpenSSL's lazy init; the second is the steady state.
            const cold = await loopbackHandshake(Gio, GLib, testDb);
            const warm = await loopbackHandshake(Gio, GLib, testDb);
            info(
                `loopback handshake: cold ${cold.ms.toFixed(1)} ms, warm ${warm.ms.toFixed(1)} ms, protocol ${warm.protocol}`,
            );
            expect(warm.echoed).toBe('ping');
        });

        await it('REJECTS the test leaf against the system trust', async () => {
            const reason = await rejection(() => loopbackHandshake(Gio, GLib, systemDb));
            info(`untrusted loopback: ${reason}`);
            expect(reason === null).toBe(false);
        });

        await it('verifies a public host through the system trust', async () => {
            const result = await publicHandshake(Gio, GLib, 'example.com');
            info(`example.com: connect+handshake ${result.ms.toFixed(1)} ms, issuer ${result.issuer}`);
            expect(result.ms > 0).toBe(true);
        });

        await it('REJECTS a self-signed public host', async () => {
            const reason = await rejection(() => publicHandshake(Gio, GLib, 'self-signed.badssl.com'));
            info(`self-signed: ${reason}`);
            expect(reason === null).toBe(false);
        });
    });
}
