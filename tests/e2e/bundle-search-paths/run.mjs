// E2E test for the `bundle-search-paths` conformance rule — no image in a runtime
// bundle's payload may search for a library OUTSIDE the bundle.
//
// The bug it catches (#1536). `@gjsify/gtk-runtime-darwin-x64` ships
// `libgstsoup.dylib` AND `libsoup-3.0.0.dylib`, and on a Homebrew Mac the first
// loaded the second from `/usr/local`. The plugin does not link libsoup — it
// reaches it through its own loader shim with `g_module_open` by BARE LEAF — so its
// `LC_LOAD_DYLIB` list is innocent and every gate that reads `otool -L` reports a
// self-contained bundle. What it carried instead was one `LC_RPATH` naming
// Homebrew's libsoup keg, and `DYLD_PRINT_SEARCHING` on a macOS 15.7.9 host shows
// dyld expanding the bare leaf against exactly that entry (`leaf name using rpath`)
// and reaching it BEFORE the default fallback. Homebrew's libsoup then arrives with
// Homebrew's glib family in its own link closure: two GObject type registries in one
// process, an `https://` stream that fails silently, and a bundled file that plays.
//
// WHY THE FIXTURES ARE SYNTHETIC. `tests/e2e/macho.mjs` writes the load commands and
// nothing else, which is exactly what the reader under test reads. Producing them
// with `install_name_tool` would make the one check that guards macOS runnable only
// ON macOS — and the whole point of this rule is that a Linux host can read a darwin
// bundle's load commands without a Mac (ADR 0024 § A3, ADR 0057 § 4).
//
// BOTH RUNTIMES. The rule ships in `@gjsify/manifest-conformance`, which the `gjsify`
// CLI carries into a GJS process, so "it parses under node" is half an answer. The
// GJS leg runs the SAME driver over the SAME fixtures through a `--app gjs` bundle
// and the two results are compared, rather than each arm asserting separately — two
// arms with two expectations cannot disagree, which is the property worth having.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { machO, LC_ID_DYLIB, LC_LOAD_DYLIB, LC_RPATH, SYSTEM_DYLIB } from '../macho.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const RULE = join(
    MONOREPO_ROOT,
    'packages',
    'infra',
    'manifest-conformance',
    'lib',
    'rules',
    'bundle-search-paths.mjs',
);
const GJSIFY_BIN = join(MONOREPO_ROOT, 'node_modules', '.bin', 'gjsify');

const { auditPayloadSearchPaths, auditRuntimeBundles } = await import(`file://${RULE}`);

/** A working `gjs --version` always exits 0; anything else means "no usable gjs". */
function hasGjs() {
    const r = spawnSync('gjs', ['--version'], { stdio: 'ignore' });
    return r.status === 0 && r.error === undefined;
}

let tmp;
before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gjsify-e2e-bundle-search-'));
});
after(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
});

/** Write `<root>/gtk/<rel>` as a Mach-O carrying `commands`. */
function image(root, rel, commands) {
    const abs = join(root, 'gtk', rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, machO(commands));
    return abs;
}

/** A payload root under the suite's tmp dir. */
function payload(name) {
    const root = join(tmp, name);
    mkdirSync(join(root, 'gtk'), { recursive: true });
    return root;
}

/**
 * The clean half of every fixture tree below.
 *
 * It is not decoration and it is not shared to save typing: a rule that fires on
 * everything is indistinguishable from a rule that works, and every assertion here
 * that expects exactly ONE finding is only meaningful because these images sit
 * beside the offender and stay quiet. Four shapes that MUST NOT be reported —
 * no rpath at all, a self-relative one, a `/usr/lib` system root, and an `@rpath/`
 * dependency that has something to resolve it.
 */
function writeCleanImages(root) {
    image(root, 'lib/libglib-2.0.0.dylib', [
        { cmd: LC_ID_DYLIB, str: '@loader_path/libglib-2.0.0.dylib' },
        SYSTEM_DYLIB,
    ]);
    image(root, 'lib/libwebp.7.dylib', [
        { cmd: LC_ID_DYLIB, str: '@loader_path/libwebp.7.dylib' },
        { cmd: LC_RPATH, str: '@loader_path/../lib' },
        SYSTEM_DYLIB,
    ]);
    // `/usr/lib` and `/System` ship with macOS at a path Apple guarantees, so an
    // absolute entry under them is not a fact about the build host.
    image(root, 'lib/libswiftish.dylib', [
        { cmd: LC_ID_DYLIB, str: '@loader_path/libswiftish.dylib' },
        { cmd: LC_RPATH, str: '/usr/lib/swift' },
        SYSTEM_DYLIB,
    ]);
    image(root, 'lib/libresolvable.dylib', [
        { cmd: LC_ID_DYLIB, str: '@loader_path/libresolvable.dylib' },
        { cmd: LC_LOAD_DYLIB, str: '@rpath/libfriend.dylib' },
        { cmd: LC_RPATH, str: '@loader_path' },
        SYSTEM_DYLIB,
    ]);
    // Not a Mach-O. A payload is mostly icons, schemas and locale data, and a
    // reader that treated an unparseable file as a defective image would report
    // every bundle as broken.
    const icon = join(root, 'gtk', 'share', 'icons', 'go-next.svg');
    mkdirSync(dirname(icon), { recursive: true });
    writeFileSync(icon, '<svg/>');
}

describe('bundle-search-paths: a payload image may not search outside the bundle', () => {
    it('reports nothing on a payload whose every image resolves inside it', () => {
        const root = payload('clean');
        writeCleanImages(root);
        const audit = auditPayloadSearchPaths(root);
        assert.equal(audit.images, 4, 'the .svg must not be counted as an image');
        assert.deepEqual(audit.findings, [], 'a clean payload must produce no finding');
    });

    it('catches the #1536 shape: a plugin whose only search path is a Homebrew keg', () => {
        const root = payload('soup');
        writeCleanImages(root);
        image(root, 'lib/gstreamer-1.0/libgstsoup.dylib', [
            { cmd: LC_ID_DYLIB, str: '@loader_path/libgstsoup.dylib' },
            // Exactly what the published bundle carries: the glib family already
            // relocated, no libsoup among the linked deps, and one keg rpath.
            { cmd: LC_LOAD_DYLIB, str: '@loader_path/../libgobject-2.0.0.dylib' },
            { cmd: LC_RPATH, str: '/usr/local/opt/libsoup/lib' },
            SYSTEM_DYLIB,
        ]);
        const audit = auditPayloadSearchPaths(root);
        assert.equal(audit.findings.length, 1);
        assert.deepEqual(audit.findings[0], {
            file: 'gtk/lib/gstreamer-1.0/libgstsoup.dylib',
            kind: 'escape',
            detail: ['/usr/local/opt/libsoup/lib'],
        });
    });

    it('catches the other prefix too, because the predicate is derived and not a literal', () => {
        // A hardcoded `/opt/homebrew` test is vacuously false on an Intel runner and
        // a `/usr/local` one is vacuously false on Apple silicon, so either alone
        // passes green while proving nothing about the other arch.
        for (const [name, rpath] of [
            ['intel', '/usr/local/Cellar/jpeg-turbo/3.2.0/lib'],
            ['apple-silicon', '/opt/homebrew/lib'],
            ['macports', '/opt/local/lib'],
            ['somebodys-home', '/Users/ci/build/lib'],
        ]) {
            const root = payload(`prefix-${name}`);
            writeCleanImages(root);
            image(root, 'lib/libjpeg.8.dylib', [
                { cmd: LC_ID_DYLIB, str: '@loader_path/libjpeg.8.dylib' },
                { cmd: LC_RPATH, str: rpath },
                SYSTEM_DYLIB,
            ]);
            const audit = auditPayloadSearchPaths(root);
            assert.equal(audit.findings.length, 1, `${rpath} must be reported`);
            assert.equal(audit.findings[0].kind, 'escape');
            assert.deepEqual(audit.findings[0].detail, [rpath]);
        }
    });

    it('also refuses the OVER-correction: an @rpath/ dep with nothing to resolve it', () => {
        // The complementary half. The repair for the escape is a full-list REPLACE,
        // and a replace that dropped an image's only self-relative entry would turn
        // a bundle that loads the WRONG library into one that loads none — a
        // regression the escape check alone cannot see, because its finding count
        // would go down.
        const root = payload('stranded');
        writeCleanImages(root);
        image(root, 'lib/librsvg-2.2.dylib', [
            { cmd: LC_ID_DYLIB, str: '@loader_path/librsvg-2.2.dylib' },
            { cmd: LC_LOAD_DYLIB, str: '@rpath/libfriend.dylib' },
            SYSTEM_DYLIB,
        ]);
        const audit = auditPayloadSearchPaths(root);
        assert.equal(audit.findings.length, 1);
        assert.equal(audit.findings[0].kind, 'unresolvable');
        assert.equal(audit.findings[0].file, 'gtk/lib/librsvg-2.2.dylib');
    });

    it('distinguishes an ABSENT payload from an empty one', () => {
        // They read alike from a `findings.length === 0` test, and conflating them
        // is how a check over an artifact that is not there reports a clean bundle.
        const absent = join(tmp, 'no-payload-here');
        mkdirSync(absent, { recursive: true });
        assert.equal(auditPayloadSearchPaths(absent), null, 'an absent payload is not an audit result');

        const empty = payload('empty');
        const audit = auditPayloadSearchPaths(empty);
        assert.notEqual(audit, null);
        assert.equal(audit.images, 0);
    });
});

describe('bundle-search-paths: what the rule does with those findings', () => {
    const bundle = (name, dir) => [{ name, path: `packages/${name}`, dir, files: ['gtk'] }];

    it('fails the run on an escape, and names the image and the path', () => {
        const root = payload('rule-escape');
        writeCleanImages(root);
        image(root, 'lib/gstreamer-1.0/libgstsoup.dylib', [
            { cmd: LC_ID_DYLIB, str: '@loader_path/libgstsoup.dylib' },
            { cmd: LC_RPATH, str: '/usr/local/opt/libsoup/lib' },
            SYSTEM_DYLIB,
        ]);
        const result = auditRuntimeBundles(bundle('gtk-runtime-darwin-x64', root));
        assert.equal(result.failures.length, 1);
        assert.match(result.failures[0], /libgstsoup\.dylib/);
        assert.match(result.failures[0], /\/usr\/local\/opt\/libsoup\/lib/);
        assert.equal(result.stats.inspected, 1);
    });

    it('passes a clean payload — the discriminator, so a green run means something', () => {
        const root = payload('rule-clean');
        writeCleanImages(root);
        const result = auditRuntimeBundles(bundle('gtk-runtime-darwin-x64', root));
        assert.deepEqual(result.failures, []);
        assert.equal(result.stats.images, 4);
    });

    it('fails a payload directory that holds no image at all', () => {
        const root = payload('rule-empty');
        const result = auditRuntimeBundles(bundle('gtk-runtime-darwin-x64', root));
        assert.equal(result.failures.length, 1);
        assert.match(result.failures[0], /no Mach-O image at all/);
    });

    it('does not fail an absent payload — it says it did not look', () => {
        const absent = join(tmp, 'rule-absent');
        mkdirSync(absent, { recursive: true });
        const result = auditRuntimeBundles(bundle('gtk-runtime-darwin-x64', absent));
        assert.deepEqual(result.failures, [], 'a checkout has no payload and is not a defect');
        assert.equal(result.stats.inspected, 0);
        assert.match(result.notes.join('\n'), /NOT INSPECTED/);
    });
});

// ── the GJS leg ─────────────────────────────────────────────────────────────
//
// A CAPABILITY probe on the two tools this arm execs, never a platform test: the
// rule is portable by construction and the question here is only whether this host
// can run a GJS bundle at all.
const GJS_SKIP = !hasGjs() ? 'no usable `gjs` on PATH' : false;

describe('bundle-search-paths: the same rule under GJS', { skip: GJS_SKIP, timeout: 5 * 60 * 1000 }, () => {
    it('reads the same payload and reports the same findings as node', () => {
        const root = payload('gjs-arm');
        writeCleanImages(root);
        image(root, 'lib/gstreamer-1.0/libgstsoup.dylib', [
            { cmd: LC_ID_DYLIB, str: '@loader_path/libgstsoup.dylib' },
            { cmd: LC_RPATH, str: '/usr/local/opt/libsoup/lib' },
            SYSTEM_DYLIB,
        ]);
        image(root, 'lib/librsvg-2.2.dylib', [
            { cmd: LC_ID_DYLIB, str: '@loader_path/librsvg-2.2.dylib' },
            { cmd: LC_LOAD_DYLIB, str: '@rpath/libfriend.dylib' },
            SYSTEM_DYLIB,
        ]);

        const work = join(tmp, 'gjs-driver');
        mkdirSync(work, { recursive: true });
        // Built and run from the MONOREPO ROOT, not from the driver's own directory.
        // `gjsify build` resolves both its config and the shim packages it injects
        // through the nearest package.json, and a bare temp dir has neither — the
        // build then either refuses outright or emits a bundle whose `node:fs` shim
        // reaches for globals nothing registered.
        const driver = join(work, 'driver.mjs');
        writeFileSync(
            driver,
            `import { auditPayloadSearchPaths } from ${JSON.stringify(RULE)};\n` +
                // The ENVIRONMENT and not `process.argv`: the two runtimes do not agree
                // on what leads that array (`gjs -m file arg` is not `node file arg`), and
                // a driver that read the wrong slot would report an ABSENT payload — which
                // this rule deliberately answers with `null` rather than a failure, so the
                // GJS arm would have gone green over a path it never looked at.
                'const root = process.env.BUNDLE_PAYLOAD_ROOT;\n' +
                'const audit = auditPayloadSearchPaths(root);\n' +
                'if (audit === null) throw new Error(`no payload under ${root}`);\n' +
                'console.log(JSON.stringify({ images: audit.images, findings: audit.findings }));\n',
        );

        const outfile = join(work, 'driver.gjs.mjs');
        // `--globals URL` is not boilerplate. The auto-detector finds globals it can
        // see in the SOURCE it is given, and `URL` is used inside the shimmed
        // `node:fs` this driver only reaches transitively — so an auto build produces
        // a bundle that dies on `ReferenceError: URL is not defined` before the rule's
        // first line. Naming it is what makes this leg run the rule rather than
        // measure the bundler.
        execFileSync(
            GJSIFY_BIN,
            ['build', driver, '--app', 'gjs', '--outfile', outfile, '--no-minify', '--globals', 'auto,URL'],
            { cwd: MONOREPO_ROOT, stdio: 'pipe', timeout: 4 * 60 * 1000 },
        );

        // `gjsify run` and not a bare `gjs -m`: the CLI installs the globals the
        // shimmed `node:fs` needs (a bare run dies on `URL is not defined` before
        // the rule's first line), and it is what every `test:gjs` script in this
        // repository uses to put a `--app gjs` bundle on a GJS runtime.
        const gjs = spawnSync(GJSIFY_BIN, ['run', outfile], {
            cwd: MONOREPO_ROOT,
            encoding: 'utf8',
            timeout: 2 * 60 * 1000,
            env: { ...process.env, BUNDLE_PAYLOAD_ROOT: root },
        });
        assert.equal(gjs.status, 0, `gjs exited ${gjs.status}: ${gjs.stderr}`);

        const underGjs = JSON.parse(gjs.stdout.trim().split('\n').at(-1));
        const underNode = auditPayloadSearchPaths(root);

        // Compared against the node result rather than against a literal: a
        // hardcoded expectation in each arm is two expectations that cannot
        // disagree, which is exactly the disagreement this leg exists to detect.
        assert.deepEqual(underGjs.findings, underNode.findings);
        assert.equal(underGjs.images, underNode.images);
        assert.equal(underGjs.findings.length, 2, 'the fixture carries one escape and one stranded @rpath dep');
    });
});
