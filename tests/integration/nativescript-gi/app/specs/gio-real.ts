// `giReal` ON THE DEVICE: with the widget renderer on (`giRenderer`), a NON-widget module that
// imports `gi://Gio` must get the real namespace, not the renderer's sparse arm. The probe is
// `Gio.SocketClient`, which the arm lacks, driven over a loopback `Gio.SocketListener`.
import { describe, expect, it } from '../reporter.js';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

// biome-ignore lint/suspicious/noExplicitAny: GI proxies
type Gi = any;

function gioAsync<T>(
    start: (cb: (source: unknown, result: unknown) => void) => void,
    finish: (r: unknown) => T,
): Promise<T> {
    return new Promise((resolve, reject) => {
        start((_s, result) => {
            try {
                resolve(finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
}

export default async function gioRealSpec(): Promise<void> {
    const G = Gio as Gi;
    await describe('giReal: real Gio beside the widget renderer', async () => {
        await it('gi://Gio from a non-widget module has SocketClient', () => {
            expect(typeof G.SocketClient).toBe('function');
            expect(typeof (GLib as Gi).get_home_dir).toBe('function');
        });

        await it('a real SocketClient round-trips over a loopback SocketListener', async () => {
            const listener = new G.SocketListener();
            const port: number = listener.add_any_inet_port(null);
            const server = gioAsync(
                (cb) => listener.accept_async(null, cb),
                (r) => {
                    const out = listener.accept_finish(r);
                    return Array.isArray(out) ? out[0] : out;
                },
            ).then(async (conn: Gi) => {
                const bytes: Gi = await gioAsync(
                    (cb) => conn.get_input_stream().read_bytes_async(4, GLib.PRIORITY_DEFAULT, null, cb),
                    (r) => conn.get_input_stream().read_bytes_finish(r),
                );
                return new TextDecoder().decode(bytes.toArray ? bytes.toArray() : bytes.get_data());
            });
            try {
                const client = new G.SocketClient();
                const conn: Gi = await gioAsync(
                    (cb) => client.connect_to_host_async('127.0.0.1', port, null, cb),
                    (r) => client.connect_to_host_finish(r),
                );
                conn.get_output_stream().write_all(new TextEncoder().encode('ping'), null);
                expect(await server).toBe('ping');
                conn.close(null);
            } finally {
                listener.close();
            }
        });
    });
}
