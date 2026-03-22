import { describe, it, expect } from '@gjsify/unit';
import { Agent, globalAgent } from 'https';

export default async () => {
  await describe('https', async () => {
    await describe('Agent', async () => {
      await it('should be constructable', async () => {
        const agent = new Agent();
        expect(agent).toBeDefined();
        expect(agent.defaultPort).toBe(443);
      });
    });

    await describe('globalAgent', async () => {
      await it('should be an Agent instance', async () => {
        expect(globalAgent).toBeDefined();
        expect(globalAgent.protocol).toBe('https:');
      });
    });
  });
};
