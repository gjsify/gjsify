// Real-time chat server using Server-Sent Events (SSE) + HTTP POST
// Demonstrates: http.createServer, events.EventEmitter, fs.readFileSync,
// SSE protocol, JSON parsing, URL routing

import { runtimeName } from '@gjsify/runtime';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = parseInt(process.env.PORT || '3000', 10);

// Chat message bus — broadcasts messages to all connected SSE clients
const chatBus = new EventEmitter();
const messages: { user: string; text: string; time: string }[] = [];

/** Read a static file from public/. */
function serveStatic(res: ServerResponse, filename: string, contentType: string): void {
  try {
    const content = readFileSync(join(__dirname, 'public', filename), 'utf8');
    res.writeHead(200, { 'content-type': contentType });
    res.end(content);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404 Not Found');
  }
}

/** Parse JSON body from a POST request. */
function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** SSE endpoint — keeps the connection open and streams chat messages. */
function handleSSE(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
  });

  // Send existing messages as initial batch
  for (const msg of messages) {
    res.write(`data: ${JSON.stringify(msg)}\n\n`);
  }

  // Listen for new messages
  const onMessage = (msg: { user: string; text: string; time: string }) => {
    res.write(`data: ${JSON.stringify(msg)}\n\n`);
  };
  chatBus.on('message', onMessage);

  // Cleanup when client disconnects
  req.on('close', () => {
    chatBus.removeListener('message', onMessage);
  });

  // Note: We intentionally do NOT call res.end() — SSE connections stay open
}

/** Handle incoming HTTP requests. */
function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url || '/';
  const method = req.method || 'GET';

  // CORS headers for SSE
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Routes
  if (method === 'GET' && url === '/') {
    serveStatic(res, 'index.html', 'text/html; charset=utf-8');
  } else if (method === 'GET' && url === '/style.css') {
    serveStatic(res, 'style.css', 'text/css; charset=utf-8');
  } else if (method === 'GET' && url === '/events') {
    handleSSE(req, res);
  } else if (method === 'POST' && url === '/send') {
    parseBody(req)
      .then((body) => {
        const user = String(body.user || 'Anonymous');
        const text = String(body.text || '');
        if (!text.trim()) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Empty message' }));
          return;
        }
        const msg = { user, text, time: new Date().toISOString() };
        messages.push(msg);
        // Keep last 100 messages
        if (messages.length > 100) messages.shift();
        chatBus.emit('message', msg);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      })
      .catch(() => {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      });
  } else if (method === 'GET' && url === '/api/messages') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ messages, runtime: runtimeName }));
  } else {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404 Not Found');
  }
}

const server = createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`SSE Chat running at http://localhost:${PORT}`);
  console.log(`Runtime: ${runtimeName}`);
  console.log('Open in browser to chat. Press Ctrl+C to stop.');
});
