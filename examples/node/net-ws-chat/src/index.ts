// WebSocket chat server for GJS (and Node.js HTTP fallback)
// Demonstrates: http.createServer, http.Server.addWebSocketHandler (GJS),
// Soup.WebsocketConnection signals, events.EventEmitter, fs.readFileSync

import { runtimeName, isGJS } from '@gjsify/runtime';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Server } from '@gjsify/http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = parseInt(process.env.PORT || '3000', 10);

// Chat message bus
const chatBus = new EventEmitter();
const messages: { user: string; text: string; time: string }[] = [];

// GC guard — keep WebSocket connections alive on GJS
const _activeConnections = new Set<unknown>();

/** Serve static files from public/. */
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

/** Parse JSON body from POST request. */
function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => {
            body += chunk;
        });
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

// HTTP server — serves HTML and handles REST fallback
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || '/';
    const method = req.method || 'GET';

    if (method === 'GET' && url === '/') {
        serveStatic(res, 'index.html', 'text/html; charset=utf-8');
    } else if (method === 'GET' && url === '/style.css') {
        serveStatic(res, 'style.css', 'text/css; charset=utf-8');
    } else if (method === 'POST' && url === '/send') {
        // REST fallback for platforms without WebSocket server
        parseBody(req)
            .then((body) => {
                const msg = {
                    user: String(body.user || 'Anonymous'),
                    text: String(body.text || ''),
                    time: new Date().toISOString(),
                };
                if (msg.text.trim()) {
                    messages.push(msg);
                    if (messages.length > 100) messages.shift();
                    chatBus.emit('message', msg);
                }
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            })
            .catch(() => {
                res.writeHead(400, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            });
    } else if (method === 'GET' && url === '/api/messages') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ messages, runtime: runtimeName, websocket: isGJS }));
    } else {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('404 Not Found');
    }
});

server.listen(PORT, () => {
    console.log(`WebSocket Chat running at http://localhost:${PORT}`);
    console.log(`Runtime: ${runtimeName}`);

    if (isGJS) {
        // GJS: Add WebSocket handler via Soup.Server
        const httpServer = server as unknown as Server;
        // oxlint-disable-next-line typescript/no-explicit-any -- Soup.WebsocketConnection has no @types; callback parameter is GJS runtime type
        httpServer.addWebSocketHandler('/ws', (connection: any) => {
            console.log('WebSocket client connected');
            _activeConnections.add(connection);

            // Send message history
            for (const msg of messages) {
                connection.send_text(JSON.stringify(msg));
            }

            // Handle incoming messages
            // oxlint-disable-next-line typescript/no-explicit-any -- Soup.WebsocketConnection signal callbacks have no @types for GJS
            connection.connect('message', (_conn: any, _type: number, data: any) => {
                try {
                    const text = new TextDecoder().decode(data.toArray());
                    const parsed = JSON.parse(text);
                    const msg = {
                        user: String(parsed.user || 'Anonymous'),
                        text: String(parsed.text || ''),
                        time: new Date().toISOString(),
                    };
                    if (msg.text.trim()) {
                        messages.push(msg);
                        if (messages.length > 100) messages.shift();
                        // Broadcast to all connected WebSocket clients
                        const payload = JSON.stringify(msg);
                        for (const c of _activeConnections) {
                            try {
                                // oxlint-disable-next-line typescript/no-explicit-any -- Soup.WebsocketConnection.send_text not in @types; GJS runtime call
                                (c as any).send_text(payload);
                            } catch {}
                        }
                    }
                } catch (err) {
                    console.error('WebSocket message error:', err);
                }
            });

            connection.connect('closed', () => {
                console.log('WebSocket client disconnected');
                _activeConnections.delete(connection);
            });

            // oxlint-disable-next-line typescript/no-explicit-any -- Soup.WebsocketConnection 'error' signal callback has no @types for GJS
            connection.connect('error', (_conn: any, error: any) => {
                console.error('WebSocket error:', error?.message || error);
                _activeConnections.delete(connection);
            });
        });

        console.log('WebSocket server active on ws://localhost:' + PORT + '/ws');
    } else {
        console.log('WebSocket server not available on Node.js (use SSE chat example instead)');
    }

    console.log('Press Ctrl+C to stop');
});
