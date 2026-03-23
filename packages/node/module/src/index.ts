// Reference: Node.js lib/module.js
// Reimplemented for GJS

export const builtinModules = [
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
];

export function isBuiltin(name: string): boolean {
  const n = name.startsWith('node:') ? name.slice(5) : name;
  // Support subpath like 'fs/promises', 'dns/promises', 'timers/promises'
  const base = n.split('/')[0];
  return builtinModules.includes(n) || builtinModules.includes(base);
}

export function createRequire(filename: string): NodeRequire {
  const req = function require(id: string) {
    throw new Error(`createRequire is not fully supported in GJS. Cannot require("${id}") from "${filename}"`);
  } as NodeRequire;

  req.resolve = function resolve(id: string) {
    throw new Error(`require.resolve is not fully supported in GJS. Cannot resolve("${id}") from "${filename}"`);
  } as NodeRequire['resolve'];
  req.resolve.paths = function paths(_request: string) {
    return null;
  };

  req.cache = Object.create(null);
  req.extensions = Object.create(null) as NodeRequire['extensions'];
  req.main = undefined;

  return req;
}

export default { builtinModules, isBuiltin, createRequire };
