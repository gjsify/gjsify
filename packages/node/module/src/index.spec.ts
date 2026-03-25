// Ported from refs/node-test/parallel/test-module-{isBuiltin,builtinModules,createRequire}.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import { builtinModules, isBuiltin, createRequire } from 'node:module';

export default async () => {
  await describe('module.builtinModules', async () => {
    await it('should be an array', async () => {
      expect(Array.isArray(builtinModules)).toBe(true);
    });

    await it('should have more than 30 entries', async () => {
      expect(builtinModules.length).toBeGreaterThan(30);
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

    await it('should include fs', async () => {
      expect(builtinModules).toContain('fs');
    });

    await it('should include path', async () => {
      expect(builtinModules).toContain('path');
    });

    await it('should include os', async () => {
      expect(builtinModules).toContain('os');
    });

    await it('should include crypto', async () => {
      expect(builtinModules).toContain('crypto');
    });

    await it('should include http', async () => {
      expect(builtinModules).toContain('http');
    });

    await it('should include net', async () => {
      expect(builtinModules).toContain('net');
    });

    await it('should include stream', async () => {
      expect(builtinModules).toContain('stream');
    });

    await it('should include events', async () => {
      expect(builtinModules).toContain('events');
    });

    await it('should include buffer', async () => {
      expect(builtinModules).toContain('buffer');
    });

    await it('should include util', async () => {
      expect(builtinModules).toContain('util');
    });

    await it('should include dns', async () => {
      expect(builtinModules).toContain('dns');
    });

    await it('should include https', async () => {
      expect(builtinModules).toContain('https');
    });

    await it('should include tls', async () => {
      expect(builtinModules).toContain('tls');
    });

    await it('should include dgram', async () => {
      expect(builtinModules).toContain('dgram');
    });

    await it('should include assert', async () => {
      expect(builtinModules).toContain('assert');
    });

    await it('should include querystring', async () => {
      expect(builtinModules).toContain('querystring');
    });

    await it('should include url', async () => {
      expect(builtinModules).toContain('url');
    });

    await it('should include string_decoder', async () => {
      expect(builtinModules).toContain('string_decoder');
    });

    await it('should include timers', async () => {
      expect(builtinModules).toContain('timers');
    });

    await it('should include zlib', async () => {
      expect(builtinModules).toContain('zlib');
    });

    await it('should include child_process', async () => {
      expect(builtinModules).toContain('child_process');
    });

    await it('should include cluster', async () => {
      expect(builtinModules).toContain('cluster');
    });

    await it('should include console', async () => {
      expect(builtinModules).toContain('console');
    });

    await it('should include domain', async () => {
      expect(builtinModules).toContain('domain');
    });

    await it('should include http2', async () => {
      expect(builtinModules).toContain('http2');
    });

    await it('should include module', async () => {
      expect(builtinModules).toContain('module');
    });

    await it('should include perf_hooks', async () => {
      expect(builtinModules).toContain('perf_hooks');
    });

    await it('should include process', async () => {
      expect(builtinModules).toContain('process');
    });

    await it('should include readline', async () => {
      expect(builtinModules).toContain('readline');
    });

    await it('should include tty', async () => {
      expect(builtinModules).toContain('tty');
    });

    await it('should include v8', async () => {
      expect(builtinModules).toContain('v8');
    });

    await it('should include vm', async () => {
      expect(builtinModules).toContain('vm');
    });

    await it('should include worker_threads', async () => {
      expect(builtinModules).toContain('worker_threads');
    });

    await it('should include bare names (without node: prefix)', async () => {
      const bareModules = builtinModules.filter(m => !m.startsWith('node:'));
      expect(bareModules.length).toBeGreaterThan(30);
      expect(bareModules).toContain('fs');
    });
  });

  await describe('module.isBuiltin', async () => {
    await it('should be a function', async () => {
      expect(typeof isBuiltin).toBe('function');
    });

    await it('should return true for fs', async () => {
      expect(isBuiltin('fs')).toBe(true);
    });

    await it('should return true for path', async () => {
      expect(isBuiltin('path')).toBe(true);
    });

    await it('should return true for os', async () => {
      expect(isBuiltin('os')).toBe(true);
    });

    await it('should return true for crypto', async () => {
      expect(isBuiltin('crypto')).toBe(true);
    });

    await it('should return true for http', async () => {
      expect(isBuiltin('http')).toBe(true);
    });

    await it('should return true for node:fs', async () => {
      expect(isBuiltin('node:fs')).toBe(true);
    });

    await it('should return true for node:path', async () => {
      expect(isBuiltin('node:path')).toBe(true);
    });

    await it('should return true for node:os', async () => {
      expect(isBuiltin('node:os')).toBe(true);
    });

    await it('should return true for node:crypto', async () => {
      expect(isBuiltin('node:crypto')).toBe(true);
    });

    await it('should return true for node:events', async () => {
      expect(isBuiltin('node:events')).toBe(true);
    });

    await it('should return true for node:stream', async () => {
      expect(isBuiltin('node:stream')).toBe(true);
    });

    await it('should return true for node:buffer', async () => {
      expect(isBuiltin('node:buffer')).toBe(true);
    });

    await it('should return true for node:util', async () => {
      expect(isBuiltin('node:util')).toBe(true);
    });

    await it('should return false for npm packages', async () => {
      expect(isBuiltin('@babel/core')).toBe(false);
      expect(isBuiltin('lodash')).toBe(false);
      expect(isBuiltin('express')).toBe(false);
    });

    await it('should return false for empty string', async () => {
      expect(isBuiltin('')).toBe(false);
    });

    await it('should return false for nonexistent module', async () => {
      expect(isBuiltin('nonexistent')).toBe(false);
    });

    await it('should return false for relative paths', async () => {
      expect(isBuiltin('./fs')).toBe(false);
      expect(isBuiltin('../path')).toBe(false);
    });

    await it('should return false for absolute paths', async () => {
      expect(isBuiltin('/absolute/path')).toBe(false);
    });

    await it('should return true for subpath fs/promises', async () => {
      expect(isBuiltin('fs/promises')).toBe(true);
    });

    await it('should return true for subpath dns/promises', async () => {
      expect(isBuiltin('dns/promises')).toBe(true);
    });

    await it('should return true for subpath timers/promises', async () => {
      expect(isBuiltin('timers/promises')).toBe(true);
    });

    await it('should return true for subpath node:fs/promises', async () => {
      expect(isBuiltin('node:fs/promises')).toBe(true);
    });

    await it('should return false for scoped package with node name', async () => {
      expect(isBuiltin('@types/node')).toBe(false);
    });

    await it('should return true for stream', async () => {
      expect(isBuiltin('stream')).toBe(true);
    });

    await it('should return true for assert', async () => {
      expect(isBuiltin('assert')).toBe(true);
    });

    await it('should return true for diagnostics_channel', async () => {
      expect(isBuiltin('diagnostics_channel')).toBe(true);
    });

    await it('should return true for async_hooks', async () => {
      expect(isBuiltin('async_hooks')).toBe(true);
    });
  });

  await describe('module.createRequire', async () => {
    await it('should be a function', async () => {
      expect(typeof createRequire).toBe('function');
    });

    await it('should accept import.meta.url', async () => {
      const req = createRequire(import.meta.url);
      expect(typeof req).toBe('function');
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

    await it('returned require should have resolve', async () => {
      const req = createRequire(import.meta.url);
      expect(typeof req.resolve).toBe('function');
    });

    await it('returned require should have resolve.paths', async () => {
      const req = createRequire(import.meta.url);
      expect(typeof req.resolve.paths).toBe('function');
    });

    await it('returned require should have cache', async () => {
      const req = createRequire(import.meta.url);
      expect(req.cache).toBeDefined();
      expect(typeof req.cache).toBe('object');
    });

    await it('returned require should have extensions', async () => {
      const req = createRequire(import.meta.url);
      expect(req.extensions).toBeDefined();
      expect(typeof req.extensions).toBe('object');
    });

    await it('resolve.paths should return null for builtins', async () => {
      const req = createRequire(import.meta.url);
      expect(req.resolve.paths('fs')).toBeNull();
    });

    await it('resolve should return module name for fs', async () => {
      const req = createRequire(import.meta.url);
      expect(req.resolve('fs')).toBe('fs');
    });

    await it('resolve should return module name for path', async () => {
      const req = createRequire(import.meta.url);
      expect(req.resolve('path')).toBe('path');
    });

    await it('resolve should return module name for os', async () => {
      const req = createRequire(import.meta.url);
      expect(req.resolve('os')).toBe('os');
    });

    await it('resolve should return module name for events', async () => {
      const req = createRequire(import.meta.url);
      expect(req.resolve('events')).toBe('events');
    });
  });

  await describe('module exports', async () => {
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
};
