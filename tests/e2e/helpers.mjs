// Shared E2E test helpers for @gjsify CLI/plugin workflows.

import { execFileSync, execSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const MONOREPO_ROOT = join(__dirname, '..', '..');

/**
 * Pack all workspace tarballs via pack.mjs into tarballsDir.
 * Returns { "@gjsify/foo": "@gjsify-foo.tgz", ... } map.
 */
export function packWorkspaces(tarballsDir) {
  const stdout = execFileSync('node', [join(__dirname, 'pack.mjs'), tarballsDir], {
    cwd: MONOREPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  });
  return JSON.parse(stdout);
}

/**
 * Create a temporary directory for an E2E test.
 * Returns { tmpDir, tarballsDir, tarballMap }.
 */
export function createTestEnvironment(prefix = 'gjsify-e2e-') {
  const tmpDir = mkdtempSync(join(tmpdir(), prefix));
  const tarballsDir = join(tmpDir, 'tarballs');

  console.log(`  tmp dir: ${tmpDir}`);
  console.log('  packing workspace packages...');
  const tarballMap = packWorkspaces(tarballsDir);
  console.log(`  packed ${Object.keys(tarballMap).length} packages`);

  return { tmpDir, tarballsDir, tarballMap };
}

/**
 * Clean up a temporary directory unless GJSIFY_E2E_KEEP_TEMP is set.
 */
export function cleanupTestEnvironment(tmpDir) {
  if (process.env.GJSIFY_E2E_KEEP_TEMP) {
    console.log(`  keeping tmp dir: ${tmpDir}`);
  } else if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Build an npm `overrides` object pointing all @gjsify/* packages to local tarballs.
 */
export function buildOverrides(tarballsDir, tarballMap) {
  const overrides = {};
  for (const [name, filename] of Object.entries(tarballMap)) {
    overrides[name] = `file:${join(tarballsDir, filename)}`;
  }
  return overrides;
}

/**
 * Convert a package name to its tarball file: reference, or return undefined.
 */
export function toFileRef(name, tarballsDir, tarballMap) {
  const filename = tarballMap[name];
  if (!filename) return undefined;
  return `file:${join(tarballsDir, filename)}`;
}

/**
 * Write a package.json, install deps, and return the project dir.
 */
export function setupProject(projectDir, pkg, tarballsDir, tarballMap) {
  // Patch all @gjsify/* deps to local tarballs
  for (const field of ['dependencies', 'devDependencies']) {
    if (!pkg[field]) continue;
    for (const name of Object.keys(pkg[field])) {
      const ref = toFileRef(name, tarballsDir, tarballMap);
      if (ref) pkg[field][name] = ref;
    }
  }

  // Add overrides for transitive deps
  pkg.overrides = buildOverrides(tarballsDir, tarballMap);

  writeFileSync(join(projectDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  console.log('  running npm install...');
  execSync('npm install --no-audit --no-fund', {
    cwd: projectDir,
    stdio: 'pipe',
    timeout: 3 * 60 * 1000,
  });
  console.log('  npm install done');
}

/**
 * Build a Yarn `resolutions` map redirecting all @gjsify/* requests to local tarballs.
 * Used together with `nodeLinker: pnp` to simulate an external npm-installed consumer.
 */
export function buildYarnResolutions(tarballsDir, tarballMap) {
  const resolutions = {};
  for (const [name, filename] of Object.entries(tarballMap)) {
    resolutions[name] = `file:${join(tarballsDir, filename)}`;
  }
  return resolutions;
}

/**
 * Write a Yarn-PnP-flavoured project, install deps, and return the project dir.
 *
 * Distinct from setupProject (which uses npm + node-modules linker): this
 * exercises the gjsify CLI under Yarn 4 with `nodeLinker: pnp`, the same
 * setup external consumers like ts-for-gir use. It validates that the
 * two-hop PnP relay in @gjsify/cli's build action resolves transitive
 * @gjsify/* polyfills (fs, path, child_process, ...) without each one
 * needing to be a direct devDep.
 *
 * Requires `yarn` (>= 4) on PATH. The test skips itself if yarn is missing.
 */
export function setupProjectYarnPnp(projectDir, pkg, tarballsDir, tarballMap) {
  // Patch direct @gjsify/* deps to tarball file: refs.
  for (const field of ['dependencies', 'devDependencies']) {
    if (!pkg[field]) continue;
    for (const name of Object.keys(pkg[field])) {
      const ref = toFileRef(name, tarballsDir, tarballMap);
      if (ref) pkg[field][name] = ref;
    }
  }

  // Yarn `resolutions` is the PnP equivalent of npm `overrides` — pins every
  // transitive @gjsify/* (e.g. @gjsify/fs reached through @gjsify/node-polyfills)
  // to the same local tarball, so the test validates relay behavior, not registry
  // version skew.
  pkg.resolutions = buildYarnResolutions(tarballsDir, tarballMap);
  pkg.packageManager = 'yarn@4.14.1';

  writeFileSync(join(projectDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  writeFileSync(
    join(projectDir, '.yarnrc.yml'),
    [
      'nodeLinker: pnp',
      'enableScripts: false',
      'enableGlobalCache: false',
      'enableTelemetry: false',
      '',
    ].join('\n'),
  );

  console.log('  running yarn install (PnP)...');
  execFileSync('yarn', ['install', '--no-immutable'], {
    cwd: projectDir,
    stdio: 'pipe',
    timeout: 5 * 60 * 1000,
    env: { ...process.env, YARN_ENABLE_HARDENED_MODE: '0' },
  });
  console.log('  yarn install done');
}

/** True when the given executable is on PATH. */
export function hasCommand(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
