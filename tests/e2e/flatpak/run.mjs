// E2E test for the `gjsify flatpak` subcommand group.
//
// Strategy: stub `flatpak-builder` and `flatpak-node-generator` with shell
// shims on PATH so the test can exercise the full CLI surface without
// requiring the real tools (which need a privileged container and a
// Flathub setup). The shims write expected output files and exit 0; the
// CLI's plumbing (manifest generation, workflow YAML scaffold, env-driven
// path/runtime resolution) is the actual behaviour under test.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProject,
} from '../helpers.mjs';

describe('CLI flatpak subcommand group E2E', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;
  let stubBinDir;
  let pathWithStubs;

  before(() => {
    const env = createTestEnvironment('gjsify-e2e-flatpak-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    projectDir = join(tmpDir, 'flatpak-project');
    mkdirSync(projectDir, { recursive: true });
    setupProject(projectDir, {
      name: 'org.example.FlatpakSmoke',
      version: '1.2.3',
      type: 'module',
      private: true,
      dependencies: { '@gjsify/cli': '^0.1.0' },
      gjsify: {
        flatpak: {
          appId: 'org.example.FlatpakSmoke',
          runtime: 'gnome',
          runtimeVersion: '50',
          sdkExtensions: ['org.freedesktop.Sdk.Extension.node24'],
        },
      },
    }, tarballsDir, tarballMap);

    // Stub `flatpak-builder`, `flatpak-node-generator`, and `flatpak`
    // (used by `flatpak build-bundle`) on PATH. The shims trace their
    // invocation into a marker file so tests can assert call shape.
    stubBinDir = join(tmpDir, 'stub-bin');
    mkdirSync(stubBinDir, { recursive: true });
    writeShim(stubBinDir, 'flatpak-builder', 'BUILDER_CALLS');
    writeShim(stubBinDir, 'flatpak-node-generator', 'NODE_GENERATOR_CALLS', /* createFile */ true);
    writeShim(stubBinDir, 'flatpak', 'FLATPAK_CALLS');

    pathWithStubs = `${stubBinDir}:${process.env.PATH ?? ''}`;
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  it('flatpak init writes a GNOME-Platform manifest with build-options', () => {
    execFileSync('npx', ['gjsify', 'flatpak', 'init'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    const manifestPath = join(projectDir, 'org.example.FlatpakSmoke.json');
    assert.ok(existsSync(manifestPath), 'manifest missing');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    assert.equal(manifest.id, 'org.example.FlatpakSmoke');
    assert.equal(manifest.runtime, 'org.gnome.Platform');
    assert.equal(manifest['runtime-version'], '50');
    assert.equal(manifest.sdk, 'org.gnome.Sdk');
    assert.deepEqual(manifest['sdk-extensions'], ['org.freedesktop.Sdk.Extension.node24']);
    assert.match(manifest['build-options']['append-path'], /\/usr\/lib\/sdk\/node24\/bin/);
    assert.deepEqual(manifest['finish-args'], [
      '--device=dri', '--share=ipc', '--socket=fallback-x11', '--socket=wayland',
    ]);
    assert.equal(manifest.modules[0].name, 'FlatpakSmoke');
    assert.equal(manifest.modules[0].buildsystem, 'meson');
  });

  it('flatpak init --cli-only strips GUI finish-args but keeps GNOME runtime', () => {
    const cliManifest = join(projectDir, 'cli.json');
    execFileSync('npx', ['gjsify', 'flatpak', 'init', '--cli-only', '--manifest', cliManifest, '--force'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    const manifest = JSON.parse(readFileSync(cliManifest, 'utf-8'));
    assert.equal(manifest.runtime, 'org.gnome.Platform', '--cli-only must keep GNOME runtime — GJS bundles need GLib/GIO at runtime');
    assert.deepEqual(manifest['finish-args'], [], 'GUI finish-args must be stripped under --cli-only');
  });

  it('flatpak init refuses to overwrite without --force', () => {
    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync('npx', ['gjsify', 'flatpak', 'init'], {
        cwd: projectDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60 * 1000,
      });
    } catch (e) {
      exitCode = e.status ?? -1;
      stderr = (e.stderr ?? '').toString();
    }
    assert.notStrictEqual(exitCode, 0, 'expected init to fail when target exists');
    assert.match(stderr, /exists.*--force/i, `expected exists hint, got: ${stderr}`);
  });

  it('flatpak ci writes the workflow file with the resolved container image', () => {
    execFileSync('npx', ['gjsify', 'flatpak', 'ci'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    const wfPath = join(projectDir, '.github/workflows/flatpak.yml');
    assert.ok(existsSync(wfPath), 'workflow missing');
    const yaml = readFileSync(wfPath, 'utf-8');
    assert.match(yaml, /image: ghcr\.io\/flathub-infra\/flatpak-github-actions:gnome-50/);
    assert.match(yaml, /manifest-path: org\.example\.FlatpakSmoke\.json/);
    assert.match(yaml, /bundle: org\.example\.FlatpakSmoke\.flatpak/);
    assert.match(yaml, /flatpak\/flatpak-github-actions\/flatpak-builder@v6/);
  });

  it('flatpak ci is idempotent — second invocation without --force is a no-op when content is byte-identical', () => {
    // Re-run with same args. Should NOT throw.
    const stdout = execFileSync('npx', ['gjsify', 'flatpak', 'ci'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    }).toString();
    assert.match(stdout, /already up to date/i, `expected idempotent skip, got: ${stdout}`);
  });

  it('flatpak deps invokes flatpak-node-generator and writes the sources file', () => {
    writeFileSync(join(projectDir, 'yarn.lock'), '# fixture lockfile\n');
    execFileSync('npx', ['gjsify', 'flatpak', 'deps', '--out', 'flatpak-node-sources.json'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
      env: { ...process.env, PATH: pathWithStubs },
    });
    assert.ok(
      existsSync(join(projectDir, 'flatpak-node-sources.json')),
      'flatpak-node-sources.json missing — stub did not write the expected output',
    );
    // Verify the stub recorded exactly one invocation with `yarn` + the
    // lockfile + -o + the output path + --xdg-layout.
    const calls = readFileSync(join(stubBinDir, 'NODE_GENERATOR_CALLS'), 'utf-8').trim().split('\n');
    assert.ok(calls.length >= 1, 'stub recorded no calls');
    const last = calls[calls.length - 1];
    assert.match(last, /^yarn\s+/, `expected yarn-form call, got: ${last}`);
    assert.match(last, /yarn\.lock/);
    assert.match(last, /flatpak-node-sources\.json/);
    assert.match(last, /--xdg-layout/);
  });

  it('flatpak build invokes flatpak-builder with the resolved manifest path', () => {
    // Earlier tests in this suite produced TWO manifests (the default
    // app-id one + the cli.json from --cli-only), so we pass the manifest
    // explicitly here. The auto-detect path is exercised manually by the
    // smoke test in the project README; locking it down in this suite
    // would require erasing the cli.json fixture between tests.
    execFileSync('npx', ['gjsify', 'flatpak', 'build', 'org.example.FlatpakSmoke.json'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
      env: { ...process.env, PATH: pathWithStubs },
    });
    const calls = readFileSync(join(stubBinDir, 'BUILDER_CALLS'), 'utf-8').trim().split('\n');
    assert.ok(calls.length >= 1, 'stub recorded no flatpak-builder calls');
    const last = calls[calls.length - 1];
    assert.match(last, /--force-clean/);
    assert.match(last, /--sandbox/);
    assert.match(last, /--delete-build-dirs/);
    assert.match(last, /flatpak-build/);
    assert.match(last, /org\.example\.FlatpakSmoke\.json/);
  });
});

/**
 * Write a shell shim that:
 *   1. Appends its `$@` arguments to `<binDir>/<traceFile>`
 *   2. If `createFile` is true, parses `-o <path>` and `touch`es it
 *      (so the CLI's downstream existence checks succeed).
 *   3. Exits 0.
 */
function writeShim(binDir, name, traceFile, createFile = false) {
  const trace = join(binDir, traceFile);
  const lines = [
    '#!/bin/sh',
    `echo "$@" >> ${shellQuote(trace)}`,
  ];
  if (createFile) {
    lines.push(
      // crude `-o <path>` extraction
      'out=""',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    -o) out="$2"; shift 2 ;;',
      '    *) shift ;;',
      '  esac',
      'done',
      '[ -n "$out" ] && : > "$out"',
    );
  }
  lines.push('exit 0');

  const path = join(binDir, name);
  writeFileSync(path, lines.join('\n') + '\n', 'utf-8');
  chmodSync(path, 0o755);
}

function shellQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
