// Authenticated WebSocket server — ws npm package patterns on GJS + Node.js
//
// Demonstrates Phase 2 + Phase 3 of @gjsify/ws WebSocketServer:
//   - { noServer: true } + handleUpgrade()  (engine.io / socket.io pattern)
//   - verifyClient          token-based access control via query param
//   - handleProtocols       subprotocol negotiation (chat/v1)
//   - 'headers' event       custom response headers before the 101 write
//
// Usage:
//   yarn build && yarn start            (GJS)
//   yarn build && yarn start:node       (Node.js)
//
// Then open http://localhost:3001 in a browser, or connect directly:
//   wscat -c "ws://localhost:3001/ws?token=gjsify&nick=alice" -s chat/v1

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage, ServerResponse } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3001);
const SECRET_TOKEN = process.env.TOKEN ?? 'gjsify';
const WS_PATH = '/ws';

// ── HTTP server ──────────────────────────────────────────────────────────────

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = req.url ?? '/';

  if (url === '/' || url === '/index.html') {
    try {
      const html = readFileSync(join(__dirname, 'public', 'index.html'), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      res.writeHead(500); res.end('Server error');
    }
  } else if (url === '/api/status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ clients: wss.clients.size, path: WS_PATH }));
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

// ── WebSocket server (noServer mode) ────────────────────────────────────────
//
// { noServer: true }: no Soup.Server/port created here — we own the http.Server
// and route upgrades manually via handleUpgrade(). This is the standard pattern
// used by engine.io and socket.io to coexist with an HTTP server.

const wss = new WebSocketServer({
  noServer: true,

  // verifyClient — called before the 101 handshake.
  // info.req.url contains the full path + query string.
  // Returning false → client receives HTTP 401.
  verifyClient: (info) => {
    const url = new URL(info.req.url ?? '/', `http://localhost:${PORT}`);
    const token = url.searchParams.get('token');
    if (token !== SECRET_TOKEN) {
      console.log(`[ws] rejected connection — bad token from ${info.origin || 'unknown'}`);
      return false;
    }
    return true;
  },

  // handleProtocols — select a subprotocol from the client's offer.
  // The selected value appears in the 101 Sec-WebSocket-Protocol header
  // and in client.protocol on both sides (unlike the Soup add_websocket_handler
  // path where the header is already committed before this callback fires).
  handleProtocols: (protocols: Set<string>) => {
    if (protocols.has('chat.v1')) return 'chat.v1';
    return false; // no subprotocol — still accept the connection
  },
});

// 'headers' event — fired before every 101 write.
// Push additional response headers into the mutable array.
wss.on('headers', (headers: string[]) => {
  headers.push('X-Server: gjsify');
  headers.push(`X-WS-Clients: ${wss.clients.size}`);
});

// ── Connection handler ───────────────────────────────────────────────────────

function broadcast(sender: WebSocket, message: string): void {
  for (const client of wss.clients) {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const nick = url.searchParams.get('nick') ?? 'anonymous';
  const proto = (ws as any).protocol || '(none)';

  console.log(`[ws] + ${nick}  (protocol: ${proto}, clients: ${wss.clients.size})`);
  ws.send(JSON.stringify({ type: 'info', text: `Welcome, ${nick}! Protocol: ${proto}` }));
  broadcast(ws, JSON.stringify({ type: 'join', nick }));

  ws.on('message', (data) => {
    const text = data.toString();
    console.log(`[ws] ${nick}: ${text}`);
    // Broadcast to all other clients — sender already shows message locally
    broadcast(ws, JSON.stringify({ type: 'message', nick, text }));
  });

  ws.on('close', () => {
    console.log(`[ws] - ${nick}  (clients: ${wss.clients.size})`);
    broadcast(ws, JSON.stringify({ type: 'leave', nick }));
  });

  ws.on('error', (err: Error) => {
    console.error(`[ws] error from ${nick}:`, err.message);
  });
});

// ── Upgrade routing ──────────────────────────────────────────────────────────
//
// The http.Server emits 'upgrade' for any protocol upgrade request.
// We filter by path and hand off to wss.handleUpgrade(), which:
//   1. Validates Sec-WebSocket-Key, version, etc.
//   2. Runs verifyClient
//   3. Computes Sec-WebSocket-Accept
//   4. Runs handleProtocols
//   5. Emits 'headers' (our hook above fires here)
//   6. Writes the 101 response
//   7. Creates Soup.WebsocketConnection from the raw IOStream

server.on('upgrade', (req: IncomingMessage, socket: any, head: Buffer) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname !== WS_PATH) {
    // Unknown path — reject cleanly
    socket.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    wss.emit('connection', ws, req);
  });
});

// ── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log('');
  console.log('WebSocket server (ws npm package, noServer mode)');
  console.log('─────────────────────────────────────────────────');
  console.log(`  HTTP:       http://localhost:${PORT}`);
  console.log(`  WebSocket:  ws://localhost:${PORT}${WS_PATH}?token=${SECRET_TOKEN}&nick=alice (subprotocol: chat.v1)`);
  console.log(`  Status:     http://localhost:${PORT}/api/status`);
  console.log('');
  console.log('Features active:');
  console.log('  verifyClient    → requires ?token=' + SECRET_TOKEN);
  console.log('  handleProtocols → negotiates chat.v1 subprotocol');
  console.log("  'headers' event → injects X-Server: gjsify");
  console.log('  noServer mode   → http.Server owns the port, wss handles upgrades');
  console.log('');
  console.log('Press Ctrl+C to stop.');
});
