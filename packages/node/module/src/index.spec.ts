import { describe, it, expect } from '@gjsify/unit';
import { builtinModules, isBuiltin, createRequire } from 'node:module';

export default async () => {
  await describe('module', async () => {

    // --- builtinModules ---
    await describe('builtinModules', async () => {
      await it('should be an array', async () => {
        expect(Array.isArray(builtinModules)).toBe(true);
      });

      await it('should have more than 30 entries', async () => {
        expect(builtinModules.length > 30).toBeTruthy();
      });

      await it('should include core modules', async () => {
        expect(builtinModules).toContain('fs');
        expect(builtinModules).toContain('path');
        expect(builtinModules).toContain('os');
        expect(builtinModules).toContain('crypto');
        expect(builtinModules).toContain('http');
        expect(builtinModules).toContain('net');
        expect(builtinModules).toContain('stream');
        expect(builtinModules).toContain('events');
        expect(builtinModules).toContain('buffer');
        expect(builtinModules).toContain('util');
      });

      await it('should include networking modules', async () => {
        expect(builtinModules).toContain('dns');
        expect(builtinModules).toContain('http');
        expect(builtinModules).toContain('https');
        expect(builtinModules).toContain('net');
        expect(builtinModules).toContain('tls');
        expect(builtinModules).toContain('dgram');
      });

      await it('should include utility modules', async () => {
        expect(builtinModules).toContain('assert');
        expect(builtinModules).toContain('querystring');
        expect(builtinModules).toContain('url');
        expect(builtinModules).toContain('string_decoder');
        expect(builtinModules).toContain('timers');
        expect(builtinModules).toContain('zlib');
      });

      await it('should include bare names (without node: prefix)', async () => {
        // builtinModules should include at least the bare names
        const bareModules = builtinModules.filter(m => !m.startsWith('node:'));
        expect(bareModules.length).toBeGreaterThan(30);
        expect(bareModules).toContain('fs');
        expect(bareModules).toContain('path');
      });

      await it('should contain only strings', async () => {
        for (const mod of builtinModules) {
          expect(typeof mod).toBe('string');
        }
      });

      await it('should not contain duplicates', async () => {
        const unique = new Set(builtinModules);
        expect(unique.size).toBe(builtinModules.length);
      });
    });

    // --- isBuiltin ---
    await describe('isBuiltin', async () => {
      await it('should return true for common modules', async () => {
        expect(isBuiltin('fs')).toBe(true);
        expect(isBuiltin('path')).toBe(true);
        expect(isBuiltin('os')).toBe(true);
        expect(isBuiltin('crypto')).toBe(true);
        expect(isBuiltin('http')).toBe(true);
      });

      await it('should return true with node: prefix', async () => {
        expect(isBuiltin('node:fs')).toBe(true);
        expect(isBuiltin('node:path')).toBe(true);
        expect(isBuiltin('node:os')).toBe(true);
        expect(isBuiltin('node:crypto')).toBe(true);
      });

      await it('should return false for npm packages', async () => {
        expect(isBuiltin('@babel/core')).toBe(false);
        expect(isBuiltin('lodash')).toBe(false);
        expect(isBuiltin('express')).toBe(false);
        expect(isBuiltin('react')).toBe(false);
      });

      await it('should return false for empty string', async () => {
        expect(isBuiltin('')).toBe(false);
      });

      await it('should return false for nonexistent module', async () => {
        expect(isBuiltin('nonexistent')).toBe(false);
        expect(isBuiltin('not_a_module')).toBe(false);
      });

      await it('should return false for relative paths', async () => {
        expect(isBuiltin('./fs')).toBe(false);
        expect(isBuiltin('../path')).toBe(false);
        expect(isBuiltin('/absolute/path')).toBe(false);
      });

      await it('should return true for subpath modules', async () => {
        expect(isBuiltin('fs/promises')).toBe(true);
        expect(isBuiltin('dns/promises')).toBe(true);
        expect(isBuiltin('timers/promises')).toBe(true);
        expect(isBuiltin('node:fs/promises')).toBe(true);
      });
    });

    // --- createRequire ---
    await describe('createRequire', async () => {
      await it('should be a function', async () => {
        expect(typeof createRequire).toBe('function');
      });

      await it('should accept import.meta.url (file: URL string)', async () => {
        const require = createRequire(import.meta.url);
        expect(typeof require).toBe('function');
      });

      await it('should throw for relative path', async () => {
        let threw = false;
        try {
          createRequire('relative/path.js');
        } catch {
          threw = true;
        }
        expect(threw).toBe(true);
      });

      await it('returned require should have resolve property', async () => {
        const require = createRequire(import.meta.url);
        expect(typeof require.resolve).toBe('function');
      });

      await it('returned require should have resolve.paths property', async () => {
        const require = createRequire(import.meta.url);
        expect(typeof require.resolve.paths).toBe('function');
      });

      await it('returned require should have cache property', async () => {
        const require = createRequire(import.meta.url);
        expect(require.cache).toBeDefined();
        expect(typeof require.cache).toBe('object');
      });

      await it('returned require should have extensions property', async () => {
        const require = createRequire(import.meta.url);
        expect(require.extensions).toBeDefined();
        expect(typeof require.extensions).toBe('object');
      });

      await it('resolve.paths should return null', async () => {
        const require = createRequire(import.meta.url);
        const result = require.resolve.paths('fs');
        expect(result).toBeNull();
      });

      await it('resolve should return the module name for builtins', async () => {
        const require = createRequire(import.meta.url);
        expect(require.resolve('fs')).toBe('fs');
        expect(require.resolve('path')).toBe('path');
      });
    });

    // --- Module exports ---
    await describe('exports', async () => {
      await it('should export builtinModules', async () => {
        expect(builtinModules).toBeDefined();
      });

      await it('should export isBuiltin', async () => {
        expect(typeof isBuiltin).toBe('function');
      });

      await it('should export createRequire', async () => {
        expect(typeof createRequire).toBe('function');
      });
    });
  });
};
