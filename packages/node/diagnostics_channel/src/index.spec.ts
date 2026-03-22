import { describe, it, expect } from '@gjsify/unit';
import { channel, hasSubscribers, subscribe, unsubscribe, Channel, TracingChannel } from 'diagnostics_channel';

export default async () => {
  await describe('diagnostics_channel', async () => {
    await describe('Channel', async () => {
      await it('should create a channel with a name', async () => {
        const ch = new Channel('test:channel');
        expect(ch.name).toBe('test:channel');
        expect(ch.hasSubscribers).toBe(false);
      });

      await it('should publish messages to subscribers', async () => {
        const ch = new Channel('test:publish');
        const messages: unknown[] = [];
        ch.subscribe((msg) => messages.push(msg));
        ch.publish('hello');
        ch.publish({ data: 42 });
        expect(messages.length).toBe(2);
        expect(messages[0]).toBe('hello');
      });

      await it('should support unsubscribe', async () => {
        const ch = new Channel('test:unsub');
        const messages: unknown[] = [];
        const handler = (msg: unknown) => messages.push(msg);
        ch.subscribe(handler);
        ch.publish('a');
        ch.unsubscribe(handler);
        ch.publish('b');
        expect(messages.length).toBe(1);
      });
    });

    await describe('channel() function', async () => {
      await it('should return the same channel for the same name', async () => {
        const a = channel('test:singleton');
        const b = channel('test:singleton');
        expect(a).toBe(b);
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

    await describe('TracingChannel', async () => {
      await it('should trace synchronous functions', async () => {
        const tc = new TracingChannel('test:trace');
        const events: string[] = [];
        tc.subscribe({
          start: () => events.push('start'),
          end: () => events.push('end'),
          error: () => events.push('error'),
        });
        const result = tc.traceSync(() => 42);
        expect(result).toBe(42);
        expect(events.length).toBe(2);
        expect(events[0]).toBe('start');
        expect(events[1]).toBe('end');
      });

      await it('should trace errors', async () => {
        const tc = new TracingChannel('test:trace:err');
        const events: string[] = [];
        tc.subscribe({
          start: () => events.push('start'),
          error: () => events.push('error'),
        });
        let threw = false;
        try {
          tc.traceSync(() => { throw new Error('boom'); });
        } catch {
          threw = true;
        }
        expect(threw).toBe(true);
        expect(events).toContain('start');
        expect(events).toContain('error');
      });
    });
  });
};
