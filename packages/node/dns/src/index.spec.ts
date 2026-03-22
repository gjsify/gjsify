import { describe, it, expect } from '@gjsify/unit';
import { lookup, resolve4, NOTFOUND } from 'dns';

export default async () => {
  await describe('dns', async () => {
    await describe('lookup', async () => {
      await it('should resolve localhost', async () => {
        await new Promise<void>((resolve, reject) => {
          lookup('localhost', (err, address, family) => {
            if (err) return reject(err);
            expect(address).toBeDefined();
            expect(typeof address).toBe('string');
            expect(family === 4 || family === 6).toBe(true);
            resolve();
          });
        });
      });

      await it('should resolve empty hostname to loopback', async () => {
        await new Promise<void>((resolve) => {
          lookup('', (err, address, family) => {
            expect(err).toBeNull();
            expect(address).toBe('127.0.0.1');
            expect(family).toBe(4);
            resolve();
          });
        });
      });

      await it('should return IP addresses unchanged', async () => {
        await new Promise<void>((resolve) => {
          lookup('127.0.0.1', (err, address, family) => {
            expect(err).toBeNull();
            expect(address).toBe('127.0.0.1');
            expect(family).toBe(4);
            resolve();
          });
        });
      });
    });

    await describe('constants', async () => {
      await it('should export error codes', async () => {
        expect(NOTFOUND).toBe('ENOTFOUND');
      });
    });
  });
};
