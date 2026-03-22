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
  });
};
