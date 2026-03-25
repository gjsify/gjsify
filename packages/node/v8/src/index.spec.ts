import { describe, it, expect } from '@gjsify/unit';
import { getHeapStatistics, getHeapCodeStatistics, serialize, deserialize } from 'node:v8';

export default async () => {
  await describe('v8', async () => {
    await it('should export getHeapStatistics as a function', async () => {
      expect(typeof getHeapStatistics).toBe('function');
    });

    await it('should return heap statistics object', async () => {
      const stats = getHeapStatistics();
      expect(stats).toBeDefined();
      expect(typeof stats.total_heap_size).toBe('number');
      expect(typeof stats.used_heap_size).toBe('number');
    });

    await it('should return heap code statistics', async () => {
      const stats = getHeapCodeStatistics();
      expect(stats).toBeDefined();
      expect(typeof stats.code_and_metadata_size).toBe('number');
    });

    await it('should export serialize and deserialize', async () => {
      expect(typeof serialize).toBe('function');
      expect(typeof deserialize).toBe('function');
    });
  });
};
