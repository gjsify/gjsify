// SPDX-License-Identifier: MIT
// Phase 6b: @ts-for-gir/generator-json and @ts-for-gir/generator-html-doc programmatic tests.
// Tests actual TypeDoc-based generation (JSON output, HTML output), not just CLI --help.
//
// Pipeline under test (same for both generators):
//   DependencyManager → GirModule.load → GirModule.parse →
//   JsonDefinitionGenerator / HtmlDocGenerator →
//   TypeDocPipeline (TypeDefinitionGenerator → .d.ts → TypeDoc → output)

import { writeFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, on } from '@gjsify/unit';
import {
    DependencyManager,
    GirModule,
    NSRegistry,
    type OptionsGeneration,
} from '@ts-for-gir/lib';
import { JsonDefinitionGenerator } from '@ts-for-gir/generator-json';
import { HtmlDocGenerator } from '@ts-for-gir/generator-html-doc';

// Minimal GIR — no <include> deps so DependencyManager never needs GObject-2.0.
// Identical to generator.spec.ts so both tests share the same /tmp/Foo-1.0.gir.
const MINIMAL_GIR = `<?xml version="1.0"?>
<repository version="1.2"
  xmlns="http://www.gtk.org/introspection/core/1.0"
  xmlns:c="http://www.gtk.org/introspection/c/1.0"
  xmlns:glib="http://www.gtk.org/introspection/glib/1.0">
  <namespace name="Foo" version="1.0"
    c:identifier-prefixes="Foo"
    c:symbol-prefixes="foo">
    <record name="Greeter"
      c:type="FooGreeter"
      glib:type-name="FooGreeter"
      glib:get-type="foo_greeter_get_type">
      <method name="greet" c:identifier="foo_greeter_greet">
        <return-value transfer-ownership="none">
          <type name="utf8" c:type="const gchar*"/>
        </return-value>
      </method>
      <method name="get_count" c:identifier="foo_greeter_get_count">
        <return-value transfer-ownership="none">
          <type name="gint" c:type="gint"/>
        </return-value>
      </method>
    </record>
    <constant name="VERSION" c:identifier="FOO_VERSION" value="1">
      <type name="gint" c:type="gint"/>
    </constant>
  </namespace>
</repository>`;

const GIR_DIR = tmpdir();
writeFileSync(join(GIR_DIR, 'Foo-1.0.gir'), MINIMAL_GIR, 'utf8');

function makeConfig(outdir: string): OptionsGeneration {
    return {
        verbose: false,
        reporter: false,
        reporterOutput: '',
        root: tmpdir(),
        outdir,
        girDirectories: [GIR_DIR],
        noNamespace: false,
        noComments: true,
        promisify: false,
        npmScope: '@girs',
        workspace: false,
        noAdvancedVariants: false,
        onlyVersionPrefix: false,
        noPrettyPrint: true,
        package: false,
        externalDeps: false,
        allowMissingDeps: true,
    };
}

async function loadFooModule(config: OptionsGeneration): Promise<{ mod: GirModule; registry: NSRegistry }> {
    const registry = new NSRegistry();
    const dep = await DependencyManager.getInstance(config).get('Foo', '1.0');
    const mod = await GirModule.load(dep, config, registry);
    mod.parse();
    await mod.initTransitiveDependencies([]);
    return { mod, registry };
}

// TypeDoc initialises the TS compiler and runs the full .d.ts → reflection pipeline.
// Allow up to 2 minutes per test on GJS (SpiderMonkey startup + TypeScript analysis).
const TYPEDOC_TIMEOUT_MS = 120_000;

export default async () => {
    await describe('@ts-for-gir/generator-json — JsonDefinitionGenerator', async () => {
        await it('generates Foo-1.0.json in the output directory', async () => {
            const outdir = await mkdtemp(join(tmpdir(), 'ts4gir-json-'));
            const config = makeConfig(outdir);
            const { mod, registry } = await loadFooModule(config);

            const gen = new JsonDefinitionGenerator(config, registry);
            await gen.start();
            await gen.generate(mod);
            await gen.finish([mod]);

            const files = await readdir(outdir);
            expect(files.includes('Foo-1.0.json')).toBeTruthy();
        }, { timeout: TYPEDOC_TIMEOUT_MS });

        await it('generated Foo-1.0.json is parseable and has a name field', async () => {
            const outdir = await mkdtemp(join(tmpdir(), 'ts4gir-json-'));
            const config = makeConfig(outdir);
            const { mod, registry } = await loadFooModule(config);

            const gen = new JsonDefinitionGenerator(config, registry);
            await gen.start();
            await gen.generate(mod);
            await gen.finish([mod]);

            const raw = await readFile(join(outdir, 'Foo-1.0.json'), 'utf8');
            const json = JSON.parse(raw) as Record<string, unknown>;
            expect(typeof json.name).toBe('string');
        }, { timeout: TYPEDOC_TIMEOUT_MS });

        await it('generated Foo-1.0.json contains the Greeter symbol', async () => {
            const outdir = await mkdtemp(join(tmpdir(), 'ts4gir-json-'));
            const config = makeConfig(outdir);
            const { mod, registry } = await loadFooModule(config);

            const gen = new JsonDefinitionGenerator(config, registry);
            await gen.start();
            await gen.generate(mod);
            await gen.finish([mod]);

            const raw = await readFile(join(outdir, 'Foo-1.0.json'), 'utf8');
            expect(raw).toContain('Greeter');
        }, { timeout: TYPEDOC_TIMEOUT_MS });
    });

    // HTML generation uses TypeDoc's shiki syntax highlighter which requires
    // WebAssembly Promise APIs. GJS/SpiderMonkey 128 does not support WASM,
    // so HTML generation only works on Node. Tracked: STATUS.md "Open TODOs".
    await on('Node.js', async () => {
        await describe('@ts-for-gir/generator-html-doc — HtmlDocGenerator', async () => {
            await it('generates Foo-1.0/index.html in the output directory', async () => {
                const outdir = await mkdtemp(join(tmpdir(), 'ts4gir-html-'));
                const config = makeConfig(outdir);
                const { mod, registry } = await loadFooModule(config);

                const gen = new HtmlDocGenerator(config, registry);
                await gen.start();
                await gen.generate(mod);
                await gen.finish([mod]);

                const subdirs = await readdir(outdir);
                expect(subdirs.includes('Foo-1.0')).toBeTruthy();
                const htmlFiles = await readdir(join(outdir, 'Foo-1.0'));
                expect(htmlFiles.includes('index.html')).toBeTruthy();
            }, { timeout: TYPEDOC_TIMEOUT_MS });

            await it('generates classes/Foo.Greeter.html for the Greeter record', async () => {
                const outdir = await mkdtemp(join(tmpdir(), 'ts4gir-html-'));
                const config = makeConfig(outdir);
                const { mod, registry } = await loadFooModule(config);

                const gen = new HtmlDocGenerator(config, registry);
                await gen.start();
                await gen.generate(mod);
                await gen.finish([mod]);

                // TypeDoc places class docs in classes/<Namespace>.<Name>.html
                const classFiles = await readdir(join(outdir, 'Foo-1.0', 'classes'));
                expect(classFiles.some(f => f.includes('Greeter'))).toBeTruthy();
            }, { timeout: TYPEDOC_TIMEOUT_MS });
        });
    });
};
