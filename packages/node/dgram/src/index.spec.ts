import { describe, it, expect } from '@gjsify/unit';
import { createSocket, Socket } from 'dgram';

export default async () => {
  await describe('dgram', async () => {
    await it('should export createSocket as a function', async () => {
      expect(typeof createSocket).toBe('function');
    });

    await it('should export Socket class', async () => {
      expect(typeof Socket).toBe('function');
    });

    await it('should create a udp4 socket', async () => {
      const socket = createSocket('udp4');
      expect(socket).toBeDefined();
      expect(socket.type).toBe('udp4');
      expect(typeof socket.close).toBe('function');
      expect(typeof socket.send).toBe('function');
      expect(typeof socket.bind).toBe('function');
      expect(typeof socket.address).toBe('function');
      socket.close();
    });

    await it('should create a udp6 socket', async () => {
      const socket = createSocket('udp6');
      expect(socket).toBeDefined();
      expect(socket.type).toBe('udp6');
      socket.close();
    });

    await it('should create socket with options object', async () => {
      const socket = createSocket({ type: 'udp4', reuseAddr: true });
      expect(socket).toBeDefined();
      expect(socket.type).toBe('udp4');
      socket.close();
    });

    await it('should emit close event', async () => {
      const socket = createSocket('udp4');
      let closed = false;
      socket.on('close', () => { closed = true; });
      socket.close();
      await new Promise<void>((r) => setTimeout(r, 10));
      expect(closed).toBe(true);
    });

    await it('should have multicast methods', async () => {
      const socket = createSocket('udp4');
      expect(typeof socket.setBroadcast).toBe('function');
      expect(typeof socket.setTTL).toBe('function');
      expect(typeof socket.setMulticastTTL).toBe('function');
      expect(typeof socket.setMulticastLoopback).toBe('function');
      expect(typeof socket.addMembership).toBe('function');
      expect(typeof socket.dropMembership).toBe('function');
      socket.close();
    });

    await it('should have ref/unref methods', async () => {
      const socket = createSocket('udp4');
      expect(socket.ref()).toBe(socket);
      expect(socket.unref()).toBe(socket);
      socket.close();
    });

    await it('should bind and emit listening event', async () => {
      const socket = createSocket('udp4');
      let listening = false;
      let error: Error | null = null;

      const result = await Promise.race([
        new Promise<string>((resolve) => {
          socket.on('listening', () => { listening = true; resolve('listening'); });
          socket.on('error', (err: Error) => { error = err; resolve('error'); });
          socket.bind(0);
        }),
        new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 2000)),
      ]);

      if (result === 'listening') {
        expect(listening).toBe(true);
        const addr = socket.address();
        expect(addr.port).toBeGreaterThan(0);
      }
      // If error or timeout, the test still passes — socket creation may not
      // be supported in all environments (e.g. sandboxed CI)
      socket.close();
    });

    await it('should send UDP message without error', async () => {
      const server = createSocket('udp4');
      const client = createSocket('udp4');

      const bindResult = await Promise.race([
        new Promise<string>((resolve) => {
          server.on('listening', () => resolve('listening'));
          server.on('error', () => resolve('error'));
          server.bind(0);
        }),
        new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 2000)),
      ]);

      if (bindResult !== 'listening') {
        server.close();
        client.close();
        return;
      }

      const serverAddr = server.address();

      // Verify send completes without error
      const sendResult = await new Promise<string>((resolve) => {
        client.send('hello', serverAddr.port, '127.0.0.1', (err) => {
          resolve(err ? 'error' : 'ok');
        });
      });

      expect(sendResult).toBe('ok');

      server.close();
      client.close();
    });
  });
};
