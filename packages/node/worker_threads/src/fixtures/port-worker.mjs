// SPDX-License-Identifier: MIT
// Port worker fixture for worker-ports.spec.ts and worker-ports.gjs.spec.ts.
//
// Raw .mjs, runnable under Node and bare GJS (see echo-worker.mjs for how the
// worker context is picked). It only touches the DOM-shaped port surface and
// the global `MessageChannel`, which is exactly what Comlink and the web
// Worker wrapper rely on.
//
// Protocol, parent → worker (messages that carry a `port` transfer it):
//   { type: 'dom',      port } echo through addEventListener('message')
//   { type: 'onmessage', port } echo through port.onmessage
//   { type: 'ee',       port } echo through port.on('message')
//   { type: 'hold',     port } keep the port, attach nothing
//   { type: 'listen-dom' }     attach the DOM listener to the held port
//   { type: 'watch-close', port } report 'port-closed' when the port closes
//   { type: 'close-port', port } close the port from this side
//   { type: 'channel' }        local MessageChannel round trip → 'channel-result'
//   { type: 'send-port' }      send a fresh channel's port2 to the parent; the
//                              kept port1 echoes `{ echoed }`
//   { type: 'send-port-first' } same, but port1 also posts 'hello' unprompted
//   { type: 'port-in-port', port } try to send a port through `port`; reports
//                              the error name as 'port-in-port-result'

const ctx = globalThis.__gjsify_worker_context;
let parentPort;
if (ctx) {
    ({ parentPort } = ctx);
} else {
    ({ parentPort } = await import('node:worker_threads'));
}

let held = null;

parentPort.on('message', (msg) => {
    switch (msg.type) {
        case 'dom':
            msg.port.addEventListener('message', (event) => {
                msg.port.postMessage({ kind: 'dom', eventType: event.type, data: event.data });
            });
            return;
        case 'onmessage':
            msg.port.onmessage = (event) => {
                msg.port.postMessage({ kind: 'onmessage', eventType: event.type, data: event.data });
            };
            return;
        case 'ee':
            msg.port.on('message', (data) => {
                msg.port.postMessage({ kind: 'ee', data });
            });
            return;
        case 'hold':
            held = msg.port;
            return;
        case 'listen-dom':
            held.addEventListener('message', (event) => {
                held.postMessage({ kind: 'dom', eventType: event.type, data: event.data });
            });
            return;
        case 'watch-close':
            // Node only observes a peer close on a started port.
            msg.port.on('message', () => {});
            msg.port.on('close', () => parentPort.postMessage({ type: 'port-closed' }));
            return;
        case 'close-port':
            msg.port.close();
            return;
        case 'channel': {
            const channel = new MessageChannel();
            channel.port1.onmessage = (event) => {
                parentPort.postMessage({ type: 'channel-result', data: event.data });
                channel.port1.close();
            };
            channel.port2.postMessage({ nested: [1, 2, 3] });
            return;
        }
        case 'send-port':
        case 'send-port-first': {
            const channel = new MessageChannel();
            channel.port1.onmessage = (event) => {
                channel.port1.postMessage({ echoed: event.data });
            };
            parentPort.postMessage({ type: 'port', port: channel.port2 }, [channel.port2]);
            if (msg.type === 'send-port-first') channel.port1.postMessage('hello');
            return;
        }
        case 'port-in-port': {
            const other = new MessageChannel();
            let name = 'none';
            try {
                msg.port.postMessage({ inner: other.port2 }, [other.port2]);
            } catch (err) {
                name = err.name;
            }
            parentPort.postMessage({ type: 'port-in-port-result', name });
            return;
        }
    }
});

parentPort.postMessage({ type: 'ready' });
