import { describe, it, expect } from '@gjsify/unit';
import { builtinModules, isBuiltin } from 'module';

export default async () => {
  await describe('module', async () => {
    await it('should export builtinModules as an array', async () => {
      expect(Array.isArray(builtinModules)).toBe(true);
    });

    await it('should include fs in builtinModules', async () => {
      expect(builtinModules).toContain('fs');
    });

    await it('should include path in builtinModules', async () => {
      expect(builtinModules).toContain('path');
    });

    await it('should detect fs as builtin', async () => {
      expect(isBuiltin('fs')).toBe(true);
    });

    await it('should detect node:fs as builtin', async () => {
      expect(isBuiltin('node:fs')).toBe(true);
    });

    await it('should not detect nonexistent as builtin', async () => {
      expect(isBuiltin('nonexistent')).toBe(false);
    });

    // Additional tests ported from refs/node-test

    await it('builtinModules should have more than 30 entries', async () => {
      expect(builtinModules.length > 30).toBeTruthy();
    });

    await it('builtinModules should include core modules', async () => {
      expect(builtinModules).toContain('os');
      expect(builtinModules).toContain('crypto');
      expect(builtinModules).toContain('http');
      expect(builtinModules).toContain('net');
      expect(builtinModules).toContain('stream');
      expect(builtinModules).toContain('events');
      expect(builtinModules).toContain('buffer');
      expect(builtinModules).toContain('util');
    });

    await it('builtinModules should include non-prefixed names', async () => {
      // builtinModules must include at least the bare names (without node: prefix)
      expect(builtinModules).toContain('fs');
      expect(builtinModules).toContain('path');
    });

    await it('isBuiltin should handle various module names', async () => {
      expect(isBuiltin('path')).toBeTruthy();
      expect(isBuiltin('os')).toBeTruthy();
      expect(isBuiltin('crypto')).toBeTruthy();
      expect(isBuiltin('http')).toBeTruthy();
    });

    await it('isBuiltin should handle node: prefix', async () => {
      expect(isBuiltin('node:path')).toBeTruthy();
      expect(isBuiltin('node:os')).toBeTruthy();
    });

    await it('isBuiltin should return false for npm packages', async () => {
      expect(isBuiltin('@babel/core')).toBeFalsy();
      expect(isBuiltin('lodash')).toBeFalsy();
      expect(isBuiltin('express')).toBeFalsy();
    });

    await it('isBuiltin should return false for empty string', async () => {
      expect(isBuiltin('')).toBeFalsy();
    });
  });
};
