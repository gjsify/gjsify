import { describe, it, expect } from '@gjsify/unit';
import { isMainThread, parentPort, workerData, threadId, MessageChannel, MessagePort } from 'worker_threads';

export default async () => {
  await describe('worker_threads', async () => {
    await it('should export isMainThread as true', async () => {
      expect(isMainThread).toBe(true);
    });

    await it('should export parentPort as null', async () => {
      expect(parentPort).toBeNull();
    });

    await it('should export workerData as null', async () => {
      expect(workerData).toBeNull();
    });

    await it('should export threadId as 0', async () => {
      expect(threadId).toBe(0);
    });

    await it('should export MessageChannel class', async () => {
      expect(MessageChannel).toBeDefined();
      const channel = new MessageChannel();
      expect(channel).toBeDefined();
    });

    await it('should export MessagePort class', async () => {
      expect(MessagePort).toBeDefined();
    });
  });
};
