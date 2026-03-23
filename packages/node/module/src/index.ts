// Reference: Node.js lib/module.js
// Reimplemented for GJS using Gio and GLib
// CJS loading logic adapted from @gjsify/require (c) Andrea Giammarchi - ISC

import '@girs/gjs';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';

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

// --- Private helpers for createRequire ---
// Resolution logic ported from @gjsify/require, cleaned up for ESM-only use

function resolveFile(base: string, ...parts: string[]): Gio.File {
  let file = Gio.File.new_for_path(base);
  for (const part of parts) {
    file = file.resolve_relative_path(part);
  }
  return file;
}

function readJsonFile(filePath: string): unknown {
  const [ok, contents] = GLib.file_get_contents(filePath);
  if (!ok || !contents) {
    throw new Error(`Cannot read file "${filePath}"`);
  }
  return JSON.parse(new TextDecoder().decode(contents));
}

function findNodeModulesDir(startDir: string): string | null {
  let dir = Gio.File.new_for_path(startDir);
  while (dir.has_parent(null)) {
    const nodeModules = dir.resolve_relative_path('node_modules');
    if (nodeModules.query_exists(null)) {
      return nodeModules.get_path();
    }
    dir = dir.get_parent()!;
  }
  return null;
}

function resolveSymlink(file: Gio.File): string {
  const info = file.query_info('standard::', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
  if (info.get_is_symlink()) {
    const target = info.get_symlink_target();
    if (target) {
      const parent = file.get_parent();
      if (parent) {
        return parent.resolve_relative_path(target).get_path()!;
      }
    }
  }
  return file.get_path()!;
}

function resolveModulePath(id: string, callerDir: string): string {
  if (isBuiltin(id)) return id;

  let path: Gio.File;

  if (id.startsWith('/')) {
    path = resolveFile(id);
  } else if (id.startsWith('.')) {
    path = resolveFile(callerDir, id);
  } else {
    // Bare specifier → node_modules lookup
    const nodeModules = findNodeModulesDir(callerDir);
    if (!nodeModules) {
      throw new Error(`Cannot find module "${id}" - no node_modules directory found`);
    }
    path = resolveFile(nodeModules, id);
  }

  // Extension fallback for extensionless paths
  if (!path.query_exists(null)) {
    const basename = path.get_basename();
    if (basename && !basename.includes('.')) {
      const withJs = Gio.File.new_for_path(path.get_path()! + '.js');
      if (withJs.query_exists(null)) {
        path = withJs;
      }
    }
  }

  if (!path.query_exists(null)) {
    throw new Error(`Cannot find module "${id}"`);
  }

  // Symlink resolution
  const resolvedPath = resolveSymlink(path);

  // Directory with package.json → resolve main field
  const basename = path.get_basename();
  if (basename && !basename.includes('.')) {
    const pkgJsonFile = resolveFile(resolvedPath, 'package.json');
    if (pkgJsonFile.query_exists(null)) {
      const pkg = readJsonFile(pkgJsonFile.get_path()!) as Record<string, string>;
      const main = pkg.main || pkg.module || 'index.js';
      const entryFile = resolveFile(resolvedPath, main);
      if (entryFile.query_exists(null)) {
        return entryFile.get_path()!;
      }
      // Try adding .js extension
      if (!main.includes('.')) {
        const entryWithJs = Gio.File.new_for_path(entryFile.get_path()! + '.js');
        if (entryWithJs.query_exists(null)) {
          return entryWithJs.get_path()!;
        }
      }
    }
  }

  return resolvedPath;
}

// --- CJS file loading via GJS imports system ---
// Ported from @gjsify/require (c) Andrea Giammarchi - ISC

function requireJsFile(filePath: string, cache: Record<string, unknown>): unknown {
  if (filePath in cache) return cache[filePath];

  let fd = Gio.File.new_for_path(filePath);
  const dir = fd.get_parent()!.get_path()!;
  let basename = fd.get_basename()!;

  if (basename.endsWith('.mjs')) {
    throw new Error(`Cannot require .mjs files. Use import instead. Path: "${filePath}"`);
  }

  // GJS can't import files with .cjs extension — copy to .js
  if (basename.endsWith('.cjs')) {
    const dest = resolveFile(dir, '__gjsify__' + basename.replace(/\.cjs$/, '.js'));
    if (dest.query_exists(null)) {
      dest.delete(null);
    }
    fd.copy(dest, Gio.FileCopyFlags.NONE, null, null);
    fd = dest;
    basename = fd.get_basename()!;
  }

  // Save current global CJS state
  const savedExports = globalThis.exports;
  const savedModule = globalThis.module;

  const moduleExports = {};
  const moduleObj = { exports: moduleExports };
  globalThis.exports = moduleExports;
  globalThis.module = moduleObj as NodeModule;

  // Use GJS imports system to evaluate the CJS file
  const { searchPath } = imports;
  searchPath.unshift(dir);
  imports[basename.replace(/\.(js|cjs)$/, '')];
  searchPath.shift();

  // Capture result and restore global state
  const result = moduleObj.exports;
  cache[filePath] = result;

  globalThis.exports = savedExports;
  globalThis.module = savedModule;

  return result;
}

export function createRequire(filenameOrURL: string | URL): NodeRequire {
  let filename: string;

  // Duck-type URL objects (avoids dependency on global URL which may not exist in GJS)
  if (typeof filenameOrURL === 'object' && filenameOrURL !== null && 'href' in filenameOrURL) {
    const urlObj = filenameOrURL as { href: string; protocol?: string };
    if (urlObj.protocol && urlObj.protocol !== 'file:') {
      throw new TypeError('The URL must use the file: protocol');
    }
    [filename] = GLib.filename_from_uri(urlObj.href);
  } else if (typeof filenameOrURL === 'string' && filenameOrURL.startsWith('file:')) {
    [filename] = GLib.filename_from_uri(filenameOrURL);
  } else {
    filename = String(filenameOrURL);
  }

  if (!filename.startsWith('/')) {
    throw new TypeError(
      'The argument must be a file URL object, file URL string, or absolute path string. Received "' + String(filenameOrURL) + '"'
    );
  }

  const callerDir = GLib.path_get_dirname(filename);
  const cache: Record<string, unknown> = Object.create(null);

  const req = function require(id: string): unknown {
    const resolved = resolveModulePath(id, callerDir);

    if (resolved in cache) return cache[resolved];

    // JSON files
    if (resolved.endsWith('.json')) {
      const result = readJsonFile(resolved);
      cache[resolved] = result;
      return result;
    }

    // Builtin modules can't be required synchronously in ESM
    if (isBuiltin(id)) {
      throw new Error(
        `createRequire: Cannot require builtin module "${id}" synchronously in GJS. Use import instead.`
      );
    }

    // .js/.cjs files — load via GJS imports system
    return requireJsFile(resolved, cache);
  } as NodeRequire;

  req.resolve = function resolve(id: string): string {
    return resolveModulePath(id, callerDir);
  } as NodeRequire['resolve'];

  req.resolve.paths = function paths(_request: string): string[] | null {
    return null;
  };

  req.cache = cache;
  req.extensions = Object.create(null) as NodeRequire['extensions'];
  req.main = undefined;

  return req;
}

export default { builtinModules, isBuiltin, createRequire };
