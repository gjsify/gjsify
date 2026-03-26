// Ported from refs/node/test/parallel/test-sys.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import * as sys from 'node:util';

export default async () => {
  await describe('sys', async () => {
    await it('should be an alias for util', async () => {
      expect(typeof sys.format).toBe('function');
      expect(typeof sys.inspect).toBe('function');
      expect(typeof sys.promisify).toBe('function');
    });

    await it('should have format function', async () => {
      expect(sys.format('hello %s', 'world')).toBe('hello world');
    });

    await it('should have inspect function', async () => {
      expect(typeof sys.inspect({})).toBe('string');
    });

    await it('should have types namespace', async () => {
      expect(typeof sys.types).toBe('object');
      expect(typeof sys.types.isDate).toBe('function');
    });
  });
};
