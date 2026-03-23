// Tests for W3C WebSocket API
// Ported from WHATWG WebSocket spec requirements
// Note: @gjsify/websocket uses Soup 3.0 — tests run only on GJS

import { describe, it, expect } from '@gjsify/unit';
import GLib from '@girs/glib-2.0';
import Soup from '@girs/soup-3.0';
import { WebSocket, MessageEvent, CloseEvent } from './index.js';

export default async () => {

  // --- WebSocket class ---
  await describe('WebSocket', async () => {
    await it('should be a constructor', async () => {
      expect(typeof WebSocket).toBe('function');
    });

    await it('should have readyState constants', async () => {
      expect(WebSocket.CONNECTING).toBe(0);
      expect(WebSocket.OPEN).toBe(1);
      expect(WebSocket.CLOSING).toBe(2);
      expect(WebSocket.CLOSED).toBe(3);
    });
  });

  // --- MessageEvent ---
  await describe('MessageEvent', async () => {
    await it('should be constructable', async () => {
      const event = new MessageEvent('message', { data: 'hello' });
      expect(event.type).toBe('message');
      expect(event.data).toBe('hello');
    });

    await it('should have origin and lastEventId', async () => {
      const event = new MessageEvent('message', {
        data: 'test',
        origin: 'ws://example.com',
        lastEventId: '42',
      });
      expect(event.origin).toBe('ws://example.com');
      expect(event.lastEventId).toBe('42');
    });

    await it('should default origin and lastEventId to empty string', async () => {
      const event = new MessageEvent('message', { data: 'x' });
      expect(event.origin).toBe('');
      expect(event.lastEventId).toBe('');
    });

    await it('should support ArrayBuffer data', async () => {
      const buffer = new ArrayBuffer(4);
      const event = new MessageEvent('message', { data: buffer });
      expect(event.data).toBe(buffer);
    });
  });

  // --- CloseEvent ---
  await describe('CloseEvent', async () => {
    await it('should be constructable', async () => {
      const event = new CloseEvent('close');
      expect(event.type).toBe('close');
    });

    await it('should have code, reason, wasClean', async () => {
      const event = new CloseEvent('close', {
        code: 1000,
        reason: 'normal',
        wasClean: true,
      });
      expect(event.code).toBe(1000);
      expect(event.reason).toBe('normal');
      expect(event.wasClean).toBe(true);
    });

    await it('should default to 1000, empty reason, wasClean=false', async () => {
      const event = new CloseEvent('close');
      expect(event.code).toBe(1000);
      expect(event.reason).toBe('');
      expect(event.wasClean).toBe(false);
    });
  });

  // --- WebSocket round-trip ---
  await describe('WebSocket round-trip', async () => {
    await it('should connect, send, receive, and close', async () => {
      const server = new Soup.Server({});
      server.add_websocket_handler('/ws', null, null,
        (_srv: Soup.Server, _msg: Soup.ServerMessage, _path: string, connection: Soup.WebsocketConnection) => {
          connection.connect('message', (_conn: Soup.WebsocketConnection, _type: number, message: GLib.Bytes) => {
            const text = new TextDecoder().decode(message.toArray());
            connection.send_text(text);
          });
        },
      );
      server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
      const port = (server.get_listeners()[0].get_local_address() as any).get_port();

      const result = await new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        ws.onopen = () => ws.send('hello websocket');
        ws.onmessage = (event: any) => { ws.close(); resolve(event.data); };
        ws.onerror = () => reject(new Error('WebSocket error'));
        setTimeout(() => reject(new Error('Timeout')), 5000);
      });

      expect(result).toBe('hello websocket');
      server.disconnect();
    });

    await it('should handle binary data', async () => {
      const server = new Soup.Server({});
      server.add_websocket_handler('/ws', null, null,
        (_srv: Soup.Server, _msg: Soup.ServerMessage, _path: string, connection: Soup.WebsocketConnection) => {
          connection.connect('message', (_conn: Soup.WebsocketConnection, _type: number, message: GLib.Bytes) => {
            connection.send_binary(message.toArray());
          });
        },
      );
      server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
      const port = (server.get_listeners()[0].get_local_address() as any).get_port();

      const result = await new Promise<ArrayBuffer>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => ws.send(new Uint8Array([1, 2, 3, 4, 5]).buffer);
        ws.onmessage = (event: any) => { ws.close(); resolve(event.data); };
        ws.onerror = () => reject(new Error('WebSocket error'));
        setTimeout(() => reject(new Error('Timeout')), 5000);
      });

      const arr = new Uint8Array(result);
      expect(arr.length).toBe(5);
      expect(arr[0]).toBe(1);
      expect(arr[4]).toBe(5);
      server.disconnect();
    });

    await it('should report close code', async () => {
      const server = new Soup.Server({});
      server.add_websocket_handler('/ws', null, null,
        (_srv: Soup.Server, _msg: Soup.ServerMessage, _path: string, connection: Soup.WebsocketConnection) => {
          connection.close(1000, 'server done');
        },
      );
      server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
      const port = (server.get_listeners()[0].get_local_address() as any).get_port();

      const result = await new Promise<number>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        ws.onclose = (event: any) => resolve(event.code);
        ws.onerror = () => reject(new Error('WebSocket error'));
        setTimeout(() => reject(new Error('Timeout')), 5000);
      });

      expect(result).toBe(1000);
      server.disconnect();
    });
  });

  // --- Module exports ---
  await describe('WebSocket module exports', async () => {
    await it('should export WebSocket class', async () => {
      expect(typeof WebSocket).toBe('function');
    });

    await it('should export MessageEvent class', async () => {
      expect(typeof MessageEvent).toBe('function');
    });

    await it('should export CloseEvent class', async () => {
      expect(typeof CloseEvent).toBe('function');
    });
  });
};
