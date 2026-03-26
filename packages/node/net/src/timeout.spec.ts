// Ported from refs/node-test/parallel/test-net-socket-timeout.js,
// test-net-allow-half-open.js, test-net-server-close.js, test-net-end-close.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import { createServer, connect, Socket } from 'node:net';
import { Buffer } from 'node:buffer';
import type { Server } from 'node:net';

/** Helper: create a TCP server and return address + cleanup */
function listenServer(handler?: (socket: any) => void): Promise<{ port: number; server: Server; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer(handler || (() => {}));
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()! as { port: number };
      resolve({
        port: addr.port,
        server,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

export default async () => {

  // ===================== Socket.setTimeout =====================
  await describe('net Socket.setTimeout', async () => {
    await it('should return the socket instance (chainable)', async () => {
      const socket = new Socket();
      const ret = socket.setTimeout(1000);
      expect(ret).toBe(socket);
      socket.destroy();
    });

    await it('should emit timeout event on idle connection', async () => {
      const { port, close } = await listenServer((sock) => {
        // Don't send any data — let the client timeout
        sock.on('error', () => {});
      });
      try {
        const timedOut = await new Promise<boolean>((resolve) => {
          const client = connect(port, '127.0.0.1', () => {
            client.setTimeout(100, () => {
              client.destroy();
              resolve(true);
            });
          });
          client.on('error', () => {});
          setTimeout(() => { client.destroy(); resolve(false); }, 5000);
        });
        expect(timedOut).toBe(true);
      } finally {
        await close();
      }
    });

    await it('should NOT emit timeout when data flows', async () => {
      let timeoutFired = false;
      const { port, close } = await listenServer((sock) => {
        // Send data periodically to keep the connection alive
        const interval = setInterval(() => {
          try { sock.write('ping'); } catch { clearInterval(interval); }
        }, 30);
        sock.on('close', () => clearInterval(interval));
        sock.on('error', () => clearInterval(interval));
      });
      try {
        await new Promise<void>((resolve) => {
          const client = connect(port, '127.0.0.1', () => {
            client.setTimeout(200, () => {
              timeoutFired = true;
            });
            // Read data to keep timeout resetting
            client.on('data', () => {});
            // Wait longer than timeout to verify it doesn't fire
            setTimeout(() => {
              client.destroy();
              resolve();
            }, 400);
          });
          client.on('error', () => {});
        });
        expect(timeoutFired).toBe(false);
      } finally {
        await close();
      }
    });

    await it('should cancel timeout with setTimeout(0)', async () => {
      let timeoutFired = false;
      const { port, close } = await listenServer((sock) => {
        sock.on('error', () => {});
      });
      try {
        await new Promise<void>((resolve) => {
          const client = connect(port, '127.0.0.1', () => {
            client.setTimeout(100, () => {
              timeoutFired = true;
            });
            // Cancel the timeout
            client.setTimeout(0);
            setTimeout(() => {
              client.destroy();
              resolve();
            }, 300);
          });
          client.on('error', () => {});
        });
        expect(timeoutFired).toBe(false);
      } finally {
        await close();
      }
    });
  });

  // ===================== allowHalfOpen =====================
  await describe('net allowHalfOpen', async () => {
    await it('server should store allowHalfOpen option', async () => {
      const server1 = createServer({ allowHalfOpen: true });
      expect((server1 as any).allowHalfOpen).toBe(true);

      const server2 = createServer({ allowHalfOpen: false });
      expect((server2 as any).allowHalfOpen).toBe(false);

      const server3 = createServer();
      expect((server3 as any).allowHalfOpen).toBe(false);
    });

    await it('should close write side on EOF when allowHalfOpen=false', async () => {
      const { port, close } = await listenServer((sock) => {
        // Server sends data then ends (half-close)
        sock.write('hello');
        sock.end();
      });
      try {
        const result = await new Promise<{ data: string; ended: boolean }>((resolve) => {
          let data = '';
          let ended = false;
          const client = connect(port, '127.0.0.1');
          client.setEncoding('utf8');
          client.on('data', (chunk: string) => { data += chunk; });
          client.on('end', () => {
            ended = true;
          });
          client.on('close', () => {
            resolve({ data, ended });
          });
          client.on('error', () => {});
        });
        expect(result.data).toBe('hello');
        expect(result.ended).toBe(true);
      } finally {
        await close();
      }
    });
  });

  // ===================== Server lifecycle =====================
  await describe('net Server lifecycle', async () => {
    await it('should set listening=true after listen', async () => {
      const server = createServer();
      expect(server.listening).toBe(false);
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          expect(server.listening).toBe(true);
          server.close(() => resolve());
        });
      });
    });

    await it('should set listening=false after close', async () => {
      const { server, close } = await listenServer();
      expect(server.listening).toBe(true);
      await close();
      expect(server.listening).toBe(false);
    });

    await it('should emit close event on server.close()', async () => {
      const closed = await new Promise<boolean>((resolve) => {
        const server = createServer();
        server.listen(0, '127.0.0.1', () => {
          server.close(() => resolve(true));
        });
      });
      expect(closed).toBe(true);
    });

    await it('should return address after listen', async () => {
      const { server, close } = await listenServer();
      const addr = server.address()! as { port: number; family: string; address: string };
      expect(typeof addr.port).toBe('number');
      expect(addr.port).toBeGreaterThan(0);
      await close();
    });

    await it('should return null address before listen', async () => {
      const server = createServer();
      expect(server.address()).toBeNull();
    });

    await it('getConnections should return 0 when no clients', async () => {
      const { server, close } = await listenServer();
      const count = await new Promise<number>((resolve) => {
        server.getConnections((err, count) => resolve(count));
      });
      expect(count).toBe(0);
      await close();
    });
  });

  // ===================== Socket connection lifecycle =====================
  await describe('net Socket connection lifecycle', async () => {
    await it('should emit connect and ready events', async () => {
      const { port, close } = await listenServer((sock) => {
        sock.end();
      });
      try {
        const events: string[] = [];
        await new Promise<void>((resolve) => {
          const client = connect(port, '127.0.0.1');
          client.on('connect', () => events.push('connect'));
          client.on('ready', () => events.push('ready'));
          client.on('end', () => events.push('end'));
          client.on('close', () => {
            events.push('close');
            resolve();
          });
          client.on('error', () => {});
        });
        expect(events).toContain('connect');
        expect(events).toContain('ready');
        expect(events).toContain('close');
      } finally {
        await close();
      }
    });

    await it('should set connecting=true during connect', async () => {
      const { port, close } = await listenServer((sock) => sock.end());
      try {
        const wasConnecting = await new Promise<boolean>((resolve) => {
          const client = connect(port, '127.0.0.1');
          const val = client.connecting;
          client.on('connect', () => {
            client.destroy();
            resolve(val);
          });
          client.on('error', () => {});
        });
        expect(wasConnecting).toBe(true);
      } finally {
        await close();
      }
    });

    await it('should set connecting=false after connect', async () => {
      const { port, close } = await listenServer((sock) => sock.end());
      try {
        const wasConnecting = await new Promise<boolean>((resolve) => {
          const client = connect(port, '127.0.0.1', () => {
            resolve(client.connecting);
            client.destroy();
          });
          client.on('error', () => {});
        });
        expect(wasConnecting).toBe(false);
      } finally {
        await close();
      }
    });

    await it('should track bytesRead and bytesWritten', async () => {
      const { port, close } = await listenServer((sock) => {
        sock.on('data', (data: Buffer) => {
          sock.write(data); // echo
        });
      });
      try {
        const result = await new Promise<{ bytesRead: number; bytesWritten: number }>((resolve) => {
          const client = connect(port, '127.0.0.1', () => {
            client.write('hello');
          });
          client.on('data', () => {
            // Give time for bytes counters to update
            setTimeout(() => {
              resolve({ bytesRead: client.bytesRead, bytesWritten: client.bytesWritten });
              client.destroy();
            }, 50);
          });
          client.on('error', () => {});
        });
        expect(result.bytesWritten).toBe(5); // 'hello' = 5 bytes
        expect(result.bytesRead).toBe(5); // echo back = 5 bytes
      } finally {
        await close();
      }
    });
  });

  // ===================== Socket destroy =====================
  await describe('net Socket.destroy', async () => {
    await it('should set destroyed=true', async () => {
      const { port, close } = await listenServer((sock) => sock.end());
      try {
        const wasDestroyed = await new Promise<boolean>((resolve) => {
          const client = connect(port, '127.0.0.1', () => {
            client.destroy();
            resolve(client.destroyed);
          });
          client.on('error', () => {});
        });
        expect(wasDestroyed).toBe(true);
      } finally {
        await close();
      }
    });

    await it('should emit close event after destroy', async () => {
      const { port, close } = await listenServer((sock) => sock.end());
      try {
        const closeFired = await new Promise<boolean>((resolve) => {
          const client = connect(port, '127.0.0.1', () => {
            client.destroy();
          });
          client.on('close', () => resolve(true));
          client.on('error', () => {});
          setTimeout(() => resolve(false), 3000);
        });
        expect(closeFired).toBe(true);
      } finally {
        await close();
      }
    });
  });

  // ===================== Error handling =====================
  await describe('net error handling', async () => {
    await it('should emit error on connection refused', async () => {
      const errorEmitted = await new Promise<boolean>((resolve) => {
        const client = connect(1, '127.0.0.1'); // Port 1 should refuse
        client.on('error', () => resolve(true));
        client.on('connect', () => { client.destroy(); resolve(false); });
        setTimeout(() => resolve(false), 5000);
      });
      expect(errorEmitted).toBe(true);
    });

    await it('should emit error on EADDRINUSE', async () => {
      const { port, close } = await listenServer();
      try {
        const errorEmitted = await new Promise<boolean>((resolve) => {
          const server2 = createServer();
          server2.on('error', () => resolve(true));
          server2.listen(port, '127.0.0.1');
          setTimeout(() => resolve(false), 2000);
        });
        expect(errorEmitted).toBe(true);
      } finally {
        await close();
      }
    });
  });

  // ===================== Socket options =====================
  await describe('net Socket options', async () => {
    await it('setKeepAlive should return the socket (chainable)', async () => {
      const socket = new Socket();
      const ret = socket.setKeepAlive(true);
      expect(ret).toBe(socket);
      socket.destroy();
    });

    await it('setNoDelay should return the socket (chainable)', async () => {
      const socket = new Socket();
      const ret = socket.setNoDelay(true);
      expect(ret).toBe(socket);
      socket.destroy();
    });

    await it('ref and unref should return the socket (chainable)', async () => {
      const socket = new Socket();
      expect(socket.ref()).toBe(socket);
      expect(socket.unref()).toBe(socket);
      socket.destroy();
    });
  });

  // ===================== Server maxConnections =====================
  await describe('net Server maxConnections', async () => {
    await it('should accept connections up to maxConnections', async () => {
      const { port, server, close } = await listenServer((sock) => {
        sock.on('error', () => {});
      });
      server.maxConnections = 2;
      try {
        // Connect 2 clients — should work
        const client1 = connect(port, '127.0.0.1');
        const client2 = connect(port, '127.0.0.1');
        await new Promise<void>((r) => setTimeout(r, 100));

        const count = await new Promise<number>((resolve) => {
          server.getConnections((_err, cnt) => resolve(cnt));
        });
        expect(count).toBe(2);

        client1.destroy();
        client2.destroy();
      } finally {
        await close();
      }
    });
  });

  // ===================== Data transfer =====================
  await describe('net data transfer', async () => {
    await it('should echo data correctly', async () => {
      const { port, close } = await listenServer((sock) => {
        sock.on('data', (data: Buffer) => sock.write(data));
      });
      try {
        const echoed = await new Promise<string>((resolve) => {
          const client = connect(port, '127.0.0.1', () => {
            client.write('test-echo');
          });
          client.setEncoding('utf8');
          client.on('data', (data: string) => {
            client.destroy();
            resolve(data);
          });
          client.on('error', () => {});
        });
        expect(echoed).toBe('test-echo');
      } finally {
        await close();
      }
    });

    await it('should handle binary data', async () => {
      const testData = Buffer.from([0x00, 0xFF, 0x80, 0x7F, 0x01, 0xFE]);
      const { port, close } = await listenServer((sock) => {
        sock.on('data', (data: Buffer) => sock.write(data));
      });
      try {
        const received = await new Promise<Buffer>((resolve) => {
          const client = connect(port, '127.0.0.1', () => {
            client.write(testData);
          });
          client.on('data', (data: Buffer) => {
            client.destroy();
            resolve(data);
          });
          client.on('error', () => {});
        });
        expect(received.length).toBe(testData.length);
        for (let i = 0; i < testData.length; i++) {
          expect(received[i]).toBe(testData[i]);
        }
      } finally {
        await close();
      }
    });
  });
};
