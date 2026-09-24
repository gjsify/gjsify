import type Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';

/**
 * Teardown of a listening `Gio.SocketService`, shared by every server that owns
 * one (`@gjsify/net`, `@gjsify/http2`) so the ordering below lives in ONE place.
 *
 * `stop()` only CANCELS the pending accept; its GSource keeps polling the
 * listening descriptor until that cancellation is dispatched on the next
 * main-loop iteration. Closing the listener synchronously leaves that source on
 * a closed fd: harmless on Linux (poll(2) reports POLLNVAL for the one entry),
 * but GLib on darwin polls via select(2), which fails the WHOLE iteration with
 * EBADF and warns "poll(2) failed due to: Bad file descriptor".
 *
 * So the close runs from a 0 ms source at the SAME priority as the accept's:
 * GLib dispatches a priority band in attach order, and the accept source was
 * attached first (at start(), or when the service re-armed after the last
 * accept) — by the time the close runs, the cancellation has been dispatched and
 * its source destroyed. Not an idle: a lower-priority source is starved for as
 * long as anything at DEFAULT stays ready (GJS's promise-drain source does,
 * under a busy chain).
 */
interface PendingClose {
    ports: readonly number[];
    onClosed?: () => void;
}

const pending = new Map<Gio.SocketService, PendingClose>();

function finishClose(service: Gio.SocketService): void {
    const entry = pending.get(service);
    if (!entry) return;
    pending.delete(service);
    try {
        service.close();
    } finally {
        entry.onClosed?.();
    }
}

/**
 * Stop accepting on `service` and close its listening sockets once no Gio source
 * polls them any more. `ports` are the ports it is bound to (see
 * {@link releaseListenPort}); `onClosed` runs right after the descriptors close.
 */
export function closeSocketService(service: Gio.SocketService, ports: readonly number[], onClosed?: () => void): void {
    service.stop();
    pending.set(service, { ports, onClosed });
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
        finishClose(service);
        return GLib.SOURCE_REMOVE;
    });
}

/**
 * Call before binding `port`. Node's `server.close()` releases the port
 * synchronously (libuv closes the fd in `uv_close`), so `close(); listen(port)`
 * on the same port is legal there. A deferred close still holding `port` is
 * therefore finished NOW: on darwin that may cost the one EBADF warning the
 * deferral exists to avoid, which beats an EADDRINUSE Node would not raise.
 * Port 0 (ephemeral) never collides, so it flushes nothing.
 */
export function releaseListenPort(port: number): void {
    if (!port) return;
    for (const [service, entry] of [...pending]) {
        if (entry.ports.includes(port)) finishClose(service);
    }
}
