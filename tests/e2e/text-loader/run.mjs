// E2E test for the `loaders` config key — opt-in extensions become JS
// string / data-URL default exports. Replaces the legacy esbuild
// `loader: { '.ui': 'text', '.glsl': 'text', '.png': 'dataurl' }` shorthand.
//
// Covers:
//   (a) .ui / .asm  → 'text' (original behavior, regression guard)
//   (b) .glsl       → 'text' (shader source as string; pixelrpg/map-editor use-case)
//   (c) .png        → 'dataurl' (Excalibur ImageSource data: URL use-case)
//   (d) bundler.define at the top level IS auto-mapped to transform.define
//       (flat esbuild→bundler rename works; token not left as bare identifier)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProject,
} from '../helpers.mjs';

// A minimal 1x1 red PNG (valid binary, deterministic bytes).
// Bytes: PNG header + IHDR + IDAT (single red pixel) + IEND.
const MINIMAL_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';
const MINIMAL_PNG_BYTES = Buffer.from(MINIMAL_PNG_B64, 'base64');

describe('CLI asset-loader E2E', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;

  before(() => {
    const env = createTestEnvironment('gjsify-e2e-text-loader-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    projectDir = join(tmpDir, 'text-loader-project');
    mkdirSync(join(projectDir, 'src', 'ui'), { recursive: true });
    mkdirSync(join(projectDir, 'src', 'asm'), { recursive: true });
    mkdirSync(join(projectDir, 'src', 'shaders'), { recursive: true });
    mkdirSync(join(projectDir, 'src', 'assets'), { recursive: true });

    setupProject(projectDir, {
      name: 'test-text-loader',
      version: '0.1.0',
      type: 'module',
      private: true,
      dependencies: { '@gjsify/cli': '^0.1.0' },
      gjsify: {
        bundler: {
          output: { file: 'dist/app.js', minify: false },
          // Top-level bundler.define — should be auto-mapped to transform.define
          // with a warning, NOT left as a bare identifier that crashes GJS.
          define: { __APPLICATION_ID__: '"org.example.TestApp"' },
        },
        loaders: {
          '.ui': 'text',
          '.asm': 'text',
          '.glsl': 'text',
          '.png': 'dataurl',
        },
      },
    }, tarballsDir, tarballMap);

    // Text fixtures
    writeFileSync(
      join(projectDir, 'src', 'ui', 'window.ui'),
      '<interface><object class="GtkWindow"><property name="title">hello-from-ui</property></object></interface>',
    );
    writeFileSync(
      join(projectDir, 'src', 'asm', 'demo.asm'),
      'LDA #$ff   ; assembler-fixture-byte-marker\n',
    );
    writeFileSync(
      join(projectDir, 'src', 'shaders', 'vertex.glsl'),
      'void main() { gl_Position = vec4(0.0, 0.0, 0.0, 1.0); /* glsl-shader-marker */ }\n',
    );

    // Binary fixture — a real (minimal) PNG
    writeFileSync(join(projectDir, 'src', 'assets', 'pixel.png'), MINIMAL_PNG_BYTES);

    // Entry that imports all fixtures and references the define token.
    // Use a JavaScript comment to hold the token name so TypeScript does not
    // complain about an undeclared identifier — the bundler replaces the raw
    // token in the output regardless of how it appears in source.
    writeFileSync(
      join(projectDir, 'src', 'app.ts'),
      [
        "import ui from './ui/window.ui';",
        "import asm from './asm/demo.asm';",
        "import glsl from './shaders/vertex.glsl';",
        "import img from './assets/pixel.png';",
        '// __APPLICATION_ID__ is a compile-time define injected by the bundler.',
        '// eslint-disable-next-line @typescript-eslint/no-explicit-any',
        'declare const __APPLICATION_ID__: string;',
        'const appId: string = __APPLICATION_ID__;',
        'console.log(ui.length, asm.length, glsl.length, img.length, appId);',
      ].join('\n') + '\n',
    );

    // Trigger the build once; all assertions read from the same output file.
    execFileSync('npx', ['gjsify', 'build', 'src/app.ts'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  it('output bundle exists', () => {
    assert.ok(existsSync(join(projectDir, 'dist', 'app.js')), 'dist/app.js missing');
  });

  it('inlines .ui files as JS string default exports', () => {
    const out = readFileSync(join(projectDir, 'dist', 'app.js'), 'utf-8');
    assert.match(out, /hello-from-ui/, '.ui content not inlined as string');
  });

  it('inlines .asm files as JS string default exports', () => {
    const out = readFileSync(join(projectDir, 'dist', 'app.js'), 'utf-8');
    assert.match(out, /assembler-fixture-byte-marker/, '.asm content not inlined as string');
  });

  it('inlines .glsl shader as a JS string default export', () => {
    const out = readFileSync(join(projectDir, 'dist', 'app.js'), 'utf-8');
    assert.match(out, /glsl-shader-marker/, '.glsl content not inlined as string');
  });

  it('inlines .png as a data:image/png;base64,... string default export', () => {
    const out = readFileSync(join(projectDir, 'dist', 'app.js'), 'utf-8');
    assert.match(out, /data:image\/png;base64,/, '.png not converted to data: URL');
    // Verify the actual base64 payload is present (not truncated / corrupted).
    assert.match(
      out,
      new RegExp(MINIMAL_PNG_B64.slice(0, 20)),
      'PNG base64 payload mismatch',
    );
  });

  it('top-level bundler.define is substituted in the bundle (not left as bare identifier)', () => {
    const out = readFileSync(join(projectDir, 'dist', 'app.js'), 'utf-8');
    // The define token must have been replaced with its value.
    assert.match(out, /"org\.example\.TestApp"/, 'define token not substituted');
    // The raw identifier must NOT appear as a standalone expression reference.
    // We allow it inside string literals (e.g. the comment we wrote above in
    // declare const) but NOT as a bare unquoted JS expression.
    // Regex: __APPLICATION_ID__ not immediately preceded or followed by a quote
    // or alphanumeric/underscore character — i.e. used as an expression operand.
    const doubleUnderscoreRe = /__APPLICATION_ID__/g;
    let match;
    let foundBare = false;
    while ((match = doubleUnderscoreRe.exec(out)) !== null) {
      const before = out[match.index - 1] ?? '';
      const after = out[match.index + match[0].length] ?? '';
      // If the occurrence is inside a quoted string, it's fine (it's the
      // 'declare const' comment / source-map string / etc).
      if (before === '"' || before === "'" || before === '`') continue;
      if (after === '"' || after === "'" || after === '`') continue;
      foundBare = true;
      break;
    }
    assert.ok(!foundBare, 'bare __APPLICATION_ID__ identifier still present in bundle');
  });
});
