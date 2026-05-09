#!/usr/bin/env node
// Builds a small predictable directory tree under ./fixtures/ for the
// pkg-types + get-tsconfig integration suite. Both packages read package.json
// and tsconfig.json files from the filesystem; we set up our own deterministic
// layout so the suite is hermetic and platform-agnostic.
//
// Layout produced:
//   fixtures/
//     proj1/
//       package.json
//       tsconfig.json                # extends ./tsconfig.base.json + paths
//       tsconfig.base.json
//       src/
//         index.ts                   # marker file for findUp / findNearestFile
//         nested/
//           deep.ts                  # used as searchPath start
//     proj2/
//       package.json
//       tsconfig.json                # extends chain across two files
//       configs/
//         tsconfig.shared.json
//         tsconfig.strict.json       # extends ./tsconfig.shared.json
//     write-target/
//       package.json                 # mutable target for round-trip tests

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dest = join(__dirname, '..', 'fixtures');

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });

// ------------------------------------------------------------- proj1
const proj1 = join(dest, 'proj1');
await mkdir(join(proj1, 'src', 'nested'), { recursive: true });

await writeFile(
  join(proj1, 'package.json'),
  JSON.stringify(
    {
      name: 'proj1',
      version: '1.2.3',
      description: 'Test fixture for pkg-types/get-tsconfig integration',
      type: 'module',
      main: './src/index.ts',
      author: 'gjsify integration suite',
      license: 'MIT',
      scripts: {
        build: 'tsc',
        test: 'echo no tests',
      },
      dependencies: {
        'left-pad': '1.3.0',
      },
      devDependencies: {
        typescript: '^6.0.0',
      },
    },
    null,
    2,
  ) + '\n',
);

await writeFile(
  join(proj1, 'tsconfig.base.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'es2022',
        module: 'esnext',
        strict: true,
        esModuleInterop: true,
      },
    },
    null,
    2,
  ) + '\n',
);

await writeFile(
  join(proj1, 'tsconfig.json'),
  JSON.stringify(
    {
      extends: './tsconfig.base.json',
      compilerOptions: {
        outDir: 'dist',
        baseUrl: '.',
        paths: {
          '@app/*': ['src/*'],
          '@nested/*': ['src/nested/*'],
        },
      },
      include: ['src/**/*'],
      exclude: ['dist'],
    },
    null,
    2,
  ) + '\n',
);

await writeFile(join(proj1, 'src', 'index.ts'), 'export const proj1 = 1;\n');
await writeFile(join(proj1, 'src', 'nested', 'deep.ts'), 'export const deep = 1;\n');

// ------------------------------------------------------------- proj2
const proj2 = join(dest, 'proj2');
await mkdir(join(proj2, 'configs'), { recursive: true });

await writeFile(
  join(proj2, 'package.json'),
  JSON.stringify(
    {
      name: 'proj2',
      version: '0.0.1',
      private: true,
    },
    null,
    2,
  ) + '\n',
);

await writeFile(
  join(proj2, 'configs', 'tsconfig.shared.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'es2020',
        module: 'commonjs',
      },
    },
    null,
    2,
  ) + '\n',
);

await writeFile(
  join(proj2, 'configs', 'tsconfig.strict.json'),
  JSON.stringify(
    {
      extends: './tsconfig.shared.json',
      compilerOptions: {
        strict: true,
        noImplicitAny: true,
      },
    },
    null,
    2,
  ) + '\n',
);

await writeFile(
  join(proj2, 'tsconfig.json'),
  JSON.stringify(
    {
      extends: './configs/tsconfig.strict.json',
      compilerOptions: {
        declaration: true,
      },
    },
    null,
    2,
  ) + '\n',
);

// ------------------------------------------------------------- write-target
const writeTarget = join(dest, 'write-target');
await mkdir(writeTarget, { recursive: true });

await writeFile(
  join(writeTarget, 'package.json'),
  JSON.stringify(
    {
      name: 'write-target',
      version: '0.0.0',
    },
    null,
    2,
  ) + '\n',
);

console.log(`[setup-fixtures] wrote tree -> ${dest}`);
