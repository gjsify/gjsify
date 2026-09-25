// SPDX-License-Identifier: MIT
// `connect`/`disconnect`/`emit` are GObject.Object's signal API ONLY when the
// instance's class (or an interface it implements) declares no introspected
// method of that name: on gjs the class's own method shadows the inherited one
// through ordinary prototype lookup. node-gi's instance Proxy shortcut them to the
// signal API unconditionally, so Soup.Server.disconnect() (soup_server_disconnect,
// zero-arg) threw about a handler id and Gio.Cancellable.connect(cb) was not
// g_cancellable_connect (#1810). Headless Gio, one row per resolution rule:
//   SimpleAction   — no colliding method: the generic signal API
//   Cancellable    — a CLASS method (connect/disconnect) wins; connect_after
//                    has no g_cancellable_connect_after and stays the signal API
//   SocketClient   — a CLASS method with a different shape (connectable, …)
//   socks5 proxy   — an INTERFACE method (Gio.Proxy.connect) on a PRIVATE type,
//                    which wraps as its nearest introspectable ancestor
// Only outcomes are printed where the two engines word a type error differently.
import Gio from 'gi://Gio?version=2.0';

const threw = (f) => {
    try {
        f();
        return false;
    } catch {
        return true;
    }
};

const action = new Gio.SimpleAction({ name: 'fire', enabled: true });
let activations = 0;
const aid = action.connect('activate', () => activations++);
action.emit('activate', null);
action.disconnect(aid);
action.emit('activate', null);
print('SimpleAction signal api, activations:', activations);

const c = new Gio.Cancellable();
let viaMethod = 0;
let viaSignal = 0;
const cid = c.connect(() => viaMethod++);
print('Cancellable.connect(cb) id > 0:', cid > 0);
c.connect_after('cancelled', () => viaSignal++);
print(
    'Cancellable.connect(signal, cb) throws:',
    threw(() => c.connect('cancelled', () => {})),
);
c.cancel();
c.disconnect(cid);
print('cancel ran g_cancellable_connect cb:', viaMethod, 'signal handler:', viaSignal);

const client = new Gio.SocketClient();
print(
    'SocketClient.connect(signal, cb) throws:',
    threw(() => client.connect('event', () => {})),
);

const socks5 = Gio.Proxy.get_default_for_protocol('socks5');
try {
    socks5.connect('event', () => {});
    print('socks5.connect: signal api');
} catch (e) {
    print('socks5.connect:', e.message);
}
