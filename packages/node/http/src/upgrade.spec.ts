// HTTP upgrade event tests — protocol upgrade handling
// Tests the 'upgrade' event on http.Server for custom protocol upgrades.
// Reference: Node.js lib/_http_server.js upgrade event emission
//
// Note: On GJS, WebSocket upgrades (Upgrade: websocket) are handled by
// Soup.Server internally via addWebSocketHandler(). The 'upgrade' event
// fires for non-WebSocket protocol upgrades using steal_connection().

import { describe, it, expect } from '@gjsify/unit';
import * as http from 'node:http';
import * as net from 'node:net';
import { Buffer } from 'node:buffer';

export default async () => {
  await describe('http.Server upgrade event', async () => {

    await it('should emit upgrade event for protocol upgrade requests', async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200);
        res.end('not upgraded');
      });

      await new Promise<void>((resolve, reject) => {
        let upgradeReceived = false;

        server.on('upgrade', (req, socket, head) => {
          upgradeReceived = true;
          expect(req.headers['upgrade']).toBe('custom-protocol');
          expect(req.headers['connection']?.toString().toLowerCase()).toContain('upgrade');
          expect(req.url).toBe('/upgrade');
          expect(head).toBeDefined();
          expect(Buffer.isBuffer(head)).toBe(true);

          // Send a 101 Switching Protocols response
          socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: custom-protocol\r\n' +
            'Connection: Upgrade\r\n' +
            '\r\n',
          );
          socket.end();
        });

        server.listen(0, () => {
          const addr = server.address() as { port: number };
          const client = net.createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
            client.write(
              'GET /upgrade HTTP/1.1\r\n' +
              `Host: 127.0.0.1:${addr.port}\r\n` +
              'Upgrade: custom-protocol\r\n' +
              'Connection: Upgrade\r\n' +
              '\r\n',
            );
          });

          const chunks: Buffer[] = [];
          client.on('data', (chunk: Buffer) => chunks.push(chunk));
          client.on('end', () => {
            const response = Buffer.concat(chunks).toString();
            expect(response).toContain('101');
            expect(upgradeReceived).toBe(true);
            server.close(() => resolve());
          });
          client.on('error', reject);
        });
        server.on('error', reject);
      });
    });

    await it('should only emit upgrade when listeners are registered', async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200);
        res.end('ok');
      });

      let upgradeCount = 0;

      await new Promise<void>((resolve, reject) => {
        server.on('upgrade', (req, socket, _head) => {
          upgradeCount++;
          socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: custom\r\n\r\n');
          socket.end();
        });

        server.listen(0, () => {
          const addr = server.address() as { port: number };
          const client = net.createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
            client.write(
              'GET /test HTTP/1.1\r\n' +
              `Host: 127.0.0.1:${addr.port}\r\n` +
              'Upgrade: custom\r\n' +
              'Connection: Upgrade\r\n' +
              '\r\n',
            );
          });

          client.on('data', () => {});
          client.on('end', () => {
            client.destroy();
            expect(upgradeCount).toBe(1);
            expect(server.listenerCount('upgrade')).toBeGreaterThan(0);
            server.close(() => resolve());
          });
          client.on('error', reject);
        });
        server.on('error', reject);
      });
    });

    await it('should provide a writable socket in upgrade callback', async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200);
        res.end();
      });

      await new Promise<void>((resolve, reject) => {
        server.on('upgrade', (_req, socket, _head) => {
          expect(typeof socket.write).toBe('function');
          expect(typeof socket.end).toBe('function');
          expect(typeof socket.on).toBe('function');
          expect(typeof socket.destroy).toBe('function');

          // Single write with body included, then end
          socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: custom\r\nConnection: Upgrade\r\n\r\nHELLO');
          socket.end();
        });

        server.listen(0, () => {
          const addr = server.address() as { port: number };
          const client = net.createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
            client.write(
              'GET /custom HTTP/1.1\r\n' +
              `Host: 127.0.0.1:${addr.port}\r\n` +
              'Upgrade: custom\r\n' +
              'Connection: Upgrade\r\n' +
              '\r\n',
            );
          });

          const chunks: Buffer[] = [];
          client.on('data', (chunk: Buffer) => chunks.push(chunk));
          client.on('end', () => {
            const response = Buffer.concat(chunks).toString();
            expect(response).toContain('101');
            expect(response).toContain('HELLO');
            server.close(() => resolve());
          });
          client.on('error', reject);
        });
        server.on('error', reject);
      });
    });

    await it('should include correct request URL and method in upgrade', async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200);
        res.end();
      });

      await new Promise<void>((resolve, reject) => {
        server.on('upgrade', (req, socket, _head) => {
          expect(req.method).toBe('GET');
          expect(req.url).toBe('/chat?room=1');
          expect(req.httpVersion).toBe('1.1');

          socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: custom\r\n\r\n');
          socket.end();
        });

        server.listen(0, () => {
          const addr = server.address() as { port: number };
          const client = net.createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
            client.write(
              'GET /chat?room=1 HTTP/1.1\r\n' +
              `Host: 127.0.0.1:${addr.port}\r\n` +
              'Upgrade: custom\r\n' +
              'Connection: Upgrade\r\n' +
              '\r\n',
            );
          });

          const chunks: Buffer[] = [];
          client.on('data', (chunk: Buffer) => chunks.push(chunk));
          client.on('end', () => {
            const response = Buffer.concat(chunks).toString();
            expect(response).toContain('101');
            server.close(() => resolve());
          });
          client.on('error', reject);
        });
        server.on('error', reject);
      });
    });

    await it('should support bidirectional data after upgrade', async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200);
        res.end();
      });

      await new Promise<void>((resolve, reject) => {
        server.on('upgrade', (_req, socket, _head) => {
          socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: custom\r\n\r\n');

          // Echo data back to client
          socket.on('data', (data: Buffer) => {
            socket.write(data);
          });

          socket.on('end', () => {
            socket.end();
          });
        });

        server.listen(0, () => {
          const addr = server.address() as { port: number };
          const client = net.createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
            client.write(
              'GET /echo HTTP/1.1\r\n' +
              `Host: 127.0.0.1:${addr.port}\r\n` +
              'Upgrade: custom\r\n' +
              'Connection: Upgrade\r\n' +
              '\r\n',
            );
          });

          let gotHeaders = false;
          const dataChunks: Buffer[] = [];
          client.on('data', (chunk: Buffer) => {
            if (!gotHeaders) {
              const str = chunk.toString();
              if (str.includes('\r\n\r\n')) {
                gotHeaders = true;
                // Send test data after receiving the 101 response
                client.write('PING');
              }
            } else {
              dataChunks.push(chunk);
              const received = Buffer.concat(dataChunks).toString();
              if (received === 'PING') {
                expect(received).toBe('PING');
                client.end();
              }
            }
          });

          client.on('end', () => {
            server.close(() => resolve());
          });
          client.on('error', reject);
        });
        server.on('error', reject);
      });
    });
  });
};
