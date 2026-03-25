import { describe, it, expect } from '@gjsify/unit';
import { randomBytes, randomUUID, randomInt, randomFillSync, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

export default async () => {
  await describe('crypto.randomBytes', async () => {
    await it('should return a Buffer of requested size', async () => {
      const buf = randomBytes(32);
      expect(buf.length).toBe(32);
    });

    await it('should return empty buffer for size 0', async () => {
      const buf = randomBytes(0);
      expect(buf.length).toBe(0);
    });

    await it('should return different values on each call', async () => {
      const a = randomBytes(16);
      const b = randomBytes(16);
      // Extremely unlikely to be equal
      let equal = true;
      for (let i = 0; i < 16; i++) {
        if (a[i] !== b[i]) { equal = false; break; }
      }
      expect(equal).toBe(false);
    });

    await it('should work with callback', async () => {
      const result = await new Promise<Buffer>((resolve, reject) => {
        randomBytes(16, (err, buf) => {
          if (err) reject(err);
          else resolve(buf);
        });
      });
      expect(result.length).toBe(16);
    });

    await it('should handle large sizes (> 65536)', async () => {
      const buf = randomBytes(100000);
      expect(buf.length).toBe(100000);
    });
  });

  await describe('crypto.randomUUID', async () => {
    await it('should return a valid UUID v4 string', async () => {
      const uuid = randomUUID();
      expect(uuid.length).toBe(36);
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    await it('should return different UUIDs', async () => {
      const a = randomUUID();
      const b = randomUUID();
      expect(a).not.toBe(b);
    });
  });

  await describe('crypto.randomInt', async () => {
    await it('should return integer in range [0, max)', async () => {
      for (let i = 0; i < 20; i++) {
        const val = randomInt(10) as number;
        expect(val).toBeGreaterThan(-1);
        expect(val).toBeLessThan(10);
      }
    });

    await it('should return integer in range [min, max)', async () => {
      for (let i = 0; i < 20; i++) {
        const val = randomInt(5, 10) as number;
        expect(val).toBeGreaterThan(4);
        expect(val).toBeLessThan(10);
      }
    });

    await it('should throw when min >= max', async () => {
      let threw = false;
      try {
        randomInt(10, 5);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  await describe('crypto.randomFillSync', async () => {
    await it('should fill a buffer with random data', async () => {
      const buf = Buffer.alloc(16);
      randomFillSync(buf);
      let allZero = true;
      for (let i = 0; i < 16; i++) {
        if (buf[i] !== 0) { allZero = false; break; }
      }
      expect(allZero).toBe(false);
    });

    await it('should fill with offset and size', async () => {
      const buf = Buffer.alloc(16, 0);
      randomFillSync(buf, 4, 8);
      // First 4 bytes should be zero
      expect(buf[0]).toBe(0);
      expect(buf[1]).toBe(0);
      expect(buf[2]).toBe(0);
      expect(buf[3]).toBe(0);
    });
  });

  await describe('crypto.timingSafeEqual', async () => {
    await it('should return true for equal buffers', async () => {
      const a = Buffer.from('hello');
      const b = Buffer.from('hello');
      expect(timingSafeEqual(a, b)).toBe(true);
    });

    await it('should return false for different buffers', async () => {
      const a = Buffer.from('hello');
      const b = Buffer.from('world');
      expect(timingSafeEqual(a, b)).toBe(false);
    });

    await it('should throw for different lengths', async () => {
      const a = Buffer.from('hello');
      const b = Buffer.from('hi');
      let threw = false;
      try {
        timingSafeEqual(a, b);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });
};
