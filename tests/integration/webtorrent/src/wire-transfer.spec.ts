// SPDX-License-Identifier: MIT
// Original implementation for @gjsify/integration-webtorrent.
//
// Simulates the exact data path webtorrent uses for peer-to-peer transfers:
//   @gjsify/net.Socket → streamx.pipeline → bittorrent-protocol Wire → @gjsify/net.Socket
//
// Regression guard: when process.nextTick used GLib.idle_add(priority=100), streamx
// fell back to nextTick as its internal scheduler (queueMicrotask absent on SM128),
// which caused the entire bittorrent-protocol Wire pipeline to stall and transfer
// rates to drop to 0 B/s. The fix (nextTick → microtask semantics) must keep this
// test green on both Node.js and GJS.
//
// See: refs/webtorrent/lib/peer.js:72 (onConnect) for the exact connection setup pattern.

import { describe, it, expect } from '@gjsify/unit';
import { createServer, connect } from 'node:net';
import { Buffer } from 'node:buffer';
import Wire from 'bittorrent-protocol';
// @ts-ignore — @types/streamx does not declare pipeline; the CJS runtime does
import { pipeline, PassThrough } from 'streamx';

const NUM_PIECES = 20;
const PIECE_SIZE = 16_384; // 16 KB — matches BitTorrent block size
const TIMEOUT_MS = 15_000;

function makeInfoHash(): Buffer {
  const buf = Buffer.alloc(20);
  for (let i = 0; i < 20; i++) buf[i] = i + 1;
  return buf;
}

function makePeerId(prefix: number): Buffer {
  const buf = Buffer.alloc(20);
  buf[0] = prefix;
  return buf;
}

function makeFullBitfield(numPieces: number): Uint8Array {
  const numBytes = Math.ceil(numPieces / 8);
  const bf = new Uint8Array(numBytes);
  for (let i = 0; i < numPieces; i++) {
    bf[Math.floor(i / 8)] |= (0x80 >> (i % 8));
  }
  return bf;
}

export default async () => {
  await describe('webtorrent/wire-transfer: bittorrent-protocol Wire over streamx.pipeline', async () => {
    // Diagnostic 1: confirm 'connect' event fires
    await it('net.Socket fires connect event', async () => {
      const connected = await new Promise<boolean>((resolve) => {
        const server = createServer((conn) => { conn.destroy(); });
        server.listen(0, '127.0.0.1', () => {
          const { port } = server.address() as { port: number };
          const conn = connect(port, '127.0.0.1');
          conn.once('connect', () => { server.close(); resolve(true); });
          conn.on('error', () => { server.close(); resolve(false); });
        });
        server.on('error', () => resolve(false));
      });
      expect(connected).toBeTruthy();
    });

    // Diagnostic 1b: raw Gio write_bytes_async + concurrent read_bytes_async
    // This tests if concurrent read+write on the same socket causes write to stall.
    await it('Gio concurrent read+write both complete', async () => {
      const gjsImports = (globalThis as any).imports;
      if (!gjsImports) { expect(true).toBeTruthy(); return; }
      const Gio = gjsImports.gi.Gio;
      const GLib = gjsImports.gi.GLib;

      const { writeCompleted, timedOut } = await new Promise<{ writeCompleted: boolean; timedOut: boolean }>((resolve) => {
        const deadline = setTimeout(() => resolve({ writeCompleted: false, timedOut: true }), 3000);

        const service = new Gio.SocketService();
        const port = service.add_any_inet_port(null);

        service.connect('incoming', (_svc: any, connection: any) => {
          process.stdout.write('GIO2 INCOMING\n');
          const inputStream = connection.get_input_stream();
          const outputStream = connection.get_output_stream();
          const cancellable = new Gio.Cancellable();

          // Start concurrent read (same cancellable, same socket)
          inputStream.read_bytes_async(4096, GLib.PRIORITY_DEFAULT, cancellable, (_s: any, _r: any) => {
            process.stdout.write('GIO2 READ DONE\n');
          });

          // Start write immediately after read
          outputStream.write_bytes_async(
            new GLib.Bytes(new Uint8Array([1, 2, 3, 4])),
            GLib.PRIORITY_DEFAULT,
            cancellable,
            (_src: any, result: any) => {
              try {
                const n = outputStream.write_bytes_finish(result);
                process.stdout.write('GIO2 WRITE OK: ' + n + '\n');
                clearTimeout(deadline);
                cancellable.cancel();
                service.stop();
                resolve({ writeCompleted: true, timedOut: false });
              } catch (e: any) {
                process.stdout.write('GIO2 WRITE ERR: ' + e.message + '\n');
                clearTimeout(deadline);
                service.stop();
                resolve({ writeCompleted: false, timedOut: false });
              }
            }
          );
          return true;
        });

        service.start();

        const client = new Gio.SocketClient();
        client.connect_to_host_async('127.0.0.1:' + port, 0, null, () => {
          process.stdout.write('GIO2 CLIENT CONNECTED\n');
        });
      });

      expect(timedOut).toBeFalsy();
      expect(writeCompleted).toBeTruthy();
    }, { timeout: 5000 });

    // Diagnostic 1c: raw Gio write_bytes_async works on loopback
    await it('Gio write_bytes_async completes on loopback', async () => {
      const gjsImports = (globalThis as any).imports;
      if (!gjsImports) {
        // On Node.js, skip this GJS-specific test
        expect(true).toBeTruthy();
        return;
      }
      const Gio = gjsImports.gi.Gio;
      const GLib = gjsImports.gi.GLib;

      const { writeCompleted, timedOut } = await new Promise<{ writeCompleted: boolean; timedOut: boolean }>((resolve) => {
        const deadline = setTimeout(() => resolve({ writeCompleted: false, timedOut: true }), 3000);

        // Create a TCP server via raw Gio
        const service = new Gio.SocketService();
        const port = service.add_any_inet_port(null);
        process.stdout.write('GIO SERVER port: ' + port + '\n');

        service.connect('incoming', (_svc: any, connection: any) => {
          process.stdout.write('GIO INCOMING\n');
          const outputStream = connection.get_output_stream();
          const cancellable = new Gio.Cancellable();
          outputStream.write_bytes_async(
            new GLib.Bytes(new Uint8Array([1, 2, 3, 4])),
            GLib.PRIORITY_DEFAULT,
            cancellable,
            (_src: any, result: any) => {
              try {
                const n = outputStream.write_bytes_finish(result);
                process.stdout.write('GIO WRITE OK: ' + n + ' bytes\n');
                clearTimeout(deadline);
                service.stop();
                resolve({ writeCompleted: true, timedOut: false });
              } catch (e: any) {
                process.stdout.write('GIO WRITE ERR: ' + e.message + '\n');
                clearTimeout(deadline);
                service.stop();
                resolve({ writeCompleted: false, timedOut: false });
              }
            }
          );
          return true;
        });

        service.start();

        // Connect a client
        const client = new Gio.SocketClient();
        client.connect_to_host_async('127.0.0.1:' + port, 0, null, (_src: any, result: any) => {
          process.stdout.write('GIO CLIENT CONNECTED\n');
          try {
            client.connect_to_host_finish(result);
          } catch {}
        });
      });

      expect(timedOut).toBeFalsy();
      expect(writeCompleted).toBeTruthy();
    }, { timeout: 5000 });

    // Diagnostic 2a: async/await over read_bytes_async blocks write_bytes_async?
    // This is the critical test: _readLoop() uses async/await which suspends the
    // function on a pending GLib I/O Promise. Does that block write_bytes_async callbacks?
    await it('Gio: async read loop does not block write_bytes_async', async () => {
      const gjsImports = (globalThis as any).imports;
      if (!gjsImports) { expect(true).toBeTruthy(); return; }
      const Gio = gjsImports.gi.Gio;
      const GLib = gjsImports.gi.GLib;

      const { writeOK, timedOut } = await new Promise<{ writeOK: boolean; timedOut: boolean }>((resolve) => {
        const deadline = setTimeout(() => resolve({ writeOK: false, timedOut: true }), 3000);

        const service = new Gio.SocketService();
        const port = service.add_any_inet_port(null);

        service.connect('incoming', (_svc: any, connection: any) => {
          const inputStream = connection.get_input_stream();
          const outputStream = connection.get_output_stream();
          const cancellable = new Gio.Cancellable();

          // Simulate _readLoop: async function awaiting read_bytes_async (will never resolve — no client data)
          async function fakeReadLoop() {
            await new Promise<void>((res) => {
              inputStream.read_bytes_async(4096, GLib.PRIORITY_DEFAULT, cancellable, (_s: any, _r: any) => res());
            });
          }
          fakeReadLoop(); // start but don't await — like _startReading()

          // Now immediately write — does this callback fire despite fakeReadLoop pending?
          outputStream.write_bytes_async(
            new GLib.Bytes(new Uint8Array([1, 2, 3, 4])),
            GLib.PRIORITY_DEFAULT,
            cancellable,
            (_src: any, result: any) => {
              try {
                const n = outputStream.write_bytes_finish(result);
                process.stdout.write('ASYNC_LOOP WRITE OK: ' + n + '\n');
                clearTimeout(deadline);
                cancellable.cancel();
                service.stop();
                resolve({ writeOK: true, timedOut: false });
              } catch (e: any) {
                process.stdout.write('ASYNC_LOOP WRITE ERR: ' + e.message + '\n');
                clearTimeout(deadline);
                cancellable.cancel();
                service.stop();
                resolve({ writeOK: false, timedOut: false });
              }
            }
          );
          return true;
        });

        service.start();
        const client = new Gio.SocketClient();
        client.connect_to_host_async('127.0.0.1:' + port, 0, null, () => {});
      });

      expect(timedOut).toBeFalsy();
      expect(writeOK).toBeTruthy();
    }, { timeout: 5000 });

    // Diagnostic 2b: direct _outputStream.write_bytes_async() inside net.Server handler
    // If this fails but raw Gio (1c) works, the issue is specific to net.Server's socket.
    await it('net.Socket: direct _outputStream.write_bytes_async in server handler', async () => {
      const gjsImports = (globalThis as any).imports;
      if (!gjsImports) { expect(true).toBeTruthy(); return; }
      const GLib = gjsImports.gi.GLib;

      const { writeOK, timedOut } = await new Promise<{ writeOK: boolean; timedOut: boolean }>((resolve) => {
        const deadline = setTimeout(() => resolve({ writeOK: false, timedOut: true }), 3000);
        const server = createServer((conn) => {
          const outputStream = (conn as any)._outputStream;
          const cancellable = (conn as any)._cancellable;
          outputStream.write_bytes_async(
            new GLib.Bytes(new Uint8Array([1, 2, 3, 4])),
            GLib.PRIORITY_DEFAULT,
            cancellable,
            (_src: any, result: any) => {
              try {
                outputStream.write_bytes_finish(result);
                process.stdout.write('DIRECT WRITE OK\n');
                clearTimeout(deadline);
                server.close();
                resolve({ writeOK: true, timedOut: false });
              } catch (e: any) {
                process.stdout.write('DIRECT WRITE ERR: ' + e.message + '\n');
                clearTimeout(deadline);
                server.close();
                resolve({ writeOK: false, timedOut: false });
              }
            }
          );
          conn.on('error', () => {});
        });
        server.listen(0, '127.0.0.1', () => {
          const { port } = server.address() as { port: number };
          connect(port, '127.0.0.1').on('error', () => {});
        });
        server.on('error', () => resolve({ writeOK: false, timedOut: true }));
      });

      expect(timedOut).toBeFalsy();
      expect(writeOK).toBeTruthy();
    }, { timeout: 5000 });

    // Diagnostic 2c: monkey-patch _write to use direct write_bytes_async, then call conn.write()
    // If THIS works but Diagnostic 2d (real _write) doesn't, the issue is in Socket._write() impl.
    // If THIS also fails, the issue is in Duplex_.write() before/around calling _write.
    await it('net.Socket: patched _write with direct write_bytes_async via conn.write()', async () => {
      const gjsImports = (globalThis as any).imports;
      if (!gjsImports) { expect(true).toBeTruthy(); return; }
      const GLib = gjsImports.gi.GLib;

      // Enable nextTick trace to see if GLib.timeout_add fires
      try { (globalThis as any).__gjsify_setNextTickTrace?.(true); } catch {}

      const { writeOK, timedOut } = await new Promise<{ writeOK: boolean; timedOut: boolean }>((resolve) => {
        const deadline = setTimeout(() => resolve({ writeOK: false, timedOut: true }), 3000);
        const server = createServer((conn) => {
          // Replace _write with exact same code as Diagnostic 2b
          (conn as any)._write = function(_chunk: any, _encoding: string, callback: (err?: Error | null) => void) {
            const outputStream = (conn as any)._outputStream;
            const cancellable = (conn as any)._cancellable;
            // Before async: does a timeout_add(0,0) registered BEFORE write_bytes_async fire?
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
              process.stdout.write('BEFORE_ASYNC TIMEOUT_ADD(0) FIRED\n');
              return false;
            });
            outputStream.write_bytes_async(
              new GLib.Bytes(new Uint8Array([1, 2, 3, 4])),
              GLib.PRIORITY_DEFAULT,
              cancellable,
              (_src: any, result: any) => {
                try {
                  outputStream.write_bytes_finish(result);
                  process.stdout.write('PATCHED WRITE OK\n');
                  // After async fires: does a timeout_add fire?
                  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
                    process.stdout.write('AFTER_ASYNC TIMEOUT_ADD(0) FIRED\n');
                    return false;
                  });
                  try {
                    callback(null);
                    process.stdout.write('callback(null) returned OK\n');
                  } catch(e: any) {
                    process.stdout.write('callback(null) THREW: ' + e.message + '\n');
                  }
                  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
                    process.stdout.write('AFTER_CALLBACK TIMEOUT_ADD(0) FIRED\n');
                    return false;
                  });
                } catch (e: any) {
                  process.stdout.write('PATCHED WRITE ERR: ' + e.message + '\n');
                  callback(e);
                }
              }
            );
          };
          conn.write(Buffer.alloc(4, 0x42), (err: Error | null | undefined) => {
            if (err) process.stdout.write('PATCHED CB ERR: ' + err.message + '\n');
            else process.stdout.write('PATCHED CB OK\n');
            clearTimeout(deadline);
            server.close();
            resolve({ writeOK: !err, timedOut: false });
          });
          conn.on('error', () => {});
        });
        server.listen(0, '127.0.0.1', () => {
          const { port } = server.address() as { port: number };
          connect(port, '127.0.0.1').on('error', () => {});
        });
        server.on('error', () => resolve({ writeOK: false, timedOut: true }));
      });
      try { (globalThis as any).__gjsify_setNextTickTrace?.(false); } catch {}
      expect(timedOut).toBeFalsy();
      expect(writeOK).toBeTruthy();
    }, { timeout: 5000 });

    // Diagnostic 2d: conn.write() directly (no setTimeout) in server handler (real _write)
    await it('net.Socket server-to-client data flow', async () => {
      const { received, timedOut } = await new Promise<{ received: number; timedOut: boolean }>((resolve) => {
        const deadline = setTimeout(() => resolve({ received: 0, timedOut: true }), 3000);
        const server = createServer((conn) => {
          conn.write(Buffer.alloc(8, 0x42), (err: Error | null | undefined) => {
            if (err) process.stdout.write('SERVER WRITE ERR: ' + err.message + '\n');
            else process.stdout.write('SERVER WRITE OK\n');
          });
          conn.on('error', () => {});
        });
        server.listen(0, '127.0.0.1', () => {
          const { port } = server.address() as { port: number };
          const conn = connect(port, '127.0.0.1');
          let received = 0;
          conn.on('data', (chunk) => {
            received += chunk.length;
            clearTimeout(deadline);
            server.close();
            conn.destroy();
            resolve({ received, timedOut: false });
          });
          conn.on('error', () => {});
        });
        server.on('error', () => resolve({ received: 0, timedOut: true }));
      });
      expect(timedOut).toBeFalsy();
      expect(received).toBeGreaterThan(0);
    });

    // Diagnostic 3: client → server data flow
    // Server signals receipt by closing → client sees 'end' or 'close'
    await it('net.Socket client-to-server data flow', async () => {
      const { serverGotData, timedOut } = await new Promise<{ serverGotData: boolean; timedOut: boolean }>((resolve) => {
        const deadline = setTimeout(() => resolve({ serverGotData: false, timedOut: true }), 3000);
        let gotData = false;
        const server = createServer((conn) => {
          conn.on('data', () => {
            gotData = true;
            conn.end(); // Signal receipt by closing write side
          });
          conn.on('error', () => {});
        });
        server.listen(0, '127.0.0.1', () => {
          const { port } = server.address() as { port: number };
          const conn = connect(port, '127.0.0.1');
          conn.once('connect', () => conn.write(Buffer.alloc(8, 0x43)));
          conn.on('end', () => {
            clearTimeout(deadline);
            server.close(() => resolve({ serverGotData: gotData, timedOut: false }));
          });
          conn.on('error', () => {});
        });
        server.on('error', () => resolve({ serverGotData: false, timedOut: true }));
      });
      expect(timedOut).toBeFalsy();
      expect(serverGotData).toBeTruthy();
    });

    // Diagnostic 4: bidirectional — client writes, server echoes, client reads
    await it('net.Socket basic TCP echo round-trip', async () => {
      const { received, timedOut } = await new Promise<{ received: string; timedOut: boolean }>((resolve) => {
        const deadline = setTimeout(() => resolve({ received: '', timedOut: true }), 3000);
        const server = createServer((conn) => {
          conn.on('data', (chunk) => conn.write(chunk));
          conn.on('error', () => {});
        });
        server.listen(0, '127.0.0.1', () => {
          const { port } = server.address() as { port: number };
          const conn = connect(port, '127.0.0.1');
          let received = '';
          conn.on('data', (chunk) => {
            received += chunk.toString();
            clearTimeout(deadline);
            server.close();
            conn.destroy();
            resolve({ received, timedOut: false });
          });
          conn.once('connect', () => conn.write(Buffer.from('hello')));
          conn.on('error', () => {});
        });
        server.on('error', () => resolve({ received: '', timedOut: true }));
      });
      expect(timedOut).toBeFalsy();
      expect(received).toBe('hello');
    });

    // Diagnostic 5: streamx.pipeline echo works with @gjsify/net.Socket
    await it('streamx.pipeline echo works with net.Socket', async () => {
      const { received, timedOut } = await new Promise<{ received: number; timedOut: boolean }>((resolve) => {
        const deadline = setTimeout(() => resolve({ received: 0, timedOut: true }), 5000);
        const server = createServer((conn) => {
          const pt = new PassThrough();
          pipeline(conn, pt, conn, () => {});
          conn.on('error', () => {});
        });
        server.listen(0, '127.0.0.1', () => {
          const { port } = server.address() as { port: number };
          const conn = connect(port, '127.0.0.1');
          let received = 0;
          conn.on('data', (chunk) => {
            received += chunk.length;
            if (received >= 16) {
              clearTimeout(deadline);
              server.close();
              conn.destroy();
              resolve({ received, timedOut: false });
            }
          });
          conn.once('connect', () => conn.write(Buffer.alloc(16, 0x42)));
          conn.on('error', () => {});
        });
        server.on('error', () => resolve({ received: 0, timedOut: true }));
      });
      expect(timedOut).toBeFalsy();
      expect(received).toBeGreaterThan(0);
    });

    // Diagnostic 6: Wire handshake (no piece transfer)
    await it('Wire handshake completes over net.Socket', async () => {
      const infoHash = makeInfoHash();
      const seederPeerId = makePeerId(0x01);
      const downloaderPeerId = makePeerId(0x02);

      const { handshakeReceived, timedOut } = await new Promise<{ handshakeReceived: boolean; timedOut: boolean }>((resolve) => {
        const deadline = setTimeout(() => {
          server.close();
          resolve({ handshakeReceived: false, timedOut: true });
        }, 5000);

        const server = createServer((conn) => {
          const seederWire = new Wire() as any;
          pipeline(conn, seederWire, conn, () => {});
          seederWire.handshake(infoHash, seederPeerId);
          seederWire.on('error', () => {});
          conn.on('error', () => {});
        });

        server.listen(0, '127.0.0.1', () => {
          const { port } = server.address() as { port: number };
          const conn = connect(port, '127.0.0.1');

          conn.once('connect', () => {
            const downloaderWire = new Wire() as any;
            pipeline(conn, downloaderWire, conn, () => {});
            downloaderWire.handshake(infoHash, downloaderPeerId);
            downloaderWire.on('handshake', () => {
              clearTimeout(deadline);
              downloaderWire.destroy();
              server.close(() => resolve({ handshakeReceived: true, timedOut: false }));
            });
            downloaderWire.on('error', () => {});
          });

          conn.on('error', () => {});
        });

        server.on('error', () => resolve({ handshakeReceived: false, timedOut: true }));
      });

      expect(timedOut).toBeFalsy();
      expect(handshakeReceived).toBeTruthy();
    }, { timeout: 7000 });

    await it('transfers all pieces over loopback without stalling', async () => {
      const infoHash = makeInfoHash();
      const seederPeerId = makePeerId(0x01);
      const downloaderPeerId = makePeerId(0x02);
      const pieceData = Buffer.alloc(PIECE_SIZE, 0xab);
      const bitfield = makeFullBitfield(NUM_PIECES);

      const { piecesReceived, timedOut } = await new Promise<{ piecesReceived: number; timedOut: boolean }>((resolve) => {
        let server: ReturnType<typeof createServer>;

        const deadline = setTimeout(() => {
          server.close();
          resolve({ piecesReceived: -1, timedOut: true });
        }, TIMEOUT_MS);

        server = createServer((conn) => {
          const seederWire = new Wire() as any;
          pipeline(conn, seederWire, conn, () => {});

          seederWire.handshake(infoHash, seederPeerId);
          seederWire.on('handshake', () => {
            seederWire.bitfield(bitfield);
            seederWire.unchoke();
          });
          seederWire.on('request', (_index: number, _offset: number, _length: number, respond: (err: Error | null, data: Buffer) => void) => {
            respond(null, pieceData);
          });
          seederWire.on('error', () => {});
          conn.on('error', () => {});
        });

        server.listen(0, '127.0.0.1', () => {
          const { port } = server.address() as { port: number };
          let piecesReceived = 0;
          const conn = connect(port, '127.0.0.1');

          conn.once('connect', () => {
            const downloaderWire = new Wire() as any;
            pipeline(conn, downloaderWire, conn, () => {});

            downloaderWire.handshake(infoHash, downloaderPeerId);
            downloaderWire.on('handshake', () => { downloaderWire.interested(); });

            downloaderWire.on('unchoke', () => {
              let pending = NUM_PIECES;
              for (let i = 0; i < NUM_PIECES; i++) {
                downloaderWire.request(i, 0, PIECE_SIZE, (err: Error | null) => {
                  if (!err) piecesReceived++;
                  if (--pending === 0) {
                    clearTimeout(deadline);
                    downloaderWire.destroy();
                    server.close(() => resolve({ piecesReceived, timedOut: false }));
                  }
                });
              }
            });

            downloaderWire.on('error', () => {});
          });

          conn.on('error', () => {});
        });

        server.on('error', () => resolve({ piecesReceived: -1, timedOut: true }));
      });

      expect(timedOut).toBeFalsy();
      expect(piecesReceived).toBe(NUM_PIECES);
    }, { timeout: TIMEOUT_MS + 2000 });

    await it('queueMicrotask or process.nextTick is available for streamx scheduler', async () => {
      // streamx picks its scheduler at module load time:
      //   typeof queueMicrotask !== 'undefined' ? queueMicrotask : (fn) => global.process.nextTick(fn)
      // Node.js: queueMicrotask always available.
      // GJS/SM128: queueMicrotask absent → streamx uses process.nextTick.
      // After fixing nextTick to use microtask semantics, both schedulers work correctly.
      const hasMicrotask = typeof (globalThis as any).queueMicrotask === 'function';
      const hasNextTick = typeof process !== 'undefined' && typeof process.nextTick === 'function';
      expect(hasMicrotask || hasNextTick).toBeTruthy();
    });
  });
};
