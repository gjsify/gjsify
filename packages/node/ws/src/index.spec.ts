// SPDX-License-Identifier: MIT
// Ported from refs/ws/test/websocket.test.js and websocket-server.test.js
// Original: Copyright (c) 2011+ Einar Otto Stangvik. MIT.
// Rewritten for @gjsify/unit — behavior preserved, scope narrowed to the
// surface that @gjsify/ws implements on top of Soup.WebsocketConnection.

import { describe, it, expect, on } from '@gjsify/unit';
// `ws` resolves to the real npm package on Node (validates the ws-API
// surface our wrapper targets) and to @gjsify/ws on GJS (via the alias
// in @gjsify/resolve-npm) — so the same spec exercises both.
// @ts-ignore — @types/ws declares WebSocket as the default export in some
// versions and not in others. The runtime is correct on both paths
// (the npm package does `module.exports = WebSocket` in CJS land).
import ws, { WebSocket, WebSocketServer } from 'ws';

/** Construct a WebSocket that attempts to connect to a non-routable address.
 *  We silence 'error' so the inevitable connection failure (after close())
 *  doesn't show up as an unhandled rejection in the test output. Tests that
 *  specifically care about errors re-attach a listener. */
function makeDeadSocket(): WebSocket {
  const s = new WebSocket('ws://example.invalid:1');
  s.on('error', () => {});
  return s;
}

export default async () => {
  await describe('@gjsify/ws module exports', async () => {
    await it('default export is the WebSocket class', async () => {
      expect(typeof ws).toBe('function');
    });

    await it('named WebSocket export equals the default export', async () => {
      expect(ws).toBe(WebSocket);
    });

    // ws's own index.js runs `WebSocket.WebSocket = WebSocket` etc. at load.
    // Real npm ws exposes these via CJS but Node's ESM↔CJS bridge does NOT
    // surface post-load property assignments as static named exports, so on
    // Node these appear as `undefined` on the default export. Our @gjsify/ws
    // is authored as ESM from the start and preserves them, so we assert the
    // self-references on GJS where the wrapper is actually loaded.
    await on('Gjs', async () => {
      await it('GJS: WebSocket.WebSocket self-reference matches ws-npm pattern', async () => {
        expect((WebSocket as any).WebSocket).toBe(WebSocket);
      });

      await it('GJS: WebSocket.Server is an alias for WebSocketServer', async () => {
        expect((WebSocket as any).Server).toBe(WebSocketServer);
      });
    });

    await it('typeof ws === "function" satisfies simple-websocket heuristic', async () => {
      // simple-websocket does:
      //   const _WebSocket = typeof ws !== 'function' ? globalThis.WebSocket : ws
      // Our drop-in must land on the `ws` branch so consumer sees a real class.
      expect(typeof ws).toBe('function');
    });
  });

  await describe('WebSocket constants', async () => {
    await it('exposes readyState constants on the class', async () => {
      expect(WebSocket.CONNECTING).toBe(0);
      expect(WebSocket.OPEN).toBe(1);
      expect(WebSocket.CLOSING).toBe(2);
      expect(WebSocket.CLOSED).toBe(3);
    });

    await it('exposes readyState constants on instances', async () => {
      // Construct with an unusable URL so we don't trigger a real connection
      // during a unit test; instance properties are set in the constructor
      // independently of connection state.
      const s = new WebSocket('ws://localhost:1');
      expect(s.CONNECTING).toBe(0);
      expect(s.OPEN).toBe(1);
      expect(s.CLOSING).toBe(2);
      expect(s.CLOSED).toBe(3);
      s.close();
    });
  });

  await describe('WebSocket construction', async () => {
    await it('stores the url string', async () => {
      const s = new WebSocket('ws://example.invalid:1/path');
      expect(s.url).toBe('ws://example.invalid:1/path');
      s.close();
    });

    await it('stores the url from a URL object', async () => {
      const url = new URL('ws://example.invalid:1/u');
      const s = new WebSocket(url);
      expect(s.url).toContain('ws://example.invalid:1');
      s.close();
    });

    await it('starts in CONNECTING state', async () => {
      const s = makeDeadSocket();
      expect(s.readyState).toBe(WebSocket.CONNECTING);
      s.close();
    });

    await it('default binaryType is "nodebuffer"', async () => {
      const s = makeDeadSocket();
      expect(s.binaryType).toBe('nodebuffer');
      s.close();
    });
  });

  await describe('WebSocket.send() while CONNECTING', async () => {
    await it('throws synchronously (matches npm ws)', async () => {
      const s = makeDeadSocket();
      expect(() => s.send('hello')).toThrow();
      s.close();
    });

    await it('throws synchronously even when a callback is provided', async () => {
      // Real npm ws throws sync in both cases — the callback form is for
      // reporting *send*-time errors once CONNECTED, not to swallow the
      // not-open error.
      const s = makeDeadSocket();
      expect(() => s.send('hello', () => {})).toThrow();
      s.close();
    });
  });

  await on('Gjs', async () => {
    await describe('GJS: WebSocketServer option validation', async () => {
      await it('throws when given { noServer: true }', async () => {
        expect(() => new WebSocketServer({ noServer: true })).toThrow();
      });
    });
  });

  // Missing port is not Phase-1-specific — real npm ws also requires it (or
  // a `server`/`noServer` alternative). Cross-platform.
  await describe('WebSocketServer required options', async () => {
    await it('throws when nothing is given', async () => {
      expect(() => new WebSocketServer({})).toThrow();
    });
  });
};
