// SPDX-License-Identifier: MIT
// New tests for @ts-for-gir/lib (GirModule pipeline) and @ts-for-gir/generator-typescript
// (TypeScript declaration generator).  Upstream has no programmatic pipeline unit tests.
//
// Phase 3 of the ts-for-gir integration suite — exercises:
//   @ts-for-gir/lib: DependencyManager · GirModule.load · GirModule.parse
//                    IntrospectedRecord · IntrospectedFunction
//   @ts-for-gir/generator-typescript: ModuleGenerator.generateModule
//   npm deps on GJS: glob (findFilesInDirs) · ejs (TemplateEngine, loaded but not rendered)
//
// Strategy: write a minimal GIR file to /tmp so DependencyManager.get() can find it
// via the real glob+fs pipeline.  The GIR uses a <record> (no parent type) to avoid
// needing GObject-2.0 for class-parent resolution.  No <include> deps so
// initDependencies() is a no-op for the primary module.
// initTransitiveDependencies([]) is still called before ModuleGenerator because
// GirModule.transitiveDependencies throws if uninitialised — with empty girDirectories
// DependencyManager returns a stub for GObject-2.0 which is enough for generateModule()
// since that code path never renders EJS templates.

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from '@gjsify/unit';
import {
  DependencyManager,
  GirModule,
  NSRegistry,
  IntrospectedRecord,
  type OptionsGeneration,
} from '@ts-for-gir/lib';
import { ModuleGenerator } from '@ts-for-gir/generator-typescript';

// Minimal GIR: one record with two methods and one constant, no <include> deps.
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

// Write the GIR to /tmp once at module load time so all tests share it.
const GIR_DIR = tmpdir();
const GIR_PATH = join(GIR_DIR, 'Foo-1.0.gir');
writeFileSync(GIR_PATH, MINIMAL_GIR, 'utf8');

const config: OptionsGeneration = {
  verbose: false,
  reporter: false,
  reporterOutput: '',
  root: '/tmp',
  outdir: null,
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

// Shared pipeline state; populated in setup() before tests run.
let registry: NSRegistry;
let girModule: GirModule;

async function setup() {
  registry = new NSRegistry();
  const dep = await DependencyManager.getInstance(config).get('Foo', '1.0');
  girModule = await GirModule.load(dep, config, registry);
}

export default async () => {
  await setup();

  await describe('@ts-for-gir/lib — DependencyManager.get(namespace, version)', async () => {
    await it('creates a Dependency for Foo-1.0 from the GIR file', async () => {
      const dep = await DependencyManager.getInstance(config).get('Foo', '1.0');
      expect(dep).toBeDefined();
      expect(dep.namespace).toBe('Foo');
      expect(dep.version).toBe('1.0');
      expect(dep.packageName).toBe('Foo-1.0');
    });

    await it('Dependency carries the parsed GirXML', async () => {
      const dep = await DependencyManager.getInstance(config).get('Foo', '1.0');
      expect(dep.girXML).toBeDefined();
      expect(Array.isArray(dep.girXML!.repository)).toBeTruthy();
    });
  });

  await describe('@ts-for-gir/lib — GirModule.load()', async () => {
    await it('returns a GirModule with correct namespace and version', async () => {
      expect(girModule.namespace).toBe('Foo');
      expect(girModule.version).toBe('1.0');
      expect(girModule.packageName).toBe('Foo-1.0');
    });

    await it('registers itself in the NSRegistry', async () => {
      const ns = registry.mapping.get('Foo', '1.0');
      expect(ns).toBeDefined();
      expect(ns!.namespace).toBe('Foo');
    });

    await it('members map is empty before parse()', async () => {
      const freshReg = new NSRegistry();
      const dep = await DependencyManager.getInstance(config).get('Foo', '1.0');
      const fresh = await GirModule.load(dep, config, freshReg);
      expect(fresh.members.size).toBe(0);
    });
  });

  await describe('@ts-for-gir/lib — GirModule.parse()', async () => {
    await it('populates members after parse()', async () => {
      girModule.parse();
      expect(girModule.members.size > 0).toBeTruthy();
    });

    await it('finds the Greeter record in members', async () => {
      const greeter = girModule.members.get('Greeter');
      expect(greeter).toBeDefined();
      expect(greeter instanceof IntrospectedRecord).toBeTruthy();
    });

    await it('Greeter has the greet method', async () => {
      const greeter = girModule.members.get('Greeter') as IntrospectedRecord;
      const greet = greeter.members.find((m: any) => m.name === 'greet');
      expect(greet).toBeDefined();
    });

    await it('Greeter has the get_count method', async () => {
      const greeter = girModule.members.get('Greeter') as IntrospectedRecord;
      const getCount = greeter.members.find((m: any) => m.name === 'get_count');
      expect(getCount).toBeDefined();
    });

    await it('VERSION constant is present in members', async () => {
      const version = girModule.members.get('VERSION');
      expect(version).toBeDefined();
    });
  });

  await describe('@ts-for-gir/generator-typescript — ModuleGenerator.generateModule()', async () => {
    await it('generates non-empty TypeScript output', async () => {
      await girModule.initTransitiveDependencies([]);
      const generator = new ModuleGenerator(girModule, config, registry);
      const output = await generator.generateModule(girModule);
      expect(Array.isArray(output)).toBeTruthy();
      expect(output.length > 0).toBeTruthy();
    });

    await it('output contains the Greeter name', async () => {
      await girModule.initTransitiveDependencies([]);
      const generator = new ModuleGenerator(girModule, config, registry);
      const output = await generator.generateModule(girModule);
      const joined = output.join('\n');
      expect(joined).toContain('Greeter');
    });

    await it('output contains the greet method', async () => {
      await girModule.initTransitiveDependencies([]);
      const generator = new ModuleGenerator(girModule, config, registry);
      const output = await generator.generateModule(girModule);
      const joined = output.join('\n');
      expect(joined).toContain('greet');
    });

    await it('output contains the VERSION constant', async () => {
      await girModule.initTransitiveDependencies([]);
      const generator = new ModuleGenerator(girModule, config, registry);
      const output = await generator.generateModule(girModule);
      const joined = output.join('\n');
      expect(joined).toContain('VERSION');
    });
  });
};
