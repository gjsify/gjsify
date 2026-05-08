// E2E test for the CJS `require('stream')` / `util.inherits` regression.
//
// Reproduces the showcase failure where running
//   npx @gjsify/cli showcase express-webserver
// crashed with
//   TypeError: The "superCtor.prototype" property must not be undefined
// because Rolldown's alias plugin redirected `'stream' → '@gjsify/stream'`
// without forwarding the `kind` extra option to `this.resolve()`. As a
// result the package.json `"require": "./cjs-compat.cjs"` condition was
// never matched for `require()` call sites inside bundled CJS deps
// (express → finalhandler → send → `var Stream = require('stream'); …
// util.inherits(SendStream, Stream)`), so `Stream` arrived as an ESM
// namespace object with no `prototype` property.
//
// The fix lives in
//   packages/infra/rolldown-plugin-gjsify/src/plugins/alias.ts
// where `resolveId` now forwards `extraOptions.kind` through the
// `this.resolve(target, importer, { skipSelf: true, kind })` call.
//
// Strategy: build a minimal app that mirrors the failing pattern
// (`require('stream')` from a CJS module + `util.inherits` from the
// resulting constructor), then run the bundle under `gjs -m` and assert
// it doesn't throw the regression's TypeError.
//
// Build with `--no-minify` so the runtime probe's marker string survives
// to stdout (the default minifier mangles bare identifiers but not
// string literals — `--no-minify` is belt-and-suspenders to keep a
// readable bundle for failure-mode debugging).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProject,
  hasCommand,
} from '../helpers.mjs';

describe('CJS `require("stream")` + util.inherits regression', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;
  let bundlePath;

  before(() => {
    const env = createTestEnvironment('gjsify-e2e-cjs-require-stream-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    projectDir = join(tmpDir, 'project');
    mkdirSync(join(projectDir, 'src'), { recursive: true });

    setupProject(projectDir, {
      name: 'test-cjs-require-stream',
      version: '0.1.0',
      type: 'module',
      private: true,
      dependencies: {
        '@gjsify/cli': '^0.1.0',
      },
    }, tarballsDir, tarballMap);

    // A CJS source that mirrors the failing express → send pattern:
    // capture `Stream` from `require('stream')` and pass it as the
    // parent constructor to `util.inherits`. If Rolldown returns a
    // namespace object (regression path), the inherits call throws.
    //
    // Written as a `.cjs` file so the bundler treats it as CJS regardless
    // of any inferred module type — this is the same kind of dependency
    // that ships inside express/send.
    writeFileSync(join(projectDir, 'src', 'cjs-mod.cjs'),
      "var Stream = require('stream');\n" +
      "var util = require('util');\n" +
      "function MyStream() { Stream.call(this); }\n" +
      "util.inherits(MyStream, Stream);\n" +
      "module.exports = function check() {\n" +
      "  var inst = new MyStream();\n" +
      "  return inst instanceof Stream;\n" +
      "};\n"
    );

    writeFileSync(join(projectDir, 'src', 'index.ts'),
      "// ESM entry that consumes a CJS dep using require('stream') +\n" +
      "// util.inherits — exactly the shape that broke under Rolldown\n" +
      "// before the alias plugin forwarded `extraOptions.kind`.\n" +
      "import check from './cjs-mod.cjs';\n" +
      "const ok = check();\n" +
      "console.log('CJS_REQUIRE_STREAM_INHERITS_OK=' + (ok === true));\n"
    );
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  it('builds a CJS module that does `util.inherits(Child, require("stream"))`', () => {
    execFileSync('npx', ['gjsify', 'build', '--app', 'gjs', 'src/index.ts',
      '--outfile', 'dist/bundle.js', '--no-minify'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 90 * 1000,
    });
    bundlePath = join(projectDir, 'dist', 'bundle.js');
    assert.ok(existsSync(bundlePath), 'dist/bundle.js missing');
  });

  it('does not throw "superCtor.prototype" TypeError under gjs', () => {
    if (!hasCommand('gjs')) {
      // Surface the missing dependency in the test report rather than
      // silently skipping — this suite's purpose is to lock down a
      // GJS-runtime regression, so a CI without gjs is a configuration
      // bug, not a clean skip.
      assert.fail('gjs not on PATH; this regression test requires the gjs runtime.');
    }
    const result = spawnSync('gjs', ['-m', bundlePath], {
      encoding: 'utf8',
      timeout: 30 * 1000,
    });
    const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.doesNotMatch(
      combined,
      /superCtor\.prototype/,
      'bundle threw the regression\'s TypeError — alias plugin did not honour the require() condition. Combined output:\n' + combined,
    );
    assert.match(
      result.stdout ?? '',
      /CJS_REQUIRE_STREAM_INHERITS_OK=true/,
      'expected stdout to confirm `new MyStream() instanceof Stream`. Combined output:\n' + combined,
    );
    assert.strictEqual(result.status, 0,
      'gjs exited non-zero. Combined output:\n' + combined);
  });
});
