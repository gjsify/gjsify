// Reference: Node.js lib/module.js
// Reimplemented for GJS using Gio and GLib
// CJS loading logic adapted from @gjsify/require (c) Andrea Giammarchi - ISC

import '@girs/gjs';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { resolve as resolvePath, readJSON } from '@gjsify/utils';

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
  const base = n.split('/')[0];
  return builtinModules.includes(n) || builtinModules.includes(base);
}

// --- Private helpers for createRequire ---
// Resolution logic ported from @gjsify/require, cleaned up for ESM-only use

/** Walk up from startDir to find the nearest node_modules directory. */
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

/** Resolve symlinks for a Gio.File, returning the real path. */
function resolveSymlink(file: Gio.File): string {
  const info = file.query_info('standard::', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
  if (info.get_is_symlink()) {
    const target = info.get_symlink_target();
    const parent = file.get_parent();
    if (target && parent) {
      return parent.resolve_relative_path(target).get_path()!;
    }
  }
  return file.get_path()!;
}

/** Try appending .js to an extensionless path. Returns the file if found, null otherwise. */
function tryJsExtension(filePath: string): Gio.File | null {
  const withJs = Gio.File.new_for_path(filePath + '.js');
  return withJs.query_exists(null) ? withJs : null;
}

/** Check if a basename has a file extension. */
function hasExtension(basename: string): boolean {
  return basename.includes('.');
}

/** Resolve package.json main/module entry for a directory. */
function resolvePackageEntry(dirPath: string): string | null {
  const pkgJsonFile = resolvePath(dirPath, 'package.json');
  if (!pkgJsonFile.query_exists(null)) return null;

  const pkg = readJSON(pkgJsonFile.get_path()!) as Record<string, string>;
  const main = pkg.main || pkg.module || 'index.js';
  const entryFile = resolvePath(dirPath, main);

  if (entryFile.query_exists(null)) return entryFile.get_path()!;

  // Try .js extension fallback for extensionless main field
  if (!hasExtension(main)) {
    const withJs = tryJsExtension(entryFile.get_path()!);
    if (withJs) return withJs.get_path()!;
  }

  return null;
}

/** Convert a file: URL (string or object) to an absolute path. */
function fileUrlToPath(filenameOrURL: string | URL): string {
  // Duck-type URL objects (avoids dependency on global URL which may not exist in GJS)
  if (typeof filenameOrURL === 'object' && filenameOrURL !== null && 'href' in filenameOrURL) {
    const urlObj = filenameOrURL as { href: string; protocol?: string };
    if (urlObj.protocol && urlObj.protocol !== 'file:') {
      throw new TypeError('The URL must use the file: protocol');
    }
    return GLib.filename_from_uri(urlObj.href)[0];
  }

  if (typeof filenameOrURL === 'string' && filenameOrURL.startsWith('file:')) {
    return GLib.filename_from_uri(filenameOrURL)[0];
  }

  return String(filenameOrURL);
}

/** Resolve a module specifier to an absolute file path. */
function resolveModulePath(id: string, callerDir: string): string {
  if (isBuiltin(id)) return id;

  let file: Gio.File;

  if (id.startsWith('/')) {
    file = resolvePath(id);
  } else if (id.startsWith('.')) {
    file = resolvePath(callerDir, id);
  } else {
    const nodeModules = findNodeModulesDir(callerDir);
    if (!nodeModules) {
      throw new Error(`Cannot find module "${id}" - no node_modules directory found`);
    }
    file = resolvePath(nodeModules, id);
  }

  // Extension fallback for extensionless paths
  if (!file.query_exists(null)) {
    const basename = file.get_basename();
    if (basename && !hasExtension(basename)) {
      file = tryJsExtension(file.get_path()!) ?? file;
    }
  }

  if (!file.query_exists(null)) {
    throw new Error(`Cannot find module "${id}"`);
  }

  const resolvedPath = resolveSymlink(file);

  // Directory → resolve via package.json main field
  const basename = file.get_basename();
  if (basename && !hasExtension(basename)) {
    const entry = resolvePackageEntry(resolvedPath);
    if (entry) return entry;
  }

  return resolvedPath;
}

// --- CJS file loading via GJS imports system ---
// Ported from @gjsify/require (c) Andrea Giammarchi - ISC

/** Load a CJS .js/.cjs file using GJS's legacy imports system. */
function requireJsFile(filePath: string, cache: Record<string, unknown>): unknown {
  if (filePath in cache) return cache[filePath];

  let file = Gio.File.new_for_path(filePath);
  const dir = file.get_parent()!.get_path()!;
  let basename = file.get_basename()!;

  if (basename.endsWith('.mjs')) {
    throw new Error(`Cannot require .mjs files. Use import instead. Path: "${filePath}"`);
  }

  // GJS can't import .cjs files — copy to .js as workaround
  if (basename.endsWith('.cjs')) {
    const dest = resolvePath(dir, '__gjsify__' + basename.replace(/\.cjs$/, '.js'));
    if (dest.query_exists(null)) dest.delete(null);
    file.copy(dest, Gio.FileCopyFlags.NONE, null, null);
    file = dest;
    basename = file.get_basename()!;
  }

  // Save and replace global CJS state
  const savedExports = globalThis.exports;
  const savedModule = globalThis.module;
  const moduleObj = { exports: {} };
  globalThis.exports = moduleObj.exports;
  globalThis.module = moduleObj as NodeModule;

  try {
    // Evaluate the file via GJS imports system
    const { searchPath } = imports;
    searchPath.unshift(dir);
    imports[basename.replace(/\.(js|cjs)$/, '')];
    searchPath.shift();

    const result = moduleObj.exports;
    cache[filePath] = result;
    return result;
  } finally {
    // Always restore global state, even on error
    globalThis.exports = savedExports;
    globalThis.module = savedModule;
  }
}

export function createRequire(filenameOrURL: string | URL): NodeRequire {
  const filename = fileUrlToPath(filenameOrURL);

  if (!filename.startsWith('/')) {
    throw new TypeError(
      'The argument must be a file URL object, file URL string, or absolute path string. ' +
      `Received "${String(filenameOrURL)}"`
    );
  }

  const callerDir = GLib.path_get_dirname(filename);
  const cache: Record<string, unknown> = Object.create(null);

  const req = function require(id: string): unknown {
    const resolved = resolveModulePath(id, callerDir);
    if (resolved in cache) return cache[resolved];

    // JSON files
    if (resolved.endsWith('.json')) {
      const result = readJSON(resolved);
      cache[resolved] = result;
      return result;
    }

    // Builtin modules can't be required synchronously in ESM
    if (isBuiltin(id)) {
      throw new Error(
        `createRequire: Cannot require builtin module "${id}" synchronously in GJS. ` +
        'Use import instead.'
      );
    }

    // .js/.cjs files via GJS imports system
    return requireJsFile(resolved, cache);
  } as NodeRequire;

  req.resolve = function resolve(id: string): string {
    return resolveModulePath(id, callerDir);
  } as NodeRequire['resolve'];

  req.resolve.paths = (_request: string): string[] | null => null;
  req.cache = cache;
  req.extensions = Object.create(null) as NodeRequire['extensions'];
  req.main = undefined;

  return req;
}

export default { builtinModules, isBuiltin, createRequire };
