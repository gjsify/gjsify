// E2E for `scripts/report-target-gap.mjs`.
//
// A report that prints a number nobody can check is worse than none, so every expectation below
// is DERIVED from the same tables the report reads (`GI_RENDERERS`, each renderer's
// `./capabilities`) instead of copied from today's answer: this suite holds the report's
// logic — what it counts, what it skips, when it fails — and keeps holding it on the day a
// renderer gains a widget or a namespace. Only two names are invented to be absent forever
// (`Adw.NoSuchMemberForTheReport` and a syntax-broken file).
//
// The report is a report, not a gate: it exits 0 on a project that is far from every target and
// 2 only when it could not do its job. Both halves are asserted, because "exit 0" is also what a
// script that read nothing would give.
//
// The `fixtures/project` tree is read as data and never built.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ts from 'typescript';

import { MONOREPO_ROOT } from '../helpers.mjs';
import {
    bindFormIssues,
    exportedValueNames,
    hasTemplateScope,
    registeredBarrelFiles,
} from '../../../scripts/lib/target-gap-barrel.mjs';

const REPORT = join(MONOREPO_ROOT, 'scripts/report-target-gap.mjs');
const FIXTURE = join(MONOREPO_ROOT, 'tests/e2e/report-target-gap/fixtures/project');

const { GI_RENDERERS } = await import(join(MONOREPO_ROOT, 'packages/infra/resolve-npm/lib/gi-renderers.mjs'));
const { capabilities: webCapabilities } = await import(
    join(MONOREPO_ROOT, 'packages/web/adwaita-web/src/capabilities.mjs')
);
const TARGETS = Object.keys(GI_RENDERERS);

const run = (args) => spawnSync('node', [REPORT, ...args], { encoding: 'utf8', cwd: MONOREPO_ROOT });
const reportOf = (dir) => {
    const result = run([dir, '--json']);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
};

describe('report-target-gap', () => {
    let scratch;
    before(() => {
        scratch = mkdtempSync(join(tmpdir(), 'report-target-gap-'));
    });
    after(() => rmSync(scratch, { recursive: true, force: true }));

    it('exits 0 on a project that is far from every target: it is a report, not a gate', () => {
        const result = run([FIXTURE]);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /== \.blp templates \(2\) ==/);
        assert.match(result.stdout, /== gi:\/\/ in source \(1 file\) ==/);
        assert.match(result.stdout, /== summary ==/);
    });

    it('reads the targets from GI_RENDERERS, one section per row', () => {
        const report = reportOf(FIXTURE);
        assert.deepEqual(
            report.renderers.map((row) => row.target),
            TARGETS,
        );
        for (const target of TARGETS) assert.ok(report.summary.targets[target], target);
    });

    it('reports a construct a renderer refuses, with its line, from that renderer’s own table', () => {
        const row = reportOf(FIXTURE).blueprints.find((found) => found.file === 'window.blp');
        assert.equal(row.projects, true, 'a layout is carried, not lost (ADR 0092)');
        const refusesLayout = webCapabilities.layout !== 'implemented';
        assert.deepEqual(row.targets.browser.refused, refusesLayout ? [{ kind: 'layout', line: 9 }] : []);
        assert.equal(row.builds.browser, !refusesLayout);
    });

    it('answers a namespace GI_RENDERERS has no row for as "no renderer", per target', () => {
        const report = reportOf(FIXTURE);
        const [source] = report.sources;
        assert.equal(source.file, 'app.ts');
        for (const target of TARGETS) {
            const answered = 'GObject' in GI_RENDERERS[target].namespaces;
            assert.equal(source.unmet[target].noRenderer.includes('GObject'), !answered, target);
        }
    });

    it('answers a member the renderer namespace lacks as "renderer lacks member", counting every use', () => {
        const report = reportOf(FIXTURE);
        const [source] = report.sources;
        assert.equal(
            source.members['Adw.NoSuchMemberForTheReport'],
            2,
            'the two value uses; the type position is counted apart',
        );
        for (const target of TARGETS) {
            assert.ok(source.unmet[target].lacksMember.includes('Adw.NoSuchMemberForTheReport'), target);
            const row = report.summary.targets[target].sources.lacksMember.find(
                (found) => found.member === 'Adw.NoSuchMemberForTheReport',
            );
            assert.deepEqual([row.uses, row.files], [2, ['app.ts']]);
        }
    });

    it('lists the members of a namespace with no renderer, one row each', () => {
        const report = reportOf(FIXTURE);
        for (const target of TARGETS) {
            const row = report.summary.targets[target].sources.noRenderer.find(
                (found) => found.namespace === 'GObject',
            );
            assert.equal(row === undefined, 'GObject' in GI_RENDERERS[target].namespaces, target);
            if (row)
                assert.deepEqual(
                    row.members.map((member) => [member.member, member.uses]),
                    [['GObject.registerClass', 1]],
                );
        }
    });

    it('counts a type position apart from a value use, and never in the unmet list', () => {
        const report = reportOf(FIXTURE);
        const [source] = report.sources;
        assert.equal(source.members['GObject.ParamSpec'], undefined, 'an annotation needs nothing at run time');
        assert.equal(source.typeMembers['GObject.ParamSpec'], 1);
        assert.equal(source.typeMembers['Adw.NoSuchMemberForTheReport'], 1);
        assert.equal(source.members['Adw.Window'], 1, '`extends` is a value; `implements` is not');
        assert.equal(source.typeMembers['Gtk.Buildable'], 1);
        for (const target of TARGETS) {
            const { lacksMember, noRenderer, typeOnly } = report.summary.targets[target].sources;
            assert.ok(!lacksMember.some((row) => row.member === 'GObject.ParamSpec'));
            assert.ok(!noRenderer.some((row) => row.members.some((member) => member.member === 'GObject.ParamSpec')));
            assert.ok(typeOnly.some((row) => row.member === 'Adw.NoSuchMemberForTheReport'));
        }
    });

    it('counts neither prose nor a type-only import as a use', () => {
        const [source] = reportOf(FIXTURE).sources;
        assert.equal(source.members['Gtk.Button'], undefined, 'a comment and a string name it');
        assert.equal(source.members['Gtk.Label'], undefined, '`import type` leaves no runtime dependency');
        assert.equal(source.typeMembers['Gtk.Label'], 1);
        assert.deepEqual(
            source.imports.map((entry) => [entry.namespace, entry.version]),
            [
                ['GObject', '2.0'],
                ['Adw', '1'],
            ],
        );
    });

    it('skips declarations, specs, generated files and vendored directories', () => {
        const project = join(scratch, 'skips');
        const gi = "import Adw from 'gi://Adw?version=1';\nAdw.NoSuchMemberForTheReport;\n";
        for (const dir of ['', 'node_modules/dep', 'dist', 'generated'])
            mkdirSync(join(project, dir), { recursive: true });
        writeFileSync(join(project, 'kept.ts'), gi);
        writeFileSync(join(project, 'types.d.ts'), gi);
        writeFileSync(join(project, 'thing.spec.ts'), gi);
        writeFileSync(join(project, 'marked.ts'), `// @generated\n${gi}`);
        for (const dir of ['node_modules/dep', 'dist', 'generated']) writeFileSync(join(project, dir, 'x.ts'), gi);
        assert.deepEqual(
            reportOf(project).sources.map((source) => source.file),
            ['kept.ts'],
        );
    });

    it('reads namespace and side-effect imports, and a multi-line named import', () => {
        const project = join(scratch, 'forms');
        mkdirSync(project, { recursive: true });
        writeFileSync(
            join(project, 'forms.ts'),
            [
                "import * as Gtk from 'gi://Gtk?version=4.0';",
                "import 'gi://Gdk?version=4.0';",
                "import {\n    Application,\n    Notification as N,\n} from 'gi://Gio';",
                'Gtk.NoSuchMemberForTheReport;',
            ].join('\n'),
        );
        const [source] = reportOf(project).sources;
        assert.deepEqual(source.imports.map((entry) => entry.namespace).sort(), ['Gdk', 'Gio', 'Gtk']);
        assert.equal(source.members['Gtk.NoSuchMemberForTheReport'], 1);
        assert.equal(source.members['Gio.Application'], 1);
        assert.equal(source.members['Gio.Notification'], 1);
    });

    it('counts a runtime @girs import as the gi:// import its package makes, found from the project', () => {
        const project = join(scratch, 'girs');
        const girs = join(project, 'node_modules/@girs/gdk-4.0');
        mkdirSync(girs, { recursive: true });
        writeFileSync(join(girs, 'gdk-4.0.js'), "import Gdk from 'gi://Gdk?version=4.0';\nexport default Gdk;\n");
        mkdirSync(join(project, 'src'), { recursive: true });
        writeFileSync(
            join(project, 'src/girs.ts'),
            "import Gdk from '@girs/gdk-4.0';\nimport type Gtk from '@girs/gtk-4.0';\nGdk.Display;\n",
        );
        const report = reportOf(project);
        assert.deepEqual(
            report.sources[0].imports.map((entry) => [entry.namespace, entry.version, entry.via]),
            [['Gdk', '4.0', '@girs/gdk-4.0']],
        );
        assert.equal(report.unresolvedGirs, 0);
    });

    it('says so when an @girs package is found nowhere, and still exits 0', () => {
        const project = join(scratch, 'girs-absent');
        mkdirSync(project, { recursive: true });
        writeFileSync(join(project, 'a.ts'), "import Nope from '@girs/nope-9.9';\nNope.X;\n");
        const result = run([project]);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /note: 1 @girs\/\* import\(s\) not scanned/);
        assert.equal(reportOf(project).sources.length, 0);
    });

    describe('signal and notify declarations (ADR 0093)', () => {
        const issuesOf = (target) =>
            reportOf(FIXTURE).blueprints.find((row) => row.file === 'signals.blp').targets[target].signals;

        it('reports a signal the class does not declare, with its line, and not one it does', () => {
            for (const target of TARGETS) {
                const issues = issuesOf(target).filter((issue) => issue.issue === 'undeclared-signal');
                assert.deepEqual(
                    issues,
                    [{ issue: 'undeclared-signal', tag: 'GtkButton', name: 'activate', line: 11 }],
                    target,
                );
            }
        });

        it('reports a bind whose source class declares no notify for the property', () => {
            for (const target of TARGETS) {
                const issues = issuesOf(target).filter((issue) => issue.issue === 'undeclared-notify');
                assert.deepEqual(
                    issues,
                    [{ issue: 'undeclared-notify', tag: 'GtkToggleButton', name: 'sensitive', line: 15 }],
                    target,
                );
            }
        });

        it('keeps the template out of "builds" and tallies the undeclared signals per widget', () => {
            const report = reportOf(FIXTURE);
            for (const target of TARGETS) {
                assert.equal(report.blueprints.find((row) => row.file === 'signals.blp').builds[target], false);
                const keys = report.summary.targets[target].blueprints.undeclaredSignals.map((row) => [
                    row.key,
                    row.files,
                ]);
                assert.deepEqual(keys.sort(), [
                    ['GtkButton::activate', ['signals.blp']],
                    ['GtkToggleButton::notify::sensitive', ['signals.blp']],
                ]);
            }
        });

        it('accepts a `template` source and a bind flag on a target whose GObject has registerClass', () => {
            const project = join(scratch, 'forms-blp');
            mkdirSync(project, { recursive: true });
            writeFileSync(
                join(project, 'form.blp'),
                'using Gtk 4.0;\n\ntemplate $Form : Box {\n  Label {\n    label: bind template.title;\n  }\n\n  ToggleButton pressed {}\n\n  Button {\n    sensitive: bind pressed.active inverted;\n  }\n}\n',
            );
            for (const target of TARGETS) {
                const issues = reportOf(project).blueprints[0].targets[target].signals.map((issue) => [
                    issue.issue,
                    issue.name,
                ]);
                assert.deepEqual(issues, []);
            }
        });
    });

    describe('template bind forms follow the target GObject barrel', () => {
        const binds = [
            { source: 'template', property: 'title', flags: [], line: 1 },
            { source: 'pressed', property: 'active', flags: ['inverted'], line: 2 },
        ];
        const barrelOf = (text) =>
            new Map([['GObject', exportedValueNames(ts.createSourceFile('gobject.ts', text, ts.ScriptTarget.Latest))]]);
        const issuesOn = (barrels) =>
            binds
                .flatMap((bind) => bindFormIssues(bind, 'GtkBox', hasTemplateScope(barrels)))
                .map((i) => [i.issue, i.name]);

        it('refuses the template source and the flag when the GObject barrel has no registerClass', () => {
            const refused = [
                ['refused-bind-flag', 'inverted'],
                ['refused-bind-source', 'template'],
            ];
            assert.deepEqual(issuesOn(barrelOf('export const type_ensure = 1;')).sort(), refused.sort());
        });

        it('refuses them when the target has no GObject barrel at all', () => {
            assert.equal(hasTemplateScope(new Map()), false);
            assert.equal(issuesOn(new Map()).length, 2);
        });

        it('accepts them when the barrel exports registerClass, as a const or as a re-export', () => {
            assert.deepEqual(issuesOn(barrelOf('export const registerClass = 1;')), []);
            assert.deepEqual(issuesOn(barrelOf("export { registerClass } from './x.js';")), []);
        });

        it('does not count a type-only or a non-exported registerClass', () => {
            assert.equal(hasTemplateScope(barrelOf('const registerClass = 1;')), false);
            assert.equal(hasTemplateScope(barrelOf("export type { registerClass } from './x.js';")), false);
        });
    });

    it('turns a .blp that does not parse into a row with an error, not a crash', () => {
        const project = join(scratch, 'broken');
        mkdirSync(project, { recursive: true });
        writeFileSync(join(project, 'broken.blp'), 'using Gtk 4.0;\nBox {{{\n');
        const result = run([project, '--json']);
        assert.equal(result.status, 0, result.stderr);
        const [row] = JSON.parse(result.stdout).blueprints;
        assert.equal(typeof row.error, 'string');
        assert.equal(row.projects, false);
        assert.ok(Object.values(row.builds).every((builds) => builds === false));
    });

    it('prints "ok" for a template with no gap on any target', () => {
        const project = join(scratch, 'clean');
        mkdirSync(project, { recursive: true });
        writeFileSync(join(project, 'clean.blp'), 'using Gtk 4.0;\n\nLabel {\n  label: "x";\n}\n');
        const result = run([project]);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /^ok\s+clean\.blp$/m);
    });

    describe('exits 2 when it could not do its job', () => {
        it('with no project directory (there is no default sibling path)', () => {
            const result = run([]);
            assert.equal(result.status, 2);
            assert.match(result.stderr, /expected exactly one project directory/);
        });

        it('with a directory that does not exist', () => {
            const result = run([join(scratch, 'absent')]);
            assert.equal(result.status, 2);
            assert.match(result.stderr, /is not a directory/);
        });

        it('with a file where a directory belongs', () => {
            const result = run([REPORT]);
            assert.equal(result.status, 2);
            assert.match(result.stderr, /is not a directory/);
        });

        it('with an unknown flag', () => {
            const result = run([FIXTURE, '--nope']);
            assert.equal(result.status, 2);
            assert.match(result.stderr, /unknown flag --nope/);
        });
    });

    it('reads a barrel a package registers in src/builder.ts, and only a barrel that exists', () => {
        const make = (name, builder, barrel) => {
            const dir = join(scratch, name);
            mkdirSync(join(dir, 'src/namespace'), { recursive: true });
            if (builder) writeFileSync(join(dir, 'src/builder.ts'), builder);
            if (barrel) writeFileSync(join(dir, 'src/namespace/probelib.ts'), barrel);
            return dir;
        };
        const call = "registerBarrel('probelib', 'ProbeLib', ProbeLib);\n";
        const registered = make('registered', call, "export { Thing as View } from '../thing.js';\n");
        const noBuilder = make('no-builder', undefined, "export { Thing as View } from '../thing.js';\n");
        const noBarrel = make('no-barrel', call, undefined);
        const own = make('own', call, "export { Thing as View } from '../thing.js';\n");
        assert.deepEqual(registeredBarrelFiles([registered, noBuilder, noBarrel], own), [
            join(registered, 'src/namespace/probelib.ts'),
        ]);
        assert.deepEqual(registeredBarrelFiles([own], own), [], 'the renderer’s own package is not a registration');
    });
});
