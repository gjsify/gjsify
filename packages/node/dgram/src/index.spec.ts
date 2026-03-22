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

    await it('should return address info after bind', async () => {
      const socket = createSocket('udp4');

      await new Promise<void>((resolve) => {
        socket.on('listening', resolve);
        socket.bind(0);
      });

      const addr = socket.address();
      expect(addr).toBeDefined();
      expect(typeof addr.address).toBe('string');
      expect(typeof addr.family).toBe('string');
      expect(typeof addr.port).toBe('number');
      expect(addr.port).toBeGreaterThan(0);
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

      await new Promise<void>((resolve) => {
        socket.on('listening', () => {
          listening = true;
          resolve();
        });
        socket.bind(0); // Random port
      });

      expect(listening).toBe(true);

      const addr = socket.address();
      expect(addr.port).toBeGreaterThan(0);
      socket.close();
    });

    await it('should send and receive UDP messages', async () => {
      const server = createSocket('udp4');
      const client = createSocket('udp4');

      await new Promise<void>((resolve) => {
        server.on('listening', resolve);
        server.bind(0);
      });

      const serverAddr = server.address();
      const received: { msg: string; port: number }[] = [];

      server.on('message', (msg: Buffer, rinfo: any) => {
        received.push({ msg: msg.toString(), port: rinfo.port });
      });

      // Send a message
      await new Promise<void>((resolve) => {
        client.send('hello', serverAddr.port, '127.0.0.1', (err) => {
          expect(err).toBeNull();
          resolve();
        });
      });

      // Wait for message to arrive
      await new Promise<void>((r) => setTimeout(r, 200));

      expect(received.length).toBe(1);
      expect(received[0].msg).toBe('hello');

      server.close();
      client.close();
    });
  });
};
