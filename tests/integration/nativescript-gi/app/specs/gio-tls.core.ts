// The Gio TLS cases of `gio-tls.ts`, kept free of imports so the same code runs against
// node-gi on the host (`node gio-tls.core.ts`, type stripping) before it runs on a device.
//
// The fixture is a throwaway test CA and a `localhost` / `127.0.0.1` leaf it signed, valid until
// 2126. They exist for this file only: nothing trusts the CA except the one client below that is
// handed it on purpose.

export const TEST_CA_PEM = `-----BEGIN CERTIFICATE-----
MIIBdzCCAR6gAwIBAgIUeH9NVRmG3TvhsW6x2+kQGQjH0UcwCgYIKoZIzj0EAwIw
GTEXMBUGA1UEAwwOZ2pzaWZ5IHRlc3QgQ0EwIBcNMjYxMTE5MDkzNjEzWhgPMjEy
NjEwMjYwOTM2MTNaMBkxFzAVBgNVBAMMDmdqc2lmeSB0ZXN0IENBMFkwEwYHKoZI
zj0CAQYIKoZIzj0DAQcDQgAEHTgEE9z+9I+56OPRk0Pod2cnahsR/wTvYZCgh1dD
DhKE1vlB+lXxD/O57L4YClW4lq74BN6g1QF6oCuPpzbx26NCMEAwHQYDVR0OBBYE
FGy/jJ36Dkgm4WXRmEIOFtFqJYMvMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/
BAQDAgIEMAoGCCqGSM49BAMCA0cAMEQCIEdhRhVASEKMmAiEGGD+7g+jJw6QfT5i
lBQrDkZs+1S+AiBz3d6+YrWV20nAt76dT0tdOs0UwmRkz6Y6tTjRHyoSPQ==
-----END CERTIFICATE-----
`;

export const TEST_LEAF_PEM = `-----BEGIN CERTIFICATE-----
MIIBcDCCARWgAwIBAgIUH82gIt//T56jKXggnGIrB7TrGDEwCgYIKoZIzj0EAwIw
GTEXMBUGA1UEAwwOZ2pzaWZ5IHRlc3QgQ0EwIBcNMjYxMTE5MDkzNjEzWhgPMjEy
NjEwMjYwOTM2MTNaMBQxEjAQBgNVBAMMCWxvY2FsaG9zdDBZMBMGByqGSM49AgEG
CCqGSM49AwEHA0IABAJOYPWGQnxbeA9EK42PNcYJfiTAQtSz/AHHcVfumUy4D+as
6DDyP6+Y3wgkbTgVotr52yo+l7nyu00j1CxsoLyjPjA8MBoGA1UdEQQTMBGCCWxv
Y2FsaG9zdIcEfwAAATAJBgNVHRMEAjAAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMAoG
CCqGSM49BAMCA0kAMEYCIQCJKs0oFBuGhlooiFTs/EKVw7AHicXILUpVYIdlCY0M
xAIhAIHkt+qIG9k9hjGffVRAUxvBbx/0Pi5JrTN5D+6sAf1C
-----END CERTIFICATE-----
-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgPcpN2BfLcwX9DnpW
MjOyJMhspockPILQ6GPdN5yqYDihRANCAAQCTmD1hkJ8W3gPRCuNjzXGCX4kwELU
s/wBx3FX7plMuA/mrOgw8j+vmN8IJG04FaLa+dsqPpe58rtNI9QsbKC8
-----END PRIVATE KEY-----
`;

// node-gi hands GObjects back as untyped proxies; the cases only touch the methods named here.
// biome-ignore lint/suspicious/noExplicitAny: a GI proxy surface, typed by the calls below
type Gi = any;

/** One GIO `*_async` / `*_finish` pair as a promise. */
export function gioAsync<T>(
    start: (callback: (source: unknown, result: unknown) => void) => void,
    finish: (result: unknown) => T,
): Promise<T> {
    return new Promise((resolve, reject) => {
        start((_source, result) => {
            try {
                resolve(finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
}

const first = <T>(value: T | [T, ...unknown[]]): T => (Array.isArray(value) ? value[0] : value);

export interface HandshakeResult {
    ms: number;
    echoed: string;
    protocol: string;
}

/**
 * A TLS server and client in one process over 127.0.0.1. The server presents the test leaf; the
 * client verifies it against `database` (the test CA, or the default database for the negative
 * case). Resolves with the client handshake time and the bytes the server read back.
 */
export async function loopbackHandshake(Gio: Gi, GLib: Gi, database: Gi): Promise<HandshakeResult> {
    const listener = new Gio.SocketListener();
    const port: number = listener.add_any_inet_port(null);
    const certificate = Gio.TlsCertificate.new_from_pem(TEST_LEAF_PEM, -1);
    const server = gioAsync(
        (cb) => listener.accept_async(null, cb),
        (result) => first(listener.accept_finish(result)),
    ).then(async (raw: Gi) => {
        const tls = Gio.TlsServerConnection.new(raw, certificate);
        await gioAsync(
            (cb) => tls.handshake_async(GLib.PRIORITY_DEFAULT, null, cb),
            (result) => tls.handshake_finish(result),
        );
        // Async, never read_bytes: a blocking read would hold the app's one JS thread, and in
        // the rejection case the client's failing callback could then never run (seen on the
        // emulator as a run that stopped after the loopback case).
        const bytes: Gi = await gioAsync(
            (cb) => tls.get_input_stream().read_bytes_async(4, GLib.PRIORITY_DEFAULT, null, cb),
            (result) => tls.get_input_stream().read_bytes_finish(result),
        );
        return new TextDecoder().decode(bytes.toArray ? bytes.toArray() : bytes.get_data());
    });
    // A client-side failure leaves the server waiting on a handshake that never completes; the
    // server promise is only awaited on success, and the listener is closed either way.
    server.catch(() => {});
    try {
        const client = new Gio.SocketClient();
        const raw = await gioAsync(
            (cb) => client.connect_to_host_async('127.0.0.1', port, null, cb),
            (result) => client.connect_to_host_finish(result),
        );
        const tls = Gio.TlsClientConnection.new(raw, Gio.NetworkAddress.new('localhost', port));
        tls.set_database(database);
        const started = GLib.get_monotonic_time();
        try {
            await gioAsync(
                (cb) => tls.handshake_async(GLib.PRIORITY_DEFAULT, null, cb),
                (result) => tls.handshake_finish(result),
            );
        } catch (error) {
            // Close the socket so the server side ends with an error instead of waiting.
            raw.close(null);
            throw error;
        }
        const ms = (GLib.get_monotonic_time() - started) / 1000;
        tls.get_output_stream().write_all(new TextEncoder().encode('ping'), null);
        const echoed = await server;
        const protocol = String(tls.get_protocol_version?.() ?? '?');
        tls.close(null);
        return { ms, echoed, protocol };
    } finally {
        listener.close();
    }
}

export interface PublicResult {
    ms: number;
    issuer: string;
}

/** `host:443` through `GSocketClient` with TLS on, verified against Gio's default database. */
export async function publicHandshake(Gio: Gi, GLib: Gi, host: string): Promise<PublicResult> {
    const client = new Gio.SocketClient();
    client.set_tls(true);
    const started = GLib.get_monotonic_time();
    const connection = await gioAsync(
        (cb) => client.connect_to_host_async(host, 443, null, cb),
        (result) => client.connect_to_host_finish(result),
    );
    const ms = (GLib.get_monotonic_time() - started) / 1000;
    const tls = connection.get_base_io_stream ? connection.get_base_io_stream() : connection;
    const issuer = String(tls.get_peer_certificate?.()?.get_issuer_name?.() ?? '?');
    connection.close(null);
    return { ms, issuer };
}

/** The error a handshake ended with, or null when it succeeded. */
export async function rejection(run: () => Promise<unknown>): Promise<string | null> {
    try {
        await run();
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}
