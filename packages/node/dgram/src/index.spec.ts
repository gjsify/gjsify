import { describe, it, expect } from '@gjsify/unit';
import { createSocket, Socket } from 'dgram';

export default async () => {
  await describe('dgram', async () => {
    await it('should export createSocket as a function', async () => {
      expect(typeof createSocket).toBe('function');
    });

    await it('should export Socket', async () => {
      expect(Socket).toBeDefined();
    });

    await it('should create a socket', async () => {
      const socket = createSocket('udp4');
      expect(socket).toBeDefined();
      expect(typeof socket.close).toBe('function');
      expect(typeof socket.send).toBe('function');
    });
  });
};
