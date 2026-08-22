// E2E test for `gjsify ship` — ADR 0024, stages 2 and 3.
//
// This suite exists because of one sentence in that ADR: "a `ship` that
// asserted on rendered YAML would be this repo's green-CI-that-checked-nothing
// class on a new surface." The reference implementation the design comes from
// has ~4100 lines of packaging logic and four existence assertions behind it,
// and no CI job of theirs ever produces a package.
//
// So every assertion here runs against a REAL artifact, and the readers are
// deliberately not ours:
//   * `.rpm` → the system `rpm`, a strict independent parser that reads the
//     lead, both headers, every tag and the payload digest. `rpm -K` verifies
//     the digests; `rpm -i --test` builds a real transaction element, which is
//     what catches a missing OS/ARCH tag.
//   * `.deb` → GNU `ar` and GNU `tar`. dpkg is not installable on the Fedora
//     image this repo's CI runs on, so these two are the strongest independent
//     readers available — they parse the container and both inner tars.
//
// Tools that may be absent are probed and the skip is PRINTED, never silent
// (`tests/e2e/flatpak-sdk-extension` set that rule). The assertions that need
// no tool at all — the staged tree, determinism, and the refusals — always run.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCliSync } from '../mock-registry.mjs';
// The demo project, the tool probe and the manifest's name live in `fixture.mjs` because
// `tests/e2e/ship-from-stage` builds the SAME project: a second scaffold would be a second
// definition of what this suite is about, and the drifted copy is the one that keeps passing.
import {
    APP_ID,
    CLI_ENTRY,
    listFiles,
    listPayload,
    probe,
    scaffold,
    STAGE_MANIFEST_FILE,
    STAGE_SCHEMA_VERSION,
} from './fixture.mjs';

describe('CLI ship E2E', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let projectDir;

    before(() => {
        if (!existsSync(CLI_ENTRY)) throw new Error(`CLI entry not built: ${CLI_ENTRY}`);
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ship-'));
        projectDir = scaffold(join(tmpDir, 'app'));
        runCliSync(CLI_ENTRY, ['ship', '--skip-build'], { cwd: projectDir });
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(tmpDir, { recursive: true, force: true });
    });

    // ── the staged payload ────────────────────────────────────────────────

    it('stages one prefix-relative payload', () => {
        // `listPayload`, not `listFiles`: the stage root also carries its own manifest, which is
        // the closure that makes the tree packable on another host and is never payload itself.
        const staged = listPayload(join(projectDir, 'ship', 'stage'));
        assert.deepEqual(staged, [
            'bin/ship-demo',
            'lib/ship-demo/gjs.js',
            `share/applications/${APP_ID}.desktop`,
            `share/glib-2.0/schemas/${APP_ID}.gschema.xml`,
            `share/icons/hicolor/scalable/apps/${APP_ID}.svg`,
            `share/metainfo/${APP_ID}.metainfo.xml`,
            `share/mime/packages/${APP_ID}.xml`,
        ]);
    });

    it('writes a launcher that derives its own prefix', () => {
        const launcher = readFileSync(join(projectDir, 'ship', 'stage', 'bin', 'ship-demo'), 'utf-8');
        // A baked path would force one payload per format and collapse the
        // whole design back into N packagers (ADR 0024 § 3).
        assert.match(launcher, /prefix=\$\(dirname "\$\(dirname "\$self"\)"\)/);
        assert.match(launcher, /exec gjs -m "\$prefix"\/lib\/ship-demo\/gjs\.js "\$@"/);
        assert.equal(statSync(join(projectDir, 'ship', 'stage', 'bin', 'ship-demo')).mode & 0o777, 0o755);
    });

    it('--stage produces the tree and packs nothing', () => {
        const stageOnly = scaffold(join(tmpDir, 'stage-only'));
        runCliSync(CLI_ENTRY, ['ship', '--skip-build', '--stage'], { cwd: stageOnly });
        assert.ok(existsSync(join(stageOnly, 'ship', 'stage', 'bin', 'ship-demo')));
        assert.equal(existsSync(join(stageOnly, 'ship', 'out')), false);
        assert.ok(existsSync(join(stageOnly, 'ship', 'stage', STAGE_MANIFEST_FILE)));
    });

    it('writes the stage manifest beside the payload, on every run', () => {
        // Written whether or not this run packs: a `ship/stage/` that is sometimes packable
        // elsewhere and sometimes not is a worse contract than one that always is (ADR 0024 § A2).
        // That it is SUFFICIENT — that a stage plus this file needs no project — is proven in
        // `tests/e2e/ship-from-stage`, which deletes the project between the phases.
        const manifest = JSON.parse(readFileSync(join(projectDir, 'ship', 'stage', STAGE_MANIFEST_FILE), 'utf-8'));
        assert.equal(manifest.schema, STAGE_SCHEMA_VERSION);
        assert.deepEqual(manifest.formats, ['deb', 'rpm']);
        assert.deepEqual(manifest.namespaces, ['Adw-1', 'Gtk-4.0']);
        // The mode plan — the half a CI artifact upload cannot carry, and the half that decides
        // whether the installed `bin/` entry can be executed at all.
        assert.ok(manifest.staged.some((file) => file.path === 'bin/ship-demo' && file.mode === 0o755));
        // Nothing in it may name the machine that assembled it — that path will not exist on the
        // host that packs the stage, and seven `ShipSettings` fields are absolute paths.
        assert.ok(!JSON.stringify(manifest).includes(projectDir), 'the manifest must not name the build tree');
    });

    // ── the .deb ──────────────────────────────────────────────────────────

    it('names the .deb after the package, version and architecture', () => {
        // No compiled code in the payload, so the package really does install
        // everywhere and claiming `amd64` would make apt refuse it on arm64.
        assert.ok(existsSync(debPath()), `expected ${debPath()}`);
    });

    it('.deb: GNU ar reads three members in the order dpkg requires', () => {
        if (!probe('ar')) return;
        const members = execFileSync('ar', ['t', debPath()], { encoding: 'utf-8' }).trim().split('\n');
        assert.deepEqual(members, ['debian-binary', 'control.tar.gz', 'data.tar.gz']);
    });

    it('.deb: the control fields dpkg refuses a package without', () => {
        if (!probe('ar') || !probe('tar')) return;
        const control = readControlFile('control');
        assert.match(control, /^Package: ship-demo$/m);
        assert.match(control, /^Version: 1\.2\.3-1$/m);
        assert.match(control, /^Architecture: all$/m);
        assert.match(control, /^Maintainer: Example Dev <dev@example\.org>$/m);
        assert.match(control, /^Depends: .*gjs \(>= 1\.86\)/m);
        assert.match(control, /gir1\.2-gtk-4\.0/);
        assert.match(control, /gir1\.2-adw-1/);
        // A missing final newline is a dpkg parse error, not a cosmetic issue.
        assert.ok(control.endsWith('\n'), 'control must end with exactly one newline');
        assert.ok(!control.endsWith('\n\n'));
    });

    it('.deb: md5sums lists every regular file, and the digests are right', () => {
        if (!probe('ar') || !probe('tar')) return;
        const md5sums = readControlFile('md5sums');
        const lines = md5sums.trimEnd().split('\n');
        assert.equal(lines.length, 8); // 7 staged + the copyright overlay
        for (const line of lines) {
            // Exactly two spaces, and no leading `./` — unlike every other
            // path in the package.
            const match = /^([0-9a-f]{32}) {2}(usr\/[^ ].*)$/.exec(line);
            assert.ok(match, `bad md5sums line: ${JSON.stringify(line)}`);
            const staged = join(projectDir, 'ship', 'stage', ...match[2].replace(/^usr\//, '').split('/'));
            const overlay = join(projectDir, 'ship', 'overlay', 'deb', ...match[2].replace(/^usr\//, '').split('/'));
            const source = existsSync(staged) ? staged : overlay;
            assert.equal(createHash('md5').update(readFileSync(source)).digest('hex'), match[1], match[2]);
        }
    });

    it('.deb: data.tar carries every parent directory, root:root', () => {
        if (!probe('ar') || !probe('tar')) return;
        const listing = readDataListing();
        // dpkg opens each file with O_CREAT|O_EXCL and never calls `mkdir -p`,
        // so a missing parent aborts the unpack with the package half-installed.
        for (const dir of ['./', './usr/', './usr/bin/', './usr/share/', './usr/share/applications/']) {
            assert.ok(
                listing.some((entry) => entry.name === dir && entry.kind === 'd'),
                `missing directory entry ${dir}`,
            );
        }
        assert.ok(listing.some((entry) => entry.name === './usr/bin/ship-demo' && entry.mode === '-rwxr-xr-x'));
        // dpkg applies uid/gid verbatim — a build-user id here installs files
        // owned by that id and the install still succeeds.
        for (const entry of listing) assert.equal(entry.owner, '0/0', entry.name);
    });

    it('.deb: the Debian copyright overlay is where policy wants it', () => {
        if (!probe('ar') || !probe('tar')) return;
        const listing = readDataListing();
        assert.ok(listing.some((entry) => entry.name === './usr/share/doc/ship-demo/copyright'));
        assert.ok(!listing.some((entry) => entry.name.includes('share/licenses')), 'rpm layout leaked into the .deb');
    });

    // ── the .rpm ──────────────────────────────────────────────────────────

    it('.rpm: the system rpm verifies both digests', () => {
        if (!probe('rpm')) return;
        const out = execFileSync('rpm', ['-Kv', rpmPath()], { encoding: 'utf-8' });
        assert.match(out, /SHA256/i);
        assert.doesNotMatch(out.toUpperCase(), /\bBAD\b|NOT OK/);
    });

    it('.rpm: rpm reads the header this writer produced', () => {
        if (!probe('rpm')) return;
        const query = execFileSync(
            'rpm',
            [
                '-qp',
                '--qf',
                '%{NAME}|%{VERSION}|%{RELEASE}|%{ARCH}|%{OS}|%{LICENSE}|%{SOURCERPM}|%{SUMMARY}',
                rpmPath(),
            ],
            { encoding: 'utf-8' },
        );
        assert.equal(
            query,
            'ship-demo|1.2.3|1|noarch|linux|MIT|ship-demo-1.2.3-1.src.rpm|Prove that gjsify ship works',
        );
    });

    it('.rpm: the file list matches the staged payload plus the licence overlay', () => {
        if (!probe('rpm')) return;
        const files = execFileSync('rpm', ['-qpl', rpmPath()], { encoding: 'utf-8' }).trim().split('\n');
        for (const expected of [
            '/usr/bin/ship-demo',
            '/usr/lib/ship-demo/gjs.js',
            `/usr/share/applications/${APP_ID}.desktop`,
            `/usr/share/glib-2.0/schemas/${APP_ID}.gschema.xml`,
            `/usr/share/metainfo/${APP_ID}.metainfo.xml`,
            `/usr/share/mime/packages/${APP_ID}.xml`,
            '/usr/share/licenses/ship-demo/LICENSE',
        ]) {
            assert.ok(files.includes(expected), `missing ${expected}`);
        }
        // Owning a directory the base system owns makes the package fight
        // `filesystem` and `glib2` for it.
        for (const notOwned of ['/usr', '/usr/bin', '/usr/share', '/usr/share/glib-2.0']) {
            assert.ok(!files.includes(notOwned), `must not own ${notOwned}`);
        }
        // …but its own directories must be owned, or `rpm -e` leaves them.
        assert.ok(files.includes('/usr/lib/ship-demo'));
    });

    it('.rpm: requires carry the derived deps, the interpreter and the rpmlib features', () => {
        if (!probe('rpm')) return;
        const requires = execFileSync('rpm', ['-qp', '--requires', rpmPath()], { encoding: 'utf-8' });
        assert.match(requires, /^gjs >= 1\.86$/m);
        assert.match(requires, /^gtk4$/m);
        assert.match(requires, /^libadwaita$/m);
        assert.match(requires, /^\/bin\/sh$/m);
        // Declaring these is what makes an older rpm refuse the package
        // cleanly instead of misreading its file list.
        assert.match(requires, /rpmlib\(CompressedFileNames\)/);
        assert.match(requires, /rpmlib\(FileDigests\)/);
        assert.match(requires, /rpmlib\(PayloadFilesHavePrefix\)/);
    });

    it(".rpm: the scriptlets use rpm's argument convention, not dpkg's", () => {
        if (!probe('rpm')) return;
        const scripts = execFileSync('rpm', ['-qp', '--scripts', rpmPath()], { encoding: 'utf-8' });
        assert.match(scripts, /glib-compile-schemas \/usr\/share\/glib-2\.0\/schemas/);
        // Detection runs off the compiled cache in `share/mime`, not off `share/mime/packages`.
        // Without this line the document is installed and the type still does not exist.
        assert.match(scripts, /update-mime-database \/usr\/share\/mime/);
        // rpm's `$1` is a COUNT. A dpkg-shaped `[ "$1" = "configure" ]` here is
        // never true, so the scriptlet runs and does nothing — an artifact that
        // passes every structural check and still ships broken.
        assert.doesNotMatch(scripts, /"\$1" = "configure"/);
    });

    it('.rpm: rpm builds a real transaction element from it', () => {
        if (!probe('rpm')) return;
        // The check that catches a missing OS or ARCH tag, which `-qp` and
        // `-K` both accept.
        execFileSync('rpm', ['-i', '--test', '--nodeps', rpmPath()], { stdio: 'pipe' });
    });

    it('.rpm: the payload holds exactly the files the header lists', () => {
        if (!probe('rpm') || !probe('rpm2cpio') || !probe('cpio')) return;
        const listing = execFileSync('sh', ['-c', `rpm2cpio ${JSON.stringify(rpmPath())} | cpio -it --quiet`], {
            encoding: 'utf-8',
        })
            .trim()
            .split('\n')
            .map((name) => name.replace(/^\./, ''))
            .sort();
        const header = execFileSync('rpm', ['-qpl', rpmPath()], { encoding: 'utf-8' }).trim().split('\n').sort();
        // rpm correlates payload entries with the header BY NAME: a file in
        // the header and not in the payload aborts the install partway.
        assert.deepEqual(listing, header);
    });

    it('.deb: unpacks to exactly the staged tree, byte for byte', () => {
        if (!probe('ar') || !probe('tar')) return;
        // The closest this suite can get to `dpkg -i`: dpkg is on no runner
        // this project uses, so what is provable is that the data member
        // expands to the payload that was staged — same paths, same bytes.
        const unpacked = join(tmpDir, 'deb-unpacked');
        rmSync(unpacked, { recursive: true, force: true });
        mkdirSync(unpacked, { recursive: true });
        execFileSync('tar', ['xzf', join(extractDeb(), 'data.tar.gz'), '-C', unpacked]);

        const staged = listPayload(join(projectDir, 'ship', 'stage'));
        const overlay = listFiles(join(projectDir, 'ship', 'overlay', 'deb'));
        const expected = [...staged, ...overlay].sort();
        const actual = listFiles(join(unpacked, 'usr')).sort();
        assert.deepEqual(actual, expected);

        for (const rel of staged) {
            const source = join(projectDir, 'ship', 'stage', ...rel.split('/'));
            assert.deepEqual(readFileSync(join(unpacked, 'usr', ...rel.split('/'))), readFileSync(source), rel);
        }
    });

    // ── properties of both ────────────────────────────────────────────────

    it('packs the same build twice into byte-identical artifacts', () => {
        // The property worth having, and the one a naive writer loses without
        // noticing: gzip carries its own mtime in the header, so two runs over
        // identical input differ in bytes no content-level test would compare.
        const first = { deb: readFileSync(debPath()), rpm: readFileSync(rpmPath()) };
        runCliSync(CLI_ENTRY, ['ship', '--skip-build'], { cwd: projectDir });
        assert.deepEqual(readFileSync(debPath()), first.deb);
        assert.deepEqual(readFileSync(rpmPath()), first.rpm);
    });

    it('SOURCE_DATE_EPOCH pins the stamp across trees', () => {
        // Same source, two different checkouts, identical bytes — which the
        // bundle-mtime default cannot give (the mtime is when THIS tree was
        // built) and which a release pipeline wants.
        const stamp = '1700000000';
        const a = scaffold(join(tmpDir, 'sde-a'));
        const b = scaffold(join(tmpDir, 'sde-b'));
        for (const dir of [a, b]) {
            runCliSync(CLI_ENTRY, ['ship', '--skip-build'], {
                cwd: dir,
                env: { ...process.env, SOURCE_DATE_EPOCH: stamp },
            });
        }
        assert.deepEqual(readFileSync(debPath(a)), readFileSync(debPath(b)));
        assert.deepEqual(readFileSync(rpmPath(a)), readFileSync(rpmPath(b)));
    });

    it('runs the project build FIRST, then packs what it produced', () => {
        // The default path, and the one a `--skip-build` suite cannot see. It
        // caught a real defect: `gjsify ship` first dispatched `gjsify run
        // build` IN-PROCESS, and `gjsify run`'s script path ends in
        // `return process.exit(code)` on every branch — deliberately, because
        // under GJS a bare exit falls through. So `gjsify ship` with no flags
        // would have ended inside the build, staged nothing, and exited 0.
        //
        // The build script here is real rather than a PATH stub on purpose:
        // `ensureGjsifyShimOnPath()` puts the running CLI's own shim ahead of
        // everything else, so a stubbed `gjsify` cannot be reached — and should
        // not be, since making nested `gjsify` mean THIS gjsify is the point.
        const dir = scaffold(join(tmpDir, 'with-build'));
        rmSync(join(dir, 'dist', 'gjs.js'));

        runCliSync(CLI_ENTRY, ['ship'], { cwd: dir });

        assert.ok(existsSync(join(dir, 'dist', 'gjs.js')), 'the build script did not run');
        assert.ok(existsSync(join(dir, 'ship', 'stage', 'lib', 'ship-demo', 'gjs.js')));
        assert.ok(existsSync(join(dir, 'ship', 'out', 'ship-demo_1.2.3-1_all.deb')));
    });

    it('says so when there is no build script to run', () => {
        const dir = scaffold(join(tmpDir, 'no-build-script'));
        const pkgPath = join(dir, 'package.json');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        delete pkg.scripts;
        writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
        let output;
        try {
            runCliSync(CLI_ENTRY, ['ship'], { cwd: dir });
            assert.fail('expected `gjsify ship` to fail');
        } catch (error) {
            output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
        }
        assert.match(output, /no `build` script/);
        assert.match(output, /--skip-build/);
    });

    it('refuses a GI namespace it cannot map to a package', () => {
        // The failure this prevents does not happen here: it happens on a
        // user's machine, after the download, as a dynamic-linker error that
        // reads like an application bug.
        const dir = scaffold(join(tmpDir, 'unmapped'));
        writeFileSync(join(dir, 'dist', 'gjs.js'), `import N from 'gi://Nautilus?version=3.0';\nprint(N);\n`);
        const result = runCliExpectingFailure(dir);
        assert.match(result, /gi:\/\/Nautilus/);
        assert.match(result, /typelibPackages/);
    });

    it('accepts the same namespace once the project supplies the mapping', () => {
        const dir = scaffold(join(tmpDir, 'escape-hatch'), (pkg) => {
            pkg.gjsify.ship.typelibPackages = {
                'Nautilus-3.0': { deb: 'gir1.2-nautilus-3.0', rpm: 'nautilus' },
            };
        });
        writeFileSync(join(dir, 'dist', 'gjs.js'), `import N from 'gi://Nautilus?version=3.0';\nprint(N);\n`);
        runCliSync(CLI_ENTRY, ['ship', '--skip-build'], { cwd: dir });
        const rpmFile = join(dir, 'ship', 'out', 'ship-demo-1.2.3-1.noarch.rpm');
        assert.ok(existsSync(rpmFile));
        if (!probe('rpm')) return;
        assert.match(execFileSync('rpm', ['-qp', '--requires', rpmFile], { encoding: 'utf-8' }), /^nautilus$/m);
    });

    it('refuses a build target it cannot package', () => {
        // The launcher execs `gjs -m <bundle>`, so a `--app node` project would
        // otherwise get a package that installs and fails at startup — and the
        // fix for that case (a bundled Node) is still an open ADR decision.
        const dir = scaffold(join(tmpDir, 'app-node'), (pkg) => {
            pkg.gjsify.app = 'node';
        });
        const result = runCliExpectingFailure(dir);
        assert.match(result, /only `gjs` can be packaged today/);
        assert.match(result, /ADR 0024/);
    });

    it('refuses a payload file that would shadow the stage manifest', () => {
        // `extraFiles` can name any prefix-relative destination, and the stage root holds exactly
        // one file that is not payload. A collision there would either pack the manifest or lose
        // the closure that makes the tree packable on another host.
        const dir = scaffold(join(tmpDir, 'shadow-manifest'), (pkg) => {
            pkg.gjsify.ship.extraFiles = { [STAGE_MANIFEST_FILE]: 'LICENSE' };
        });
        const result = runCliExpectingFailure(dir);
        assert.match(result, new RegExp(STAGE_MANIFEST_FILE.replace(/\./g, '\\.')));
        assert.match(result, /extraFiles/);
    });

    it('refuses a schema that would collide in the shared system directory', () => {
        const dir = scaffold(join(tmpDir, 'bad-schema'));
        rmSync(join(dir, 'data', `${APP_ID}.gschema.xml`));
        writeFileSync(join(dir, 'data', 'settings.gschema.xml'), '<schemalist/>\n');
        assert.match(runCliExpectingFailure(dir), /must be named/);
    });

    // ── helpers ───────────────────────────────────────────────────────────

    function debPath(dir = projectDir) {
        return join(dir, 'ship', 'out', 'ship-demo_1.2.3-1_all.deb');
    }

    function rpmPath(dir = projectDir) {
        return join(dir, 'ship', 'out', 'ship-demo-1.2.3-1.noarch.rpm');
    }

    function runCliExpectingFailure(cwd) {
        try {
            runCliSync(CLI_ENTRY, ['ship', '--skip-build'], { cwd });
        } catch (error) {
            return `${error.stdout ?? ''}${error.stderr ?? ''}`;
        }
        assert.fail('expected `gjsify ship` to fail');
    }

    function extractDeb() {
        const dir = join(tmpDir, 'deb-extract');
        if (existsSync(join(dir, 'control'))) return dir;
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        execFileSync('ar', ['x', debPath()], { cwd: dir });
        execFileSync('tar', ['xzf', 'control.tar.gz'], { cwd: dir });
        return dir;
    }

    function readControlFile(name) {
        return readFileSync(join(extractDeb(), name), 'utf-8');
    }

    function readDataListing() {
        const output = execFileSync('tar', ['tvzf', join(extractDeb(), 'data.tar.gz')], { encoding: 'utf-8' });
        return output
            .trim()
            .split('\n')
            .map((line) => {
                const parts = line.trim().split(/\s+/);
                return { mode: parts[0], owner: parts[1], name: parts[parts.length - 1], kind: parts[0][0] };
            });
    }
});
