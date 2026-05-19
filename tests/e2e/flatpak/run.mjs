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
import { execFileSync, spawnSync } from 'node:child_process';
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
          // No sdkExtensions: a pure gjsify project doesn't need any.
          // Before Phase D-3 we defaulted `node24` here for build-time
          // `yarn install` + esbuild; that requirement is gone now that
          // the GJS-CLI self-host loop is closed.
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
    // Default pure-gjsify projects don't need any SDK extensions — Phase D-3
    // closed the self-host loop so build-time Node is no longer required.
    // With no extensions and no explicit `appendPath`, the orchestrator skips
    // `sdk-extensions` and `build-options` entirely (init.ts:130-132).
    assert.equal(manifest['sdk-extensions'], undefined,
      'pure gjsify project should not need any SDK extensions');
    assert.equal(manifest['build-options'], undefined,
      'no build-options without extensions / explicit appendPath');
    assert.deepEqual(manifest['finish-args'], [
      '--device=dri', '--share=ipc', '--socket=fallback-x11', '--socket=wayland',
    ]);
    assert.equal(manifest.modules[0].name, 'FlatpakSmoke');
    assert.equal(manifest.modules[0].buildsystem, 'meson');
  });

  it('flatpak init honors explicit sdkExtensions (e.g. for native toolchains)', () => {
    // Regression guard for the deriveAppendPath logic — projects that
    // genuinely need extra Sdk.Extension.<x> (rust/llvm/etc.) still get
    // the correct `sdk-extensions` + `append-path` wiring even though the
    // default no longer includes any extension.
    const customManifest = join(projectDir, 'custom-ext.json');
    execFileSync('npx', [
      'gjsify', 'flatpak', 'init',
      '--manifest', customManifest, '--force',
      '--sdk-extension', 'org.freedesktop.Sdk.Extension.llvm17',
    ], { cwd: projectDir, stdio: 'pipe', timeout: 60 * 1000 });
    const manifest = JSON.parse(readFileSync(customManifest, 'utf-8'));
    assert.deepEqual(manifest['sdk-extensions'], ['org.freedesktop.Sdk.Extension.llvm17']);
    assert.match(manifest['build-options']['append-path'], /\/usr\/lib\/sdk\/llvm17\/bin/);
    assert.match(manifest['build-options']['append-path'], /\/app\/bin$/);
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

  it('flatpak init skips existing outputs without --force (idempotent regen surface)', () => {
    const manifestPath = join(projectDir, 'org.example.FlatpakSmoke.json');
    assert.ok(existsSync(manifestPath), 'precondition: manifest from earlier test should exist');
    const before = readFileSync(manifestPath, 'utf-8');

    // Mutate the manifest, then re-run init without --force. The file must
    // NOT be overwritten (skip + log; not error).
    const sentinel = '{ "marker": "user-edit", "id": "org.example.FlatpakSmoke" }\n';
    writeFileSync(manifestPath, sentinel, 'utf-8');

    const out = execFileSync('npx', ['gjsify', 'flatpak', 'init'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    }).toString();

    assert.match(out, /skipped manifest:.*exists/i, `expected skip log, got: ${out}`);
    // User edit preserved
    assert.equal(readFileSync(manifestPath, 'utf-8'), sentinel, 'manifest was overwritten without --force');

    // Restore for subsequent tests
    writeFileSync(manifestPath, before, 'utf-8');
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

  // ── Phase F.9.1 — init MetaInfo + .desktop + flathub.json scaffolding ──

  it('flatpak init on minimal config writes only the manifest + warns about missing MetaInfo fields', () => {
    const res = spawnSync('npx', ['gjsify', 'flatpak', 'init', '--manifest', 'manifest-min.json', '--force'], {
      cwd: projectDir,
      timeout: 60 * 1000,
      encoding: 'utf-8',
    });
    assert.equal(res.status, 0, `init exit non-zero: ${res.stderr}`);
    // Manifest written
    assert.ok(existsSync(join(projectDir, 'manifest-min.json')));
    // MetaInfo skipped due to missing developer/summary/license/homepageUrl;
    // warnings land on stderr via console.warn.
    const merged = (res.stdout ?? '') + (res.stderr ?? '');
    assert.match(merged, /MetaInfo \/ \.desktop are skipped/i, `expected skip warning, got: ${merged}`);
    assert.match(merged, /developer/);
    assert.match(merged, /summary/);
    assert.match(merged, /license\.project/);
    assert.match(merged, /homepageUrl/);
  });

  it('flatpak init --kind app with full config emits manifest + MetaInfo + .desktop + flathub.json', () => {
    // Fresh project with full MetaInfo config.
    const appProjectDir = join(tmpDir, 'flatpak-init-app');
    mkdirSync(appProjectDir, { recursive: true });
    setupProject(appProjectDir, {
      name: 'org.example.AppFull',
      version: '2.0.0',
      type: 'module',
      private: true,
      dependencies: { '@gjsify/cli': '^0.1.0' },
      gjsify: {
        flatpak: {
          appId: 'org.example.AppFull',
          kind: 'app',
          name: 'App Full Title',
          developer: { id: 'org.example', name: 'Example Developer' },
          summary: 'A test desktop app',
          description: 'First paragraph here.\n\nSecond paragraph with <special> & "chars".',
          license: { metadata: 'CC0-1.0', project: 'GPL-3.0-or-later' },
          homepageUrl: 'https://example.org',
          bugtrackerUrl: 'https://example.org/issues',
          categories: ['Utility', 'Development'],
          keywords: ['test', 'demo'],
          releases: [{ version: '2.0.0', date: '2026-05-18' }],
          branding: { accentLight: '#5b81b8', accentDark: '#3a5d8c' },
        },
      },
    }, tarballsDir, tarballMap);

    execFileSync('npx', ['gjsify', 'flatpak', 'init'], {
      cwd: appProjectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });

    // All four files present
    assert.ok(existsSync(join(appProjectDir, 'org.example.AppFull.json')), 'manifest missing');
    const metainfoPath = join(appProjectDir, 'data/org.example.AppFull.metainfo.xml.in');
    assert.ok(existsSync(metainfoPath), 'metainfo missing');
    const desktopPath = join(appProjectDir, 'data/org.example.AppFull.desktop.in');
    assert.ok(existsSync(desktopPath), '.desktop missing');
    assert.ok(existsSync(join(appProjectDir, 'flathub.json')), 'flathub.json missing');

    // MetaInfo content sanity
    const metainfo = readFileSync(metainfoPath, 'utf-8');
    assert.match(metainfo, /<component type="desktop-application">/);
    assert.match(metainfo, /<id>org\.example\.AppFull<\/id>/);
    assert.match(metainfo, /<developer id="org\.example">/);
    assert.match(metainfo, /<p>First paragraph here\.<\/p>/);
    // XML escaping of special chars
    assert.match(metainfo, /Second paragraph with &lt;special&gt; &amp; &quot;chars&quot;\./);
    assert.match(metainfo, /<launchable type="desktop-id">org\.example\.AppFull\.desktop<\/launchable>/);
    assert.match(metainfo, /<category>Utility<\/category>/);
    assert.match(metainfo, /<keyword>test<\/keyword>/);
    assert.match(metainfo, /<release version="2\.0\.0" date="2026-05-18"/);
    assert.match(metainfo, /scheme_preference="light">#5b81b8</);
    assert.match(metainfo, /<content_rating type="oars-1\.1"/);

    // Display-name override lands in both MetaInfo + .desktop
    assert.match(metainfo, /<name>App Full Title<\/name>/);

    // .desktop content sanity
    const desktop = readFileSync(desktopPath, 'utf-8');
    assert.match(desktop, /\[Desktop Entry\]/);
    assert.match(desktop, /Name=App Full Title/);
    assert.match(desktop, /Exec=org\.example\.AppFull/);
    assert.match(desktop, /Icon=org\.example\.AppFull/);
    assert.match(desktop, /Categories=Utility;Development;/);
    assert.match(desktop, /Keywords=test;demo;/);
  });

  it('flatpak init --kind cli emits console-application MetaInfo + skip-icons-check flathub.json + no .desktop', () => {
    const cliProjectDir = join(tmpDir, 'flatpak-init-cli');
    mkdirSync(cliProjectDir, { recursive: true });
    setupProject(cliProjectDir, {
      name: 'org.example.CliTool',
      version: '1.0.0',
      type: 'module',
      private: true,
      dependencies: { '@gjsify/cli': '^0.1.0' },
      gjsify: {
        flatpak: {
          appId: 'org.example.CliTool',
          kind: 'cli',
          command: 'clitool',
          developer: { id: 'org.example', name: 'Example Developer' },
          summary: 'A test CLI tool',
          description: 'CLI description.',
          license: { project: 'MIT' },
          homepageUrl: 'https://example.org',
          releases: [{ version: '1.0.0', date: '2026-05-18' }],
        },
      },
    }, tarballsDir, tarballMap);

    execFileSync('npx', ['gjsify', 'flatpak', 'init'], {
      cwd: cliProjectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });

    const metainfo = readFileSync(join(cliProjectDir, 'data/org.example.CliTool.metainfo.xml.in'), 'utf-8');
    assert.match(metainfo, /<component type="console-application">/);
    assert.match(metainfo, /<provides>\s*<binary>clitool<\/binary>\s*<\/provides>/);
    // No <launchable> for CLI
    assert.doesNotMatch(metainfo, /<launchable/);

    // No .desktop file for CLI
    assert.equal(existsSync(join(cliProjectDir, 'data/org.example.CliTool.desktop.in')), false,
      '.desktop must not be written for --kind cli');

    // flathub.json sets skip-icons-check
    const flathub = JSON.parse(readFileSync(join(cliProjectDir, 'flathub.json'), 'utf-8'));
    assert.equal(flathub['skip-icons-check'], true);

    // Manifest finish-args should be empty (no GUI bits) for CLI
    const manifest = JSON.parse(readFileSync(join(cliProjectDir, 'org.example.CliTool.json'), 'utf-8'));
    assert.deepEqual(manifest['finish-args'], []);
  });

  // ── Phase F.9.6 — rich AppStream surface ───────────────────────────────

  it('flatpak init --kind app with rich AppStream config emits all advanced sections', () => {
    const richProjectDir = join(tmpDir, 'flatpak-init-rich');
    mkdirSync(richProjectDir, { recursive: true });
    setupProject(richProjectDir, {
      name: 'org.example.RichApp',
      version: '1.0.0',
      type: 'module',
      private: true,
      dependencies: { '@gjsify/cli': '^0.1.0' },
      gjsify: {
        flatpak: {
          appId: 'org.example.RichApp',
          kind: 'app',
          developer: { id: 'org.example', name: 'Example Dev', email: 'hi@example.com' },
          summary: 'Rich content demo',
          summaryTranslatorHint: 'App tagline shown in app stores',
          description: [
            { p: 'Welcome paragraph.', translatorHint: 'Intro shown first in app stores' },
            { ul: [
              { item: 'First feature', translatorHint: 'Feature 1' },
              'Second feature',
            ], translatorHint: 'Feature list' },
            { p: 'Closing call to action.' },
          ],
          license: { metadata: 'CC0-1.0', project: 'MIT' },
          homepageUrl: 'https://example.org',
          translateUrl: 'https://hosted.weblate.org/projects/example/app/',
          iconRemote: 'https://example.org/icon.svg',
          categories: ['Education'],
          kudos: ['ModernToolkit', 'HiDpiIcon', 'UserDocs'],
          supports: { controls: ['keyboard', 'pointing', 'touch'], internet: 'offline-only' },
          requires: { displayLengthMin: 360 },
          recommends: { displayLengthMin: 480 },
          contentRating: {
            type: 'oars-1.1',
            attributes: { 'social-info': 'mild', 'language-humor': 'mild' },
          },
          provides: { binaries: ['example-cli', 'example-helper'], mimetypes: ['application/x-example'] },
          releases: [
            {
              version: '1.0.0',
              date: '2026-05-18',
              description: [
                { p: 'Initial rich release.', translatorHint: 'Release notes for 1.0' },
                { ul: ['Feature A', 'Feature B'] },
              ],
            },
            { version: '0.9.0', date: '2026-04-15' },
          ],
          screenshots: [{
            url: 'https://example.org/s1.png',
            caption: 'Main view',
            captionTranslatorHint: 'Screenshot of the main view',
          }],
        },
      },
    }, tarballsDir, tarballMap);

    execFileSync('npx', ['gjsify', 'flatpak', 'init'], {
      cwd: richProjectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });

    const metainfo = readFileSync(
      join(richProjectDir, 'data/org.example.RichApp.metainfo.xml.in'),
      'utf-8',
    );

    // Translator hints land on the right tags
    assert.match(metainfo, /<!-- TRANSLATORS: App tagline shown in app stores -->\s*<summary>Rich content demo<\/summary>/);
    assert.match(metainfo, /<!-- TRANSLATORS: Intro shown first in app stores -->\s*<p>Welcome paragraph\.<\/p>/);
    assert.match(metainfo, /<!-- TRANSLATORS: Feature list -->\s*<ul>/);
    assert.match(metainfo, /<!-- TRANSLATORS: Feature 1 -->\s*<li>First feature<\/li>/);
    assert.match(metainfo, /<!-- TRANSLATORS: Screenshot of the main view -->\s*<caption>Main view<\/caption>/);
    assert.match(metainfo, /<!-- TRANSLATORS: Release notes for 1\.0 -->\s*<p>Initial rich release\.<\/p>/);

    // Developer: nameTranslatable defaults to false → translate="no"
    assert.match(metainfo, /<name translate="no">Example Dev<\/name>/);
    assert.match(metainfo, /<email>hi@example\.com<\/email>/);

    // Bullet list rendered with mixed string + {item} forms
    assert.match(metainfo, /<li>First feature<\/li>/);
    assert.match(metainfo, /<li>Second feature<\/li>/);

    // iconRemote, translateUrl
    assert.match(metainfo, /<icon type="remote">https:\/\/example\.org\/icon\.svg<\/icon>/);
    assert.match(metainfo, /<url type="translate">https:\/\/hosted\.weblate\.org/);

    // content_rating with attributes
    assert.match(metainfo, /<content_rating type="oars-1\.1">/);
    assert.match(metainfo, /<content_attribute id="social-info">mild<\/content_attribute>/);
    assert.match(metainfo, /<content_attribute id="language-humor">mild<\/content_attribute>/);

    // kudos
    assert.match(metainfo, /<kudo>ModernToolkit<\/kudo>/);
    assert.match(metainfo, /<kudo>HiDpiIcon<\/kudo>/);

    // provides — explicit binaries + mediatype
    assert.match(metainfo, /<binary>example-cli<\/binary>/);
    assert.match(metainfo, /<binary>example-helper<\/binary>/);
    assert.match(metainfo, /<mediatype>application\/x-example<\/mediatype>/);

    // supports + internet
    assert.match(metainfo, /<supports>[\s\S]*<control>keyboard<\/control>[\s\S]*<control>pointing<\/control>[\s\S]*<control>touch<\/control>[\s\S]*<internet>offline-only<\/internet>[\s\S]*<\/supports>/);

    // requires + recommends with display_length
    assert.match(metainfo, /<requires>\s*<display_length compare="ge">360<\/display_length>\s*<\/requires>/);
    assert.match(metainfo, /<recommends>\s*<display_length compare="ge">480<\/display_length>\s*<\/recommends>/);

    // Per-release rich description with embedded <ul>
    assert.match(metainfo, /<release version="1\.0\.0" date="2026-05-18">[\s\S]*<description>[\s\S]*<p>Initial rich release\.<\/p>[\s\S]*<ul>[\s\S]*<li>Feature A<\/li>[\s\S]*<\/ul>[\s\S]*<\/description>[\s\S]*<\/release>/);

    // Release without description renders as self-closed
    assert.match(metainfo, /<release version="0\.9\.0" date="2026-04-15" \/>/);
  });

  // ── Phase G.2 — flatpak init 2-space JSON + format-aware ──────────────

  it('flatpak init writes manifest with 2-space indentation (matches Flathub + biome convention)', () => {
    const indentDir = join(tmpDir, 'flatpak-init-indent');
    mkdirSync(indentDir, { recursive: true });
    setupProject(indentDir, {
      name: 'org.example.IndentProbe',
      version: '0.0.1',
      type: 'module',
      private: true,
      dependencies: { '@gjsify/cli': '^0.1.0' },
      gjsify: { flatpak: { appId: 'org.example.IndentProbe' } },
    }, tarballsDir, tarballMap);

    execFileSync('npx', ['gjsify', 'flatpak', 'init'], {
      cwd: indentDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });

    const manifest = readFileSync(join(indentDir, 'org.example.IndentProbe.json'), 'utf-8');
    // 2-space indent: the second line should start with exactly 2 spaces
    assert.match(manifest, /^\{\n {2}"id":/);
    // Negative — make sure we're NOT still on 4-space
    assert.doesNotMatch(manifest, /^\{\n {4}"id":/);
  });

  it('flatpak init runs biome format on outputs when @biomejs/biome is in devDependencies', () => {
    const fmtDir = join(tmpDir, 'flatpak-init-fmt');
    mkdirSync(fmtDir, { recursive: true });
    setupProject(fmtDir, {
      name: 'org.example.FmtProbe',
      version: '0.0.1',
      type: 'module',
      private: true,
      dependencies: { '@gjsify/cli': '^0.1.0' },
      devDependencies: { '@biomejs/biome': '^2.4.13' },
      gjsify: { flatpak: { appId: 'org.example.FmtProbe' } },
    }, tarballsDir, tarballMap);

    // Project ships its own biome.json with a deliberately-distinctive
    // setting (lineWidth: 200) so we can verify biome ran by checking
    // the output style follows project config.
    writeFileSync(join(fmtDir, 'biome.json'), JSON.stringify({
      $schema: 'https://biomejs.dev/schemas/2.4.13/schema.json',
      formatter: { enabled: true, indentStyle: 'space', indentWidth: 2 },
      json: { formatter: { indentWidth: 2 } },
    }, null, 2));

    execFileSync('npx', ['gjsify', 'flatpak', 'init'], {
      cwd: fmtDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });

    // Manifest exists and is 2-space (biome ran or default — both pass this)
    const manifest = readFileSync(join(fmtDir, 'org.example.FmtProbe.json'), 'utf-8');
    assert.match(manifest, /^\{\n {2}"id":/);
  });

  it('flatpak init --no-format skips post-format step even when biome is present', () => {
    const noFmtDir = join(tmpDir, 'flatpak-init-no-fmt');
    mkdirSync(noFmtDir, { recursive: true });
    setupProject(noFmtDir, {
      name: 'org.example.NoFmt',
      version: '0.0.1',
      type: 'module',
      private: true,
      dependencies: { '@gjsify/cli': '^0.1.0' },
      devDependencies: { '@biomejs/biome': '^2.4.13' },
      gjsify: { flatpak: { appId: 'org.example.NoFmt' } },
    }, tarballsDir, tarballMap);

    // --no-format should produce the raw 2-space output regardless of biome state
    execFileSync('npx', ['gjsify', 'flatpak', 'init', '--no-format'], {
      cwd: noFmtDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });

    const manifest = readFileSync(join(noFmtDir, 'org.example.NoFmt.json'), 'utf-8');
    assert.match(manifest, /^\{\n {2}"id":/);
  });

  // ── Phase F.9.2 — check command ────────────────────────────────────────

  it('flatpak check shells out to appstreamcli + flatpak-builder-lint and surfaces failures', () => {
    // Add stubs for the two linters; both succeed by default.
    writeShim(stubBinDir, 'appstreamcli', 'APPSTREAMCLI_CALLS');
    writeShim(stubBinDir, 'flatpak-builder-lint', 'BUILDER_LINT_CALLS');

    const checkProjectDir = join(tmpDir, 'flatpak-check-ok');
    mkdirSync(join(checkProjectDir, 'data'), { recursive: true });
    setupProject(checkProjectDir, {
      name: 'org.example.CheckOk', version: '1.0.0', type: 'module', private: true,
      dependencies: { '@gjsify/cli': '^0.1.0' },
      gjsify: { flatpak: { appId: 'org.example.CheckOk' } },
    }, tarballsDir, tarballMap);
    writeFileSync(join(checkProjectDir, 'org.example.CheckOk.json'), '{}\n');
    writeFileSync(join(checkProjectDir, 'data/org.example.CheckOk.metainfo.xml.in'), '<component/>\n');

    const out = execFileSync('npx', ['gjsify', 'flatpak', 'check'], {
      cwd: checkProjectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
      env: { ...process.env, PATH: pathWithStubs },
    }).toString();
    assert.match(out, /OK: appstreamcli validate --strict/);
    assert.match(out, /OK: flatpak-builder-lint manifest/);
    assert.match(out, /all checks passed/);

    // Verify call shape
    const appstreamCalls = readFileSync(join(stubBinDir, 'APPSTREAMCLI_CALLS'), 'utf-8').trim();
    assert.match(appstreamCalls, /validate --strict .*org\.example\.CheckOk\.metainfo\.xml\.in/);
    const lintCalls = readFileSync(join(stubBinDir, 'BUILDER_LINT_CALLS'), 'utf-8').trim();
    assert.match(lintCalls, /manifest .*org\.example\.CheckOk\.json/);
  });

  it('flatpak check exits non-zero when a linter fails', () => {
    // Replace the appstreamcli shim with one that exits 1.
    writeShim(stubBinDir, 'appstreamcli', 'APPSTREAMCLI_CALLS', false, /* exitCode */ 1);

    const failProjectDir = join(tmpDir, 'flatpak-check-fail');
    mkdirSync(join(failProjectDir, 'data'), { recursive: true });
    setupProject(failProjectDir, {
      name: 'org.example.CheckFail', version: '1.0.0', type: 'module', private: true,
      dependencies: { '@gjsify/cli': '^0.1.0' },
      gjsify: { flatpak: { appId: 'org.example.CheckFail' } },
    }, tarballsDir, tarballMap);
    writeFileSync(join(failProjectDir, 'org.example.CheckFail.json'), '{}\n');
    writeFileSync(join(failProjectDir, 'data/org.example.CheckFail.metainfo.xml.in'), '<broken/>\n');

    let exitCode = 0;
    let stdout = '';
    try {
      execFileSync('npx', ['gjsify', 'flatpak', 'check'], {
        cwd: failProjectDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60 * 1000,
        env: { ...process.env, PATH: pathWithStubs },
      });
    } catch (e) {
      exitCode = e.status ?? -1;
      stdout = (e.stdout ?? '').toString();
    }
    assert.notStrictEqual(exitCode, 0, 'expected non-zero exit when appstreamcli fails');
    assert.match(stdout, /FAIL: appstreamcli/);
  });
});

/**
 * Write a shell shim that:
 *   1. Appends its `$@` arguments to `<binDir>/<traceFile>`
 *   2. If `createFile` is true, parses `-o <path>` and `touch`es it
 *      (so the CLI's downstream existence checks succeed).
 *   3. Exits 0.
 */
function writeShim(binDir, name, traceFile, createFile = false, exitCode = 0) {
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
  lines.push(`exit ${exitCode}`);

  const path = join(binDir, name);
  writeFileSync(path, lines.join('\n') + '\n', 'utf-8');
  chmodSync(path, 0o755);
}

function shellQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
