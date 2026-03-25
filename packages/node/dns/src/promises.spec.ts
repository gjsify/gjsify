import { describe, it, expect } from '@gjsify/unit';
import dnsPromises, { lookup, resolve4, resolve6, reverse, resolve } from 'node:dns/promises';

export default async () => {
  await describe('dns/promises', async () => {

    await describe('exports', async () => {
      await it('should export lookup as a function', async () => {
        expect(typeof lookup).toBe('function');
      });

      await it('should export resolve4 as a function', async () => {
        expect(typeof resolve4).toBe('function');
      });

      await it('should export resolve6 as a function', async () => {
        expect(typeof resolve6).toBe('function');
      });

      await it('should export reverse as a function', async () => {
        expect(typeof reverse).toBe('function');
      });

      await it('should export resolve as a function', async () => {
        expect(typeof resolve).toBe('function');
      });

      await it('should have all exports on the default export object', async () => {
        expect(typeof dnsPromises.lookup).toBe('function');
        expect(typeof dnsPromises.resolve4).toBe('function');
        expect(typeof dnsPromises.resolve6).toBe('function');
        expect(typeof dnsPromises.reverse).toBe('function');
        expect(typeof dnsPromises.resolve).toBe('function');
      });
    });

    await describe('lookup', async () => {
      await it('should resolve localhost', async () => {
        const result = await lookup('localhost') as { address: string; family: number };
        expect(typeof result.address).toBe('string');
        expect(result.family === 4 || result.family === 6).toBe(true);
      });

      await it('should return IPv4 address unchanged', async () => {
        const result = await lookup('127.0.0.1') as { address: string; family: number };
        expect(result.address).toBe('127.0.0.1');
        expect(result.family).toBe(4);
      });

      await it('should return IPv6 address unchanged', async () => {
        const result = await lookup('::1') as { address: string; family: number };
        expect(result.address).toBe('::1');
        expect(result.family).toBe(6);
      });

      await it('should accept family option as number', async () => {
        const result = await lookup('127.0.0.1', 4) as { address: string; family: number };
        expect(result.address).toBe('127.0.0.1');
        expect(result.family).toBe(4);
      });

      await it('should accept family option in options object', async () => {
        const result = await lookup('127.0.0.1', { family: 4 }) as { address: string; family: number };
        expect(result.address).toBe('127.0.0.1');
        expect(result.family).toBe(4);
      });

      await it('should return all addresses with all: true', async () => {
        const results = await lookup('localhost', { all: true }) as Array<{ address: string; family: number }>;
        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);
        for (const entry of results) {
          expect(typeof entry.address).toBe('string');
          expect(entry.family === 4 || entry.family === 6).toBe(true);
        }
      });

      await it('should reject on non-existent hostname', async () => {
        let threw = false;
        try {
          await lookup('this.hostname.does.not.exist.invalid');
        } catch (err: any) {
          threw = true;
          expect(err.code).toBe('ENOTFOUND');
        }
        expect(threw).toBe(true);
      });
    });

    await describe('resolve4', async () => {
      await it('should resolve localhost to IPv4 addresses', async () => {
        const addresses = await resolve4('localhost');
        expect(Array.isArray(addresses)).toBe(true);
        expect(addresses.length).toBeGreaterThan(0);
        for (const addr of addresses) {
          expect(typeof addr).toBe('string');
        }
      });
    });

    await describe('resolve', async () => {
      await it('should resolve with default rrtype (A record)', async () => {
        const records = await resolve('localhost');
        expect(Array.isArray(records)).toBe(true);
      });

      await it('should resolve with explicit A rrtype', async () => {
        const records = await resolve('localhost', 'A');
        expect(Array.isArray(records)).toBe(true);
      });
    });

    await describe('reverse', async () => {
      await it('should reverse lookup 127.0.0.1', async () => {
        try {
          const hostnames = await reverse('127.0.0.1');
          expect(Array.isArray(hostnames)).toBe(true);
        } catch (err: any) {
          // May fail depending on system config — just verify error shape
          expect(typeof err.code).toBe('string');
        }
      });
    });
  });
};
