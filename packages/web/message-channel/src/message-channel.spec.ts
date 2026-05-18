// W3C MessageChannel + MessagePort — in-process behavior tests.
// Cross-platform: runs on both Node (uses native MessageChannel via the
// globals.mjs re-export path) and GJS (uses our impl).

import { describe, it, expect } from '@gjsify/unit';
import { MessageChannel, MessagePort } from './index.js';

export default async () => {

  await describe('MessageChannel — construction', async () => {

    await it('creates two linked ports', async () => {
      const ch = new MessageChannel();
      expect(ch.port1 instanceof MessagePort).toBe(true);
      expect(ch.port2 instanceof MessagePort).toBe(true);
      expect(ch.port1 === (ch.port2 as unknown)).toBe(false);
    });

    await it('Symbol.toStringTag identifies both classes', async () => {
      const ch = new MessageChannel();
      expect(Object.prototype.toString.call(ch)).toBe('[object MessageChannel]');
      expect(Object.prototype.toString.call(ch.port1)).toBe('[object MessagePort]');
    });
  });

  await describe('MessagePort — bidirectional in-process traffic', async () => {

    await it('message posted on port1 arrives on port2', async () => {
      const ch = new MessageChannel();
      const received = await new Promise<unknown>((resolve) => {
        ch.port2.addEventListener('message', (e) => {
          resolve((e as any).data);
        });
        ch.port1.postMessage({ hello: 'world' });
      });
      expect((received as { hello: string }).hello).toBe('world');
    });

    await it('message posted on port2 arrives on port1', async () => {
      const ch = new MessageChannel();
      const received = await new Promise<unknown>((resolve) => {
        ch.port1.addEventListener('message', (e) => {
          resolve((e as any).data);
        });
        ch.port2.postMessage(42);
      });
      expect(received).toBe(42);
    });

    await it('messages sent before listener attaches queue + replay', async () => {
      const ch = new MessageChannel();
      ch.port1.postMessage('first');
      ch.port1.postMessage('second');
      const messages: unknown[] = [];
      await new Promise<void>((resolve) => {
        ch.port2.addEventListener('message', (e) => {
          messages.push((e as any).data);
          if (messages.length === 2) resolve();
        });
      });
      expect(messages[0]).toBe('first');
      expect(messages[1]).toBe('second');
    });
  });

  await describe('MessagePort — lifecycle', async () => {

    await it('close() detaches the partner; subsequent messages drop', async () => {
      const ch = new MessageChannel();
      const received: unknown[] = [];
      ch.port2.addEventListener('message', (e) => {
        received.push((e as any).data);
      });
      ch.port1.postMessage('before-close');
      await new Promise(r => setTimeout(r, 10));
      ch.port2.close();
      ch.port1.postMessage('after-close');
      await new Promise(r => setTimeout(r, 10));
      expect(received.length).toBe(1);
      expect(received[0]).toBe('before-close');
    });

    await it('explicit start() is idempotent', async () => {
      const ch = new MessageChannel();
      ch.port1.start();
      ch.port1.start();
      expect(true).toBe(true);
    });
  });

  await describe('MessagePort — onmessage IDL attribute', async () => {

    await it('onmessage setter wires up the message handler', async () => {
      const ch = new MessageChannel();
      const received = await new Promise<unknown>((resolve) => {
        ch.port2.onmessage = (e) => resolve((e as any).data);
        ch.port1.postMessage('via onmessage');
      });
      expect(received).toBe('via onmessage');
    });

    await it('onmessage setter swaps cleanly when replaced', async () => {
      const ch = new MessageChannel();
      let count1 = 0;
      let count2 = 0;
      ch.port2.onmessage = () => { count1++; };
      ch.port2.onmessage = () => { count2++; };
      ch.port1.postMessage('a');
      await new Promise(r => setTimeout(r, 10));
      expect(count1).toBe(0);
      expect(count2).toBe(1);
    });

    await it('onmessage = null detaches the handler', async () => {
      const ch = new MessageChannel();
      let count = 0;
      ch.port2.onmessage = () => { count++; };
      ch.port2.onmessage = null;
      ch.port1.postMessage('ignored');
      await new Promise(r => setTimeout(r, 10));
      expect(count).toBe(0);
    });
  });
};
