import { describe, it, expect } from '@gjsify/unit';
import { isPrimary, isMaster, isWorker, SCHED_NONE, SCHED_RR } from 'node:cluster';

export default async () => {
  await describe('cluster', async () => {
    await it('should export isPrimary as true', async () => {
      expect(isPrimary).toBe(true);
    });

    await it('should export isMaster as true', async () => {
      expect(isMaster).toBe(true);
    });

    await it('should export isWorker as false', async () => {
      expect(isWorker).toBe(false);
    });

    await it('should export scheduling constants', async () => {
      expect(SCHED_NONE).toBe(1);
      expect(SCHED_RR).toBe(2);
    });
  });
};
