// Socket.IO ping-pong round-trip demo for GJS
// Adapted from refs/socket.io/examples/typescript-example/esm/
// Copyright (c) 2014-2024 Damien Arrachequesne. MIT.
// Rewritten for GJS: single-process server+client, gjsify transports, clean shutdown.

import '@gjsify/node-globals/register';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as ioc } from 'socket.io-client';

const MAX_ROUNDTRIPS = 5;

const httpServer = createServer();
const ioServer = new Server(httpServer, {
  transports: ['polling'],
  httpCompression: false,
});

ioServer.on('connection', (socket) => {
  console.log(`[server] client connected   id=${socket.id}`);

  socket.on('roundtrip', (n: number, ack: (n: number) => void) => {
    console.log(`[server] roundtrip #${n}`);
    ack(n);
  });

  socket.on('disconnect', (reason) => {
    console.log(`[server] client disconnected reason=${reason}`);
  });
});

httpServer.listen(0, () => {
  const addr = httpServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  console.log(`[server] listening on port ${port}\n`);

  const socket = ioc(`http://localhost:${port}`, {
    transports: ['polling'],
  });

  let count = 0;

  socket.on('connect', () => {
    console.log(`[client] connected   id=${socket.id}\n`);
    sendNext();
  });

  socket.on('connect_error', (err: Error) => {
    console.error(`[client] connect error: ${err.message}`);
  });

  socket.on('disconnect', (reason: string) => {
    console.log(`\n[client] disconnected reason=${reason}`);
  });

  function sendNext() {
    const n = ++count;
    const start = Date.now();

    socket.emit('roundtrip', n, (_echo: number) => {
      const ms = Date.now() - start;
      console.log(`[client] roundtrip #${n} complete   latency=${ms}ms`);

      if (count < MAX_ROUNDTRIPS) {
        setTimeout(sendNext, 300);
      } else {
        console.log(`\n[client] ${MAX_ROUNDTRIPS} roundtrips complete — shutting down`);
        socket.disconnect();
        ioServer.close();
        httpServer.close();
      }
    });
  }
});
