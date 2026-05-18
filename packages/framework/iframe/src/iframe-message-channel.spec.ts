// Tests for IFrameMessageChannel / IFrameMessagePort — in-process
// channel semantics (port pair without ever transferring). The WebView-
// routed path requires a live WebKit.WebView so is covered separately
// by the bridge integration test surface (not exercised in unit tests).

import { describe, it, expect } from '@gjsify/unit';
import { IFrameMessageChannel, IFrameMessagePort } from './iframe-message-channel.js';

export default async () => {

  await describe('IFrameMessageChannel — in-process behavior', async () => {

    await it('creates two linked ports', async () => {
      const ch = new IFrameMessageChannel();
      expect(ch.port1 instanceof IFrameMessagePort).toBe(true);
      expect(ch.port2 instanceof IFrameMessagePort).toBe(true);
      expect(ch.port1).not.toBe(ch.port2 as unknown);
    });

    await it('message posted on port1 arrives on port2', async () => {
      const ch = new IFrameMessageChannel();
      const received = await new Promise<unknown>((resolve) => {
        ch.port2.addEventListener('message', (e: unknown) => {
          resolve((e as { data: unknown }).data);
        });
        ch.port1.postMessage({ hello: 'world' });
      });
      expect((received as { hello: string }).hello).toBe('world');
    });

    await it('bidirectional traffic — port2 → port1 also works', async () => {
      const ch = new IFrameMessageChannel();
      const received = await new Promise<unknown>((resolve) => {
        ch.port1.addEventListener('message', (e: unknown) => {
          resolve((e as { data: unknown }).data);
        });
        ch.port2.postMessage(42);
      });
      expect(received).toBe(42);
    });

    await it('messages sent before addEventListener queue and replay on listen', async () => {
      const ch = new IFrameMessageChannel();
      ch.port1.postMessage('first');
      ch.port1.postMessage('second');
      const messages: unknown[] = [];
      await new Promise<void>((resolve) => {
        ch.port2.addEventListener('message', (e: unknown) => {
          messages.push((e as { data: unknown }).data);
          if (messages.length === 2) resolve();
        });
      });
      expect(messages[0]).toBe('first');
      expect(messages[1]).toBe('second');
    });

    await it('close() detaches the partner; subsequent messages drop', async () => {
      const ch = new IFrameMessageChannel();
      const received: unknown[] = [];
      ch.port2.addEventListener('message', (e: unknown) => {
        received.push((e as { data: unknown }).data);
      });
      ch.port1.postMessage('before-close');
      await new Promise(r => setTimeout(r, 5));
      ch.port2.close();
      ch.port1.postMessage('after-close');
      await new Promise(r => setTimeout(r, 5));
      expect(received.length).toBe(1);
      expect(received[0]).toBe('before-close');
    });

    await it('explicit start() is idempotent', async () => {
      const ch = new IFrameMessageChannel();
      ch.port1.start();
      ch.port1.start();
      // No throw, no double-anything.
      expect(true).toBe(true);
    });

    await it('Symbol.toStringTag identifies the types', async () => {
      const ch = new IFrameMessageChannel();
      expect(Object.prototype.toString.call(ch)).toBe('[object MessageChannel]');
      expect(Object.prototype.toString.call(ch.port1)).toBe('[object MessagePort]');
    });
  });
};
