import { describe, it, expect } from '@gjsify/unit';
import { channel, hasSubscribers, subscribe, unsubscribe, tracingChannel } from 'node:diagnostics_channel';

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

      await it('should have asyncStart and asyncEnd channels', async () => {
        const tc = tracingChannel('test:trace:async:' + Date.now());
        expect(tc.asyncStart).toBeDefined();
        expect(tc.asyncEnd).toBeDefined();
      });

      await it('traceSync should publish to start and end channels', async () => {
        const tc = tracingChannel('test:tracesync:' + Date.now());
        const events: string[] = [];
        tc.start.subscribe(() => events.push('start'));
        tc.end.subscribe(() => events.push('end'));
        tc.traceSync(() => {}, {});
        expect(events.length).toBe(2);
        expect(events[0]).toBe('start');
        expect(events[1]).toBe('end');
      });

      await it('traceSync should publish to error channel on throw', async () => {
        const tc = tracingChannel('test:tracesync:err:' + Date.now());
        let errorReceived = false;
        tc.error.subscribe(() => { errorReceived = true; });
        try {
          tc.traceSync(() => { throw new Error('test'); }, {});
        } catch {
          // expected
        }
        expect(errorReceived).toBeTruthy();
      });
    });

    // Additional tests ported from refs/node-test

    await describe('multiple subscribers', async () => {
      await it('should notify all subscribers', async () => {
        const ch = channel('test:multi:' + Date.now());
        let count = 0;
        ch.subscribe(() => { count++; });
        ch.subscribe(() => { count++; });
        ch.subscribe(() => { count++; });
        ch.publish('msg');
        expect(count).toBe(3);
      });
    });

    await describe('channel hasSubscribers lifecycle', async () => {
      await it('should track subscriber count correctly', async () => {
        const ch = channel('test:lifecycle:' + Date.now());
        expect(ch.hasSubscribers).toBeFalsy();
        const fn1 = () => {};
        const fn2 = () => {};
        ch.subscribe(fn1);
        expect(ch.hasSubscribers).toBeTruthy();
        ch.subscribe(fn2);
        expect(ch.hasSubscribers).toBeTruthy();
        ch.unsubscribe(fn1);
        expect(ch.hasSubscribers).toBeTruthy();
        ch.unsubscribe(fn2);
        expect(ch.hasSubscribers).toBeFalsy();
      });
    });

    await describe('subscriber receives correct data', async () => {
      await it('should pass message data faithfully', async () => {
        const ch = channel('test:data:' + Date.now());
        let received: any = null;
        ch.subscribe((msg: unknown) => { received = msg; });
        const obj = { key: 'value', num: 42 };
        ch.publish(obj);
        expect(received).toBe(obj);
      });
    });
  });
};
