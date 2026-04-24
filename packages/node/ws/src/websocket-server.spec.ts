// SPDX-License-Identifier: MIT
// Ported from refs/ws/test/websocket-server.test.js
// Original: Copyright (c) 2011+ Einar Otto Stangvik. MIT.
// Rewritten for @gjsify/unit — behavior preserved, scope narrowed to
// verifyClient, handleProtocols, and { server } mode supported by Phase 2.

import { describe, it, expect, on } from '@gjsify/unit';
import { WebSocket, WebSocketServer } from 'ws';

export default async () => {
  await on('Gjs', async () => {
    // ── verifyClient ──────────────────────────────────────────────────────

    await describe('WebSocketServer verifyClient sync', async () => {
      await it('sync reject: client receives error, server never emits connection', async () => {
        const wss = new WebSocketServer({
          port: 0,
          verifyClient: () => false,
        });

        await new Promise<void>((resolve) => {
          wss.on('listening', () => {
            const addr = wss.address() as { address: string; family: string; port: number };
            let connectionEmitted = false;
            wss.on('connection', () => { connectionEmitted = true; });

            const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/`);
            ws.on('error', () => {
              setTimeout(() => {
                expect(connectionEmitted).toBe(false);
                wss.close();
                resolve();
              }, 50);
            });
          });
        });
      });

      await it('sync accept: server emits connection', async () => {
        const wss = new WebSocketServer({
          port: 0,
          verifyClient: () => true,
        });

        await new Promise<void>((resolve) => {
          wss.on('listening', () => {
            const addr = wss.address() as { address: string; family: string; port: number };
            wss.on('connection', () => {
              wss.close();
              resolve();
            });
            const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/`);
            ws.on('error', () => {});
          });
        });
      });
    });

    await describe('WebSocketServer verifyClient async', async () => {
      await it('async reject with 403: client receives error, no connection emitted', async () => {
        const wss = new WebSocketServer({
          port: 0,
          verifyClient: (_info: any, cb: any) => { cb(false, 403); },
        });

        await new Promise<void>((resolve) => {
          wss.on('listening', () => {
            const addr = wss.address() as { address: string; family: string; port: number };
            let connectionEmitted = false;
            wss.on('connection', () => { connectionEmitted = true; });

            const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/`);
            ws.on('error', () => {
              setTimeout(() => {
                expect(connectionEmitted).toBe(false);
                wss.close();
                resolve();
              }, 50);
            });
          });
        });
      });

      await it('async accept: server emits connection', async () => {
        const wss = new WebSocketServer({
          port: 0,
          verifyClient: (_info: any, cb: any) => { cb(true); },
        });

        await new Promise<void>((resolve) => {
          wss.on('listening', () => {
            const addr = wss.address() as { address: string; family: string; port: number };
            wss.on('connection', () => {
              wss.close();
              resolve();
            });
            const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/`);
            ws.on('error', () => {});
          });
        });
      });

      await it('populates verifyClient info fields (origin, req.url, req.headers)', async () => {
        let capturedInfo: any = null;

        const wss = new WebSocketServer({
          port: 0,
          verifyClient: (info: any) => {
            capturedInfo = info;
            return true;
          },
        });

        await new Promise<void>((resolve) => {
          wss.on('listening', () => {
            const addr = wss.address() as { address: string; family: string; port: number };
            wss.on('connection', () => {
              expect(typeof capturedInfo).toBe('object');
              expect(capturedInfo).not.toBeNull();
              expect(typeof capturedInfo.origin).toBe('string');
              expect(typeof capturedInfo.secure).toBe('boolean');
              expect(capturedInfo.secure).toBe(false);
              expect(typeof capturedInfo.req).toBe('object');
              expect(typeof capturedInfo.req.url).toBe('string');
              expect(typeof capturedInfo.req.method).toBe('string');
              expect(capturedInfo.req.method).toBe('GET');
              expect(typeof capturedInfo.req.headers).toBe('object');
              wss.close();
              resolve();
            });

            const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/`);
            ws.on('error', () => {});
          });
        });
      });
    });

    // ── handleProtocols ───────────────────────────────────────────────────

    await describe('WebSocketServer handleProtocols', async () => {
      await it('server-side ws.protocol reflects selected subprotocol', async () => {
        let serverProtocol = '';

        const wss = new WebSocketServer({
          port: 0,
          handleProtocols: (protocols: Set<string>) => {
            // Prefer 'bar' over 'foo'
            if (protocols.has('bar')) return 'bar';
            return false;
          },
        });

        await new Promise<void>((resolve) => {
          wss.on('listening', () => {
            const addr = wss.address() as { address: string; family: string; port: number };
            wss.on('connection', (ws: any) => {
              serverProtocol = ws.protocol;
              ws.close();
              wss.close();
              resolve();
            });

            const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/`, ['foo', 'bar']);
            ws.on('error', () => {});
          });
        });

        expect(serverProtocol).toBe('bar');
      });
    });

    // ── { server } mode ───────────────────────────────────────────────────

    await describe('WebSocketServer { server } mode', async () => {
      await it('attaches to a shared Soup.Server; WebSocket echo works', async () => {
        // We test the { server } mode by creating a WebSocketServer and attaching it
        // to an existing Soup.Server via the soupServer getter.
        // The WebSocketServer emits 'connection' with a ServerSideWebSocket for each
        // new connection. We verify that message echo works end-to-end.
        const Soup3 = (await import('@girs/soup-3.0')).default;
        const GLib2 = (await import('@girs/glib-2.0')).default;

        // Create the raw server, register our handler, THEN listen — matching
        // the standalone WebSocketServer initialization order.
        const rawSoup = new Soup3.Server({});

        let actualPort = 0;
        const fakeHttpServer: any = {
          soupServer: rawSoup,
          address: () => actualPort ? { address: '127.0.0.1', family: 'IPv4', port: actualPort } : null,
        };

        const wss = new WebSocketServer({ server: fakeHttpServer, path: '/ws' });

        rawSoup.listen_local(0, Soup3.ServerListenOptions.IPV4_ONLY);
        actualPort = (rawSoup.get_listeners()[0].get_local_address() as any).get_port();

        // Use a raw Soup.Session for the client to avoid any @gjsify/ws wrapper effects
        await new Promise<void>((resolve, reject) => {
          wss.on('connection', (ws: any) => {
            ws.on('error', (err: Error) => reject(err));
            ws.on('message', (msg: any) => {
              ws.send(String(msg));
            });
          });

          wss.on('listening', () => {
            // Use a raw Soup.Session WebSocket client to sidestep any wrapper
            const session = new Soup3.Session();
            const uri = GLib2.Uri.parse(`ws://127.0.0.1:${actualPort}/ws`, GLib2.UriFlags.NONE);
            const soupMsg = new Soup3.Message({ method: 'GET', uri });
            session.websocket_connect_async(
              soupMsg, null, null,
              GLib2.PRIORITY_DEFAULT, null,
              (_self: unknown, asyncRes: any) => {
                try {
                  const conn = session.websocket_connect_finish(asyncRes);
                  // Send 'hello-shared' after connection
                  const bytes = new TextEncoder().encode('hello-shared');
                  conn.send_message(Soup3.WebsocketDataType.TEXT, new GLib2.Bytes(bytes));

                  conn.connect('message', (_c: any, type: number, data: any) => {
                    const text = new TextDecoder().decode(data.toArray());
                    expect(text).toBe('hello-shared');
                    conn.close(1000, null);
                    wss.close();
                    rawSoup.disconnect();
                    resolve();
                  });

                  conn.connect('error', (_c: any, err: any) => {
                    wss.close();
                    rawSoup.disconnect();
                    reject(new Error(err.message));
                  });
                } catch (err: any) {
                  wss.close();
                  rawSoup.disconnect();
                  reject(err instanceof Error ? err : new Error(String(err)));
                }
              },
            );
          });

          wss.on('error', (err: Error) => {
            rawSoup.disconnect();
            reject(err);
          });
        });
      });
    });
  });
};
