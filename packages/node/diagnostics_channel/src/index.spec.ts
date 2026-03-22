import { describe, it, expect } from '@gjsify/unit';
import { channel, hasSubscribers, subscribe, unsubscribe, tracingChannel } from 'diagnostics_channel';

export default async () => {
  await describe('diagnostics_channel', async () => {
    await describe('channel() function', async () => {
      await it('should return a channel with a name', async () => {
        const ch = channel('test:channel:' + Date.now());
        expect(ch.name).toBeDefined();
        expect(ch.hasSubscribers).toBe(false);
      });

      await it('should return the same channel for the same name', async () => {
        const name = 'test:singleton:' + Date.now();
        const a = channel(name);
        const b = channel(name);
        expect(a).toBe(b);
      });

      await it('should publish messages to subscribers', async () => {
        const ch = channel('test:publish:' + Date.now());
        const messages: unknown[] = [];
        ch.subscribe((msg: unknown) => messages.push(msg));
        ch.publish('hello');
        ch.publish({ data: 42 });
        expect(messages.length).toBe(2);
        expect(messages[0]).toBe('hello');
      });

      await it('should support unsubscribe', async () => {
        const ch = channel('test:unsub:' + Date.now());
        const messages: unknown[] = [];
        const handler = (msg: unknown) => messages.push(msg);
        ch.subscribe(handler);
        ch.publish('a');
        ch.unsubscribe(handler);
        ch.publish('b');
        expect(messages.length).toBe(1);
      });
    });

    await describe('hasSubscribers', async () => {
      await it('should return false for unknown channel', async () => {
        expect(hasSubscribers('test:unknown:' + Date.now())).toBe(false);
      });

      await it('should return true when channel has subscribers', async () => {
        const name = 'test:hassub:' + Date.now();
        subscribe(name, () => {});
        expect(hasSubscribers(name)).toBe(true);
      });
    });

    await describe('subscribe/unsubscribe functions', async () => {
      await it('should subscribe and receive messages', async () => {
        const name = 'test:sub:' + Date.now();
        const messages: unknown[] = [];
        const handler = (msg: unknown) => messages.push(msg);
        subscribe(name, handler);
        channel(name).publish('test');
        expect(messages.length).toBe(1);
        unsubscribe(name, handler);
      });
    });

    await describe('tracingChannel', async () => {
      await it('should create a tracing channel', async () => {
        const tc = tracingChannel('test:trace:' + Date.now());
        expect(tc).toBeDefined();
        expect(tc.start).toBeDefined();
        expect(tc.end).toBeDefined();
        expect(tc.error).toBeDefined();
      });
    });
  });
};
