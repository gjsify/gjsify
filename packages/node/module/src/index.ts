// Reference: Node.js lib/module.js
// Reimplemented for GJS using Gio and GLib
// CJS loading logic adapted from @gjsify/require (c) Andrea Giammarchi - ISC

import '@girs/gjs';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { resolve as resolvePath, readJSON } from '@gjsify/utils';
import { findPnpManifest, loadPnpManifest, resolveBareViaPnp } from './pnp.js';

export const builtinModules = [
  'assert',
  'async_hooks',
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

  const pkg = readJSON(pkgJsonFile.get_path()!) as Record<string, unknown>;

  // `exports` map first — when present, it MUST be the authoritative
  // resolution for the root entry. The legacy `main`/`module` fields are
  // only consulted as a fallback (or when no exports map exists).
  if (pkg['exports'] !== undefined) {
    const resolvedFromExports = resolveExportsMap(pkg['exports'], '.', DEFAULT_EXPORT_CONDITIONS);
    if (resolvedFromExports) {
      const resolved = resolvePath(dirPath, resolvedFromExports);
      if (resolved.query_exists(null)) return resolved.get_path()!;
    }
  }

  const main = (pkg['main'] as string | undefined) || (pkg['module'] as string | undefined) || 'index.js';
  const entryFile = resolvePath(dirPath, main);

  if (entryFile.query_exists(null)) return entryFile.get_path()!;

  // Try .js extension fallback for extensionless main field
  if (!hasExtension(main)) {
    const withJs = tryJsExtension(entryFile.get_path()!);
    if (withJs) return withJs.get_path()!;
  }

  return null;
}

/**
 * Resolve a `pkg.exports`-map entry into a relative file path.
 *
 * Implements a useful subset of the Node ESM Package Exports spec
 * (https://nodejs.org/api/packages.html#package-entry-points):
 *   - shorthand string form (`"exports": "./lib/index.js"`)
 *   - object form with `.` + `./<subpath>` keys
 *   - conditional resolution against `conditions` in order (first match wins)
 *   - `null` value → block (return undefined, caller treats as not-exported)
 *
 * Pattern wildcards (`./shims/*`) and subpath imports (`#internal`) are
 * out of scope for now — the surface we need right now is fixed-key
 * subpaths like `./shims/console-gjs`. Each gap surfaces a clear caller
 * error rather than silent miss.
 *
 * @param exportsField Raw value of `pkg.exports`.
 * @param subpath The requested subpath, including the leading `./`
 *   (so `.` for root, `./foo` for `pkg/foo`).
 * @param conditions Ordered condition list — first one that has a value
 *   wins. Standard order: `["node", "import", "default"]` for GJS.
 */
function resolveExportsMap(
  exportsField: unknown,
  subpath: string,
  conditions: readonly string[],
): string | undefined {
  if (typeof exportsField === 'string') {
    // Shorthand: `"exports": "./lib/index.js"` applies to `.` only.
    return subpath === '.' ? exportsField : undefined;
  }
  if (exportsField === null || typeof exportsField !== 'object') return undefined;
  const map = exportsField as Record<string, unknown>;

  // If the map has no `.`-prefixed keys, it's purely a condition map
  // applying to root (`.`) — wrap it under `.` for the lookup.
  const hasSubpathKeys = Object.keys(map).some((k) => k === '.' || k.startsWith('./'));
  const lookup = hasSubpathKeys ? map[subpath] : (subpath === '.' ? map : undefined);
  if (lookup === undefined || lookup === null) return undefined;

  return pickConditionalValue(lookup, conditions);
}

/**
 * Walk a conditional-export node, picking the first matching condition.
 * `lookup` is either a leaf (string/null) or a nested condition map.
 */
function pickConditionalValue(lookup: unknown, conditions: readonly string[]): string | undefined {
  if (typeof lookup === 'string') return lookup;
  if (lookup === null || typeof lookup !== 'object') return undefined;
  const map = lookup as Record<string, unknown>;
  // `default` always wins as the final fallback inside the conditions
  // we recognize, but other conditions take precedence in the order the
  // caller provides them (e.g. `node` before `import`).
  for (const cond of conditions) {
    if (cond in map) {
      const resolved = pickConditionalValue(map[cond], conditions);
      if (resolved !== undefined) return resolved;
    }
  }
  if ('default' in map && !conditions.includes('default')) {
    return pickConditionalValue(map['default'], conditions);
  }
  return undefined;
}

const DEFAULT_EXPORT_CONDITIONS: readonly string[] = ['node', 'import', 'default'];

/**
 * Extract `<pkgName>` and `<subpath>` from a bare specifier:
 *   `lodash`          → { pkg: 'lodash',          subpath: '.' }
 *   `@scope/foo`      → { pkg: '@scope/foo',      subpath: '.' }
 *   `@scope/foo/bar`  → { pkg: '@scope/foo',      subpath: './bar' }
 *   `lodash/fp`       → { pkg: 'lodash',          subpath: './fp' }
 */
function splitBareSpecifier(id: string): { pkg: string; subpath: string } {
  if (id.startsWith('@')) {
    const slash1 = id.indexOf('/');
    if (slash1 === -1) return { pkg: id, subpath: '.' };
    const slash2 = id.indexOf('/', slash1 + 1);
    if (slash2 === -1) return { pkg: id, subpath: '.' };
    return { pkg: id.slice(0, slash2), subpath: '.' + id.slice(slash2) };
  }
  const slash = id.indexOf('/');
  if (slash === -1) return { pkg: id, subpath: '.' };
  return { pkg: id.slice(0, slash), subpath: '.' + id.slice(slash) };
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

/**
 * Try resolving a bare specifier through a Yarn PnP manifest (`.pnp.cjs`)
 * sitting above `callerDir`. Returns null when no manifest is found, or when
 * PnP can't resolve the request (e.g. the dep isn't listed in the caller
 * package's `packageDependencies`). Callers fall back to the node_modules walk.
 */
function resolveBareViaPnpFromCaller(id: string, callerDir: string): Gio.File | null {
  const pnpPath = findPnpManifest(callerDir);
  if (!pnpPath) return null;
  const manifest = loadPnpManifest(pnpPath);
  if (!manifest) return null;
  const resolved = resolveBareViaPnp(manifest, id, callerDir);
  if (!resolved) return null;
  const file = Gio.File.new_for_path(resolved);
  return file.query_exists(null) ? file : null;
}

/**
 * Resolve a bare package specifier by walking ALL ancestor node_modules dirs.
 * Mirrors Node.js module resolution: try nearest node_modules first, then each
 * ancestor — so a package in a parent node_modules is found even when a closer
 * node_modules exists but doesn't contain the requested package.
 */
function resolveInNodeModules(id: string, callerDir: string): Gio.File {
  const { pkg: pkgName, subpath } = splitBareSpecifier(id);
  let dir = Gio.File.new_for_path(callerDir);
  while (dir.has_parent(null)) {
    const nodeModulesFile = dir.resolve_relative_path('node_modules');
    if (nodeModulesFile.query_exists(null)) {
      const pkgDir = nodeModulesFile.resolve_relative_path(pkgName);
      if (pkgDir.query_exists(null)) {
        // Try the package's `exports` map for the requested subpath
        // (including `.` for the package root). The map is authoritative
        // when present — Node would only fall back to literal-path or
        // `main`/`module` when no `exports` exists.
        const pkgJson = pkgDir.resolve_relative_path('package.json');
        if (pkgJson.query_exists(null)) {
          const manifest = readJSON(pkgJson.get_path()!) as Record<string, unknown>;
          if (manifest['exports'] !== undefined) {
            const relative = resolveExportsMap(manifest['exports'], subpath, DEFAULT_EXPORT_CONDITIONS);
            if (relative !== undefined) {
              const target = pkgDir.resolve_relative_path(relative);
              if (target.query_exists(null)) return target;
              // fall through to literal-path on miss — keeps the
              // behavior conservative when an exports entry points at
              // a non-existent file
            }
          }
        }
        // Literal-path fallback (subpath used as plain relative path
        // under the package dir, or `.` resolved to the dir itself).
        const candidate = subpath === '.' ? pkgDir : pkgDir.resolve_relative_path(subpath.slice(2));
        if (candidate.query_exists(null)) return candidate;
        const bn = candidate.get_basename();
        if (bn && !hasExtension(bn)) {
          const withJs = tryJsExtension(candidate.get_path()!);
          if (withJs) return withJs;
        }
      } else {
        // Original behavior for the no-pkgDir case — literal `node_modules/id`
        // walk, handles edge cases like single-file shims at the root.
        const candidate = nodeModulesFile.resolve_relative_path(id);
        if (candidate.query_exists(null)) return candidate;
        const bn = candidate.get_basename();
        if (bn && !hasExtension(bn)) {
          const withJs = tryJsExtension(candidate.get_path()!);
          if (withJs) return withJs;
        }
      }
    }
    dir = dir.get_parent()!;
  }
  throw new Error(`Cannot find module "${id}" - not found in any node_modules directory`);
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
    // Bare specifier: try Yarn PnP first (for PnP-built workspaces where no
    // node_modules/ tree exists on disk), then fall back to the standard
    // node_modules walk.
    const pnpFile = resolveBareViaPnpFromCaller(id, callerDir);
    file = pnpFile ?? resolveInNodeModules(id, callerDir);
  }

  // Extension fallback for absolute/relative paths (bare specifiers handled in resolveInNodeModules)
  if (id.startsWith('/') || id.startsWith('.')) {
    if (!file.query_exists(null)) {
      const basename = file.get_basename();
      if (basename && !hasExtension(basename)) {
        file = tryJsExtension(file.get_path()!) ?? file;
      }
    }

    if (!file.query_exists(null)) {
      throw new Error(`Cannot find module "${id}"`);
    }
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
  req.cache = cache as NodeRequire['cache'];
  req.extensions = Object.create(null) as NodeRequire['extensions'];
  req.main = undefined;

  return req;
}

export default { builtinModules, isBuiltin, createRequire };
