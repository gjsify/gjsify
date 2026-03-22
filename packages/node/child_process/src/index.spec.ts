import { describe, it, expect } from '@gjsify/unit';
import { execFileSync, spawnSync } from 'child_process';

export default async () => {
  await describe('child_process', async () => {
    await describe('execFileSync', async () => {
      await it('should run a command and return output', async () => {
        const result = execFileSync('echo', ['hello world'], { encoding: 'utf8' });
        expect((result as string).trim()).toBe('hello world');
      });

      await it('should throw on non-zero exit', async () => {
        let threw = false;
        try {
          execFileSync('false');
        } catch (e: any) {
          threw = true;
        }
        expect(threw).toBe(true);
      });
    });

    await describe('spawnSync', async () => {
      await it('should spawn and return result', async () => {
        const result = spawnSync('echo', ['test']);
        expect(result.status).toBe(0);
        expect(result.stdout).toBeDefined();
      });

      await it('should capture stderr', async () => {
        const result = spawnSync('sh', ['-c', 'echo err >&2']);
        expect(result.status).toBe(0);
      });
    });
  });
};
