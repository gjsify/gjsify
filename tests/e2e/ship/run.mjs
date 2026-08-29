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
    NODE_BUNDLE,
    listPayload,
    plantCatalogue,
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

    // ── freedesktop metadata localisation ─────────────────────────────────
    //
    // `ship` has always staged the compiled `.mo` catalogues AND generated a
    // `.desktop` entry and an AppStream component. The two never met: no
    // `Name[xx]=`, no `xml:lang=`, so a fully translated app showed an English
    // name in the app menu and in Software.
    //
    // Validation alone cannot cover this, and that is the point of the extra
    // assertions below. Measured on a probe tree: `msgfmt --desktop
    // --template=app.desktop.in -d po -o out.desktop` exits 0, writes the file
    // back UNTRANSLATED, and `desktop-file-validate out.desktop` exits 0. An
    // oracle that accepts the broken output is not an oracle for this defect —
    // so each test asserts the localised keys are PRESENT, and the validators
    // additionally prove the localisation did not corrupt the file.

    const TRANSLATIONS = {
        de: { 'Ship Demo': 'Schiffsdemo', 'Prove that gjsify ship works': 'Beweise, dass gjsify ship funktioniert' },
        fr: { 'Ship Demo': 'Démo Ship', 'Prove that gjsify ship works': 'Prouver que gjsify ship fonctionne' },
    };

    /** A staged project whose catalogues translate the metadata strings. */
    function stageLocalised(name) {
        const dir = scaffold(join(tmpDir, name), (pkg, projectRoot) => {
            pkg.gjsify.ship.localeDir = 'dist/locale';
            for (const [lang, entries] of Object.entries(TRANSLATIONS)) plantCatalogue(projectRoot, lang, entries);
        });
        runCliSync(CLI_ENTRY, ['ship', '--skip-build', '--stage'], { cwd: dir });
        return join(dir, 'ship', 'stage');
    }

    let localisedStage;

    before(() => {
        for (const tool of ['msgfmt', 'msgunfmt', 'desktop-file-validate', 'appstreamcli']) probe(tool);
        localisedStage = stageLocalised('localised');
    });

    it('folds the staged catalogues into the .desktop entry', () => {
        const entry = readFileSync(join(localisedStage, 'share', 'applications', `${APP_ID}.desktop`), 'utf-8');

        // PRESENCE, not validity. The untranslated file is valid too.
        assert.match(entry, /^Name\[de\]=Schiffsdemo$/m);
        assert.match(entry, /^Name\[fr\]=Démo Ship$/m);
        assert.match(entry, /^Comment\[de\]=Beweise, dass gjsify ship funktioniert$/m);
        assert.match(entry, /^Comment\[fr\]=Prouver que gjsify ship fonctionne$/m);
        // The untranslated keys survive as the C-locale fallback.
        assert.match(entry, /^Name=Ship Demo$/m);
        assert.match(entry, /^Comment=Prove that gjsify ship works$/m);
    });

    it('folds the staged catalogues into the AppStream component', () => {
        const xml = readFileSync(join(localisedStage, 'share', 'metainfo', `${APP_ID}.metainfo.xml`), 'utf-8');

        assert.match(xml, /<name xml:lang="de">Schiffsdemo<\/name>/);
        assert.match(xml, /<name xml:lang="fr">Démo Ship<\/name>/);
        assert.match(xml, /<summary xml:lang="de">Beweise, dass gjsify ship funktioniert<\/summary>/);
        assert.match(xml, /<summary xml:lang="fr">Prouver que gjsify ship fonctionne<\/summary>/);
        assert.match(xml, /<name>Ship Demo<\/name>/);
    });

    it('keeps both files readable by their independent validators', () => {
        // desktop-file-utils and appstream — different implementation families from
        // ours and from each other. They cannot detect a MISSING translation (see the
        // section comment); what they prove is that adding one kept the file well-formed,
        // which is the half a `grep` for `Name[de]` cannot see.
        execFileSync('desktop-file-validate', [join(localisedStage, 'share', 'applications', `${APP_ID}.desktop`)], {
            stdio: 'pipe',
        });
        // `--no-net`: without it appstreamcli resolves every `<url>` and the fixture's
        // `https://example.org/ship-demo` returns 404, so the check reported
        // `url-not-reachable` and exited 3 — a suite whose result depended on the
        // network reaching a domain that is reserved for examples by definition.
        execFileSync(
            'appstreamcli',
            ['validate', '--no-net', join(localisedStage, 'share', 'metainfo', `${APP_ID}.metainfo.xml`)],
            { stdio: 'pipe' },
        );
    });

    it('leaves the metadata untouched when the project ships no catalogues', () => {
        // The default fixture declares no `localeDir`, so nothing runs msgfmt at all —
        // a project without translations must not need the gettext tools.
        const stage = join(projectDir, 'ship', 'stage');
        assert.doesNotMatch(
            readFileSync(join(stage, 'share', 'applications', `${APP_ID}.desktop`), 'utf-8'),
            /^Name\[/m,
        );
        // BOTH files, because they take different code paths: `kind: 'cli'` renders a
        // component and no desktop entry at all, so a regression that left the XML
        // chain running unconditionally would be invisible in the entry alone.
        assert.doesNotMatch(
            readFileSync(join(stage, 'share', 'metainfo', `${APP_ID}.metainfo.xml`), 'utf-8'),
            /xml:lang/,
        );
    });

    it('folds the catalogues in reproducibly', () => {
        // The chain runs through a `mkdtemp` directory and merges the catalogues in a
        // sorted order `localize-metadata.ts` fixes itself. Both are ways for a
        // run-to-run difference to reach the artifact, and `packs the same build twice
        // into byte-identical artifacts` below never sees them: its project ships no
        // catalogues, so its metadata never goes near msgfmt.
        //
        // What this does NOT prove: that the sort defends against a differently ordered
        // `readdir`. Two runs on one machine see the same directory order, so only the
        // sort's PRESENCE covers that.
        const second = stageLocalised('localised-again');
        for (const rel of [
            join('share', 'applications', `${APP_ID}.desktop`),
            join('share', 'metainfo', `${APP_ID}.metainfo.xml`),
        ]) {
            assert.strictEqual(
                readFileSync(join(second, rel), 'utf-8'),
                readFileSync(join(localisedStage, rel), 'utf-8'),
                `${rel} differed between two runs of the same project`,
            );
        }
    });

    it('stages the catalogues alongside the localised metadata', () => {
        const staged = listPayload(localisedStage);
        assert.ok(staged.includes(`share/locale/de/LC_MESSAGES/${APP_ID}.mo`));
        assert.ok(staged.includes(`share/locale/fr/LC_MESSAGES/${APP_ID}.mo`));
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
        // …and that line ALONE does not discriminate. This fixture is an app
        // with a desktop entry, so it has scriptlets, and their `Requires(post)`
        // sense produces `/bin/sh` on its own — which is why every scriptlet-free
        // package this writer produced (gjsify's own CLI among them) declared no
        // shell at all while this assertion stayed green. The sense is the
        // discriminator: 16384 is RPMSENSE_FIND_REQUIRES, "derived from the
        // payload", and only the launcher's `#!/bin/sh` can put it there.
        const senses = execFileSync('rpm', ['-qp', '--qf', '[%{REQUIRENAME} %{REQUIREFLAGS}\n]', rpmPath()], {
            encoding: 'utf-8',
        });
        assert.match(senses, /^\/bin\/sh 16384$/m);
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
        // `gjs` and `node` are packageable; a browser bundle has no process to
        // launch and NativeScript ships through a different pipeline entirely.
        // Layout-independent on purpose: making the check per-layout refused
        // `gjsify.app: "gjs"` for macOS, which is the declaration this command's
        // whole audience uses.
        const dir = scaffold(join(tmpDir, 'app-browser'), (pkg) => {
            pkg.gjsify.app = 'browser';
        });
        const result = runCliExpectingFailure(dir);
        assert.match(result, /only `gjs` and `node` can be/);
        assert.match(result, /ADR 0024/);
    });

    // ── the interpreter: what the launcher execs and what the package asks for ──
    //
    // These two cases are one question from both sides, and the second is the
    // regression: the first cut of the Node half derived "this needs Node" from a
    // FILENAME anywhere in the staged tree, while the launcher execed gjs
    // unconditionally. That is not a cosmetic disagreement — `nodejs (>= 24)` is
    // unsatisfiable on trixie, Ubuntu 24.04 and Ubuntu 26.04, so a working GJS
    // package became one apt refuses everywhere. Both assertions run against a
    // real `.rpm` read by `rpm`, in the suite whose whole premise is that only an
    // independent reader catches this class.

    it('a `--app node` project execs node and depends on node, never on gjs', () => {
        const dir = scaffold(join(tmpDir, 'app-node'), (pkg, at) => {
            pkg.gjsify.app = 'node';
            pkg.gjsify.main = 'dist/app.node.mjs';
            pkg.main = 'dist/app.node.mjs';
            writeFileSync(join(at, 'dist', 'app.node.mjs'), NODE_BUNDLE);
        });
        runCliSync(CLI_ENTRY, ['ship', '--skip-build'], { cwd: dir });

        const launcher = readFileSync(join(dir, 'ship', 'stage', 'bin', 'ship-demo'), 'utf-8');
        // `node`, and WITHOUT `-m`: node rejects the flag gjs requires.
        assert.match(launcher, /exec node "\$prefix"\/lib\/ship-demo\/app\.node\.mjs "\$@"/);
        // `/gjs/` alone would be wrong here and was: the generated header line
        // says "Generated by `gjsify ship`". The claim is about the exec line.
        assert.doesNotMatch(launcher, /exec gjs/);

        if (!probe('rpm')) return;
        const rpmFile = join(dir, 'ship', 'out', 'ship-demo-1.2.3-1.noarch.rpm');
        const requires = execFileSync('rpm', ['-qp', '--requires', rpmFile], { encoding: 'utf-8' });
        // ⚠️ `nodejs(engine)`, never a bare `nodejs`: Fedora's virtual `nodejs`
        // Provide carries Epoch 1, so `nodejs >= 24` desugars to `0:24` and is
        // satisfied by `1:22.23.1` — a floor that silently admits Node 22.
        assert.match(requires, /^nodejs\(engine\) >= 24$/m);
        assert.doesNotMatch(requires, /^gjs/m);
        // The typelibs are still derived: a Node bundle reaches GI through
        // @gjsify/node-gi, so its `gi://` imports are dependencies exactly as a
        // GJS bundle's are.
        assert.match(requires, /^gtk4$/m);
        assert.match(requires, /^libadwaita$/m);
    });

    it('refuses `--app node` for a runtime that has no node, before anything is staged', () => {
        // The hole the `--app node` support opened. `assertShippableTarget` used
        // to refuse `app: node` outright, so no format ever saw one; lifting that
        // made deb and rpm correct and left Flatpak silently wrong. Measured at
        // exit 0 before this refusal: a manifest with `runtime: org.gnome.Platform`
        // and no `sdk-extensions`, beside a launcher that execs `node`.
        //
        // `--stage`, so the case needs no flatpak-builder: staging is exactly
        // where the reviewer reproduced it, and the stage is what crosses to the
        // packing host.
        const dir = scaffold(join(tmpDir, 'flatpak-node'), (pkg, at) => {
            pkg.gjsify.app = 'node';
            pkg.gjsify.main = 'dist/app.node.mjs';
            pkg.main = 'dist/app.node.mjs';
            writeFileSync(join(at, 'dist', 'app.node.mjs'), NODE_BUNDLE);
        });
        const output = runCliExpectingFailure(dir, ['--stage', '--target', 'flatpak']);
        assert.match(output, /the flatpak runtime cannot run it/);
        assert.match(output, /org\.gnome\.Platform/);
        // Nothing may have been written: the refusal is before the stage.
        assert.equal(existsSync(join(dir, 'ship', 'stage')), false);
    });

    it('packs a project whose extraFiles replaces the launcher with an absolute interpreter', () => {
        // The regression the launcher check introduced and this pins. An
        // untouched `--app gjs` project whose `gjsify.ship.extraFiles` overrides
        // `bin/<name>` used to pack fine; the first cut of the check compared the
        // raw exec token and refused it at exit 1 with "execs `/usr/bin/gjs`".
        // A guard that turns working packages into failures buys nothing over the
        // defect it prevents.
        const dir = scaffold(join(tmpDir, 'extrafiles-launcher'), (pkg, at) => {
            pkg.gjsify.ship.extraFiles = { 'bin/ship-demo': 'launcher.sh' };
            writeFileSync(
                join(at, 'launcher.sh'),
                '#!/bin/sh\nset -e\nexec env G_MESSAGES_DEBUG=all /usr/bin/gjs -m /usr/lib/ship-demo/gjs.js "$@"\n',
            );
        });
        runCliSync(CLI_ENTRY, ['ship', '--skip-build'], { cwd: dir });
        const launcher = readFileSync(join(dir, 'ship', 'stage', 'bin', 'ship-demo'), 'utf-8');
        assert.match(launcher, /exec env G_MESSAGES_DEBUG=all \/usr\/bin\/gjs -m/);
        assert.ok(existsSync(join(dir, 'ship', 'out', 'ship-demo-1.2.3-1.noarch.rpm')));
    });

    it('a `--app gjs` project with a Node bundle beside it depends on gjs alone', () => {
        // `discoverPayload` stages the WHOLE directory beside the bundle, and
        // `dist/<name>.gjs.js` next to `dist/<name>.node.mjs` is the layout
        // `resolve-gjs-entry.ts` documents as normal. Both files are therefore in
        // the payload; only one of them is what the launcher runs.
        const dir = scaffold(join(tmpDir, 'gjs-with-node-sibling'), (pkg, at) => {
            writeFileSync(join(at, 'dist', 'app.node.mjs'), NODE_BUNDLE);
        });
        runCliSync(CLI_ENTRY, ['ship', '--skip-build'], { cwd: dir });

        const staged = listPayload(join(dir, 'ship', 'stage'));
        assert.ok(staged.includes('lib/ship-demo/app.node.mjs'), 'the sibling must really be staged');
        assert.match(readFileSync(join(dir, 'ship', 'stage', 'bin', 'ship-demo'), 'utf-8'), /exec gjs -m/);

        if (!probe('rpm')) return;
        const requires = execFileSync(
            'rpm',
            ['-qp', '--requires', join(dir, 'ship', 'out', 'ship-demo-1.2.3-1.noarch.rpm')],
            { encoding: 'utf-8' },
        );
        assert.match(requires, /^gjs >= 1\.86$/m);
        assert.doesNotMatch(requires, /nodejs/);
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

    // ── the licence ───────────────────────────────────────────────────────
    //
    // `.deb: the Debian copyright overlay is where policy wants it` above has
    // passed since the packer landed, and gjsify's own `.deb` shipped without
    // that copyright the whole time. The assertion was right and the FIXTURE was
    // not: every project scaffolded here is a single package carrying its own
    // LICENSE, and gjsify is not that shape — `packages/infra/cli` has no
    // LICENSE, the text is one file at the repository root, and discovery looked
    // in the package directory only. A green assertion on an unrepresentative
    // fixture is the version of green-CI-that-checked-nothing that survives
    // review, because nothing about it looks weak.

    it('takes the licence from the repository root when the package carries none', () => {
        const root = join(tmpDir, 'mono');
        const dir = scaffold(join(root, 'packages', 'app'));
        rmSync(join(dir, 'LICENSE'));
        // A FILE, not a directory: that is what `.git` is in a git worktree, and
        // it marks the top of the climb in either spelling.
        writeFileSync(join(root, '.git'), 'gitdir: elsewhere\n');
        writeFileSync(join(root, 'LICENSE'), 'MIT License\n\nRoot terms.\n');
        runCliSync(CLI_ENTRY, ['ship', '--skip-build', '--target', 'deb'], { cwd: dir });

        // Read off the materialised overlay rather than out of the `.deb`: this
        // needs no `ar` and no `tar`, so it cannot degrade into a silent skip on
        // a runner that lacks them — and the same bytes go into the archive.
        const copyright = join(dir, 'ship', 'overlay', 'deb', 'share', 'doc', 'ship-demo', 'copyright');
        assert.ok(existsSync(copyright), 'no copyright overlay was rendered');
        // The ROOT text specifically. A copyright rendered from some other file
        // would satisfy an existence check and still be the wrong licence.
        assert.match(readFileSync(copyright, 'utf-8'), /Root terms\./);
    });

    it('refuses a project with no licence anywhere, rather than packaging one without', () => {
        const dir = scaffold(join(tmpDir, 'no-licence'));
        rmSync(join(dir, 'LICENSE'));
        // No `.git` and no workspace root above a tmpdir, so the climb has
        // nowhere to go — which is the case that must fail, not fall back.
        assert.match(runCliExpectingFailure(dir), /share\/doc\/ship-demo\/copyright/);
    });

    // ── helpers ───────────────────────────────────────────────────────────

    function debPath(dir = projectDir) {
        return join(dir, 'ship', 'out', 'ship-demo_1.2.3-1_all.deb');
    }

    function rpmPath(dir = projectDir) {
        return join(dir, 'ship', 'out', 'ship-demo-1.2.3-1.noarch.rpm');
    }

    function runCliExpectingFailure(cwd, extraArgs = []) {
        let failed = false;
        let output = '';
        try {
            runCliSync(CLI_ENTRY, ['ship', '--skip-build', ...extraArgs], { cwd });
        } catch (error) {
            failed = true;
            output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
        }
        // `assert.fail` OUTSIDE the try. Inside it, its own AssertionError is
        // caught by the very `catch` below and turned into an empty `output`,
        // so a test that should have reported "the command SUCCEEDED" instead
        // reports "the output did not match" — the failure names the wrong thing.
        if (!failed) assert.fail('expected `gjsify ship` to fail');
        return output;
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
