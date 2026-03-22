import { describe, it, expect, on } from '@gjsify/unit';
import { isIP, isIPv4, isIPv6, createServer, createConnection, Socket, Server } from 'net';

export default async () => {
  await describe('net', async () => {
    await describe('isIP', async () => {
      await it('should return 4 for valid IPv4', async () => {
        expect(isIP('127.0.0.1')).toBe(4);
        expect(isIP('192.168.1.1')).toBe(4);
        expect(isIP('0.0.0.0')).toBe(4);
      });

      await it('should return 6 for valid IPv6', async () => {
        expect(isIP('::1')).toBe(6);
        expect(isIP('fe80::1')).toBe(6);
      });

      await it('should return 0 for invalid addresses', async () => {
        expect(isIP('hello')).toBe(0);
        expect(isIP('')).toBe(0);
      });
    });

    await describe('isIPv4', async () => {
      await it('should return true for IPv4', async () => {
        expect(isIPv4('127.0.0.1')).toBe(true);
        expect(isIPv4('::1')).toBe(false);
      });
    });

    await describe('isIPv6', async () => {
      await it('should return true for IPv6', async () => {
        expect(isIPv6('::1')).toBe(true);
        expect(isIPv6('127.0.0.1')).toBe(false);
      });
    });

    await describe('Socket', async () => {
      await it('should be constructable', async () => {
        const socket = new Socket();
        expect(socket).toBeDefined();
        expect(socket.connecting).toBe(false);
      });
    });

    await describe('Server', async () => {
      await it('should be constructable', async () => {
        const server = new Server();
        expect(server).toBeDefined();
        expect(server.listening).toBe(false);
      });
    });

    // TCP connection tests only on Node.js (GJS needs MainLoop integration)
    await on('Node.js', async () => {
      await describe('TCP connection', async () => {
        await it('should listen and connect', async () => {
          const server = createServer((socket) => {
            socket.write('hello');
            socket.end();
          });

          await new Promise<void>((resolve, reject) => {
            server.listen(0, () => {
              const addr = server.address();
              if (!addr || !('port' in addr)) {
                reject(new Error('Server has no address'));
                return;
              }

              const client = createConnection({ port: addr.port, host: '127.0.0.1' }, () => {
                const chunks: Buffer[] = [];
                client.on('data', (chunk) => chunks.push(chunk as Buffer));
                client.on('end', () => {
                  const data = Buffer.concat(chunks).toString();
                  expect(data).toBe('hello');
                  server.close(() => resolve());
                });
              });

              client.on('error', reject);
            });

            server.on('error', reject);
          });
        });
      });
    });
  });
};
