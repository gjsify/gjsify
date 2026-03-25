import { describe, it, expect } from '@gjsify/unit';
import { create, Domain } from 'node:domain';

export default async () => {
  await describe('domain', async () => {
    await it('should export create as a function', async () => {
      expect(typeof create).toBe('function');
    });

    await it('should export Domain class', async () => {
      expect(Domain).toBeDefined();
    });

    await it('should create a domain', async () => {
      const d = create();
      expect(d).toBeDefined();
      expect(typeof d.run).toBe('function');
      expect(typeof d.bind).toBe('function');
      expect(typeof d.add).toBe('function');
      expect(typeof d.remove).toBe('function');
    });

    await it('should run a function in domain', async () => {
      const d = create();
      const result = d.run(() => 42);
      expect(result).toBe(42);
    });

    await it('should have empty members initially', async () => {
      const d = create();
      expect(Array.isArray(d.members)).toBe(true);
      expect(d.members.length).toBe(0);
    });
  });
};
