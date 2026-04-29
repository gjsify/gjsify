// Ported from refs/node-test/parallel/test-fs-statfs.js (behavior)
// Original: MIT, Node.js contributors.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { statfsSync, statfs, promises } from 'node:fs';
import { tmpdir } from 'node:os';

const TMP = tmpdir();

export default async () => {
  await describe('fs.statfs / fs.promises.statfs', async () => {
    await it('statfsSync returns object with expected shape', async () => {
      const result = statfsSync(TMP);
      expect(typeof result.type).toBe('number');
      expect(typeof result.bsize).toBe('number');
      expect(typeof result.blocks).toBe('number');
      expect(typeof result.bfree).toBe('number');
      expect(typeof result.bavail).toBe('number');
      expect(typeof result.files).toBe('number');
      expect(typeof result.ffree).toBe('number');
    });

    await it('statfsSync returns plausible values', async () => {
      const result = statfsSync(TMP);
      expect(result.bsize).toBe(4096);
      expect(result.blocks).toBeGreaterThan(0);
      expect(result.bfree).toBeGreaterThanOrEqual(0);
      expect(result.bavail).toBeGreaterThanOrEqual(0);
    });

    await it('statfs callback form returns same shape', async () => {
      const result = await new Promise<any>((resolve, reject) => {
        statfs(TMP, (err, stats) => {
          if (err) reject(err);
          else resolve(stats);
        });
      });
      expect(typeof result.type).toBe('number');
      expect(typeof result.bsize).toBe('number');
      expect(result.bsize).toBe(4096);
      expect(result.blocks).toBeGreaterThan(0);
    });

    await it('promises.statfs returns same shape', async () => {
      const result = await promises.statfs(TMP);
      expect(typeof result.type).toBe('number');
      expect(typeof result.bsize).toBe('number');
      expect(result.bsize).toBe(4096);
      expect(result.blocks).toBeGreaterThan(0);
    });

    await it('statfsSync with bigint:true returns bigint fields', async () => {
      const result = statfsSync(TMP, { bigint: true });
      expect(typeof result.type).toBe('bigint');
      expect(typeof result.bsize).toBe('bigint');
      expect(typeof result.blocks).toBe('bigint');
      expect(typeof result.bfree).toBe('bigint');
      expect(result.bsize).toBe(4096n);
      expect(result.blocks > 0n).toBe(true);
    });

    await it('statfsSync throws on non-existent path', async () => {
      expect(() => statfsSync('/nonexistent-gjsify-test-path-xyz')).toThrow();
    });
  });
};
