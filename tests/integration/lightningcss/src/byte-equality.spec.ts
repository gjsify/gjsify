// Byte-equality across the lightningcss backends gjsify wires through
// cssAsStringPlugin.
//
// The Phase D-2 decision matrix (`docs/poc/lightningcss-decision.md`)
// rests on two load-bearing facts:
//   1. The native (FFI) and WASM tracks produce byte-identical output
//      for the same input (verified manually during the matrix work).
//   2. Both the native and WASM tracks match npm `lightningcss` so
//      cssAsStringPlugin can route between them transparently.
//
// This suite turns those one-off checks into permanent regression
// guards. The backend pair we compare is runtime-dependent:
//
//   GJS:  @gjsify/lightningcss-native  vs  @gjsify/lightningcss-wasm
//   Node: @gjsify/lightningcss-wasm    vs  npm `lightningcss`
//
// Together those two diffs cover all three backends. Each fixture is
// designed to exercise a different lowering / minification path so a
// drift in any one transform surfaces as a single failing assertion.
//
// Output is normalised before comparison: trailing whitespace stripped
// (some backends emit a trailing `\n`, some don't). Source maps are NOT
// part of the byte-equality contract — `mappings` strings encode source
// indexes that legitimately differ between backends. Code-only equality
// is what cssAsStringPlugin consumers (CSS-as-string default exports)
// observe.

import { describe, expect, it, on } from '@gjsify/unit';

interface Fixture {
  label: string;
  input: string;
  minify: boolean;
  /** Pre-resolved Targets bitfield for npm / WASM (`{ firefox: 60 << 16 }`). */
  targetsObj?: Record<string, number>;
  /** Equivalent browserslist query for the native bridge (`firefox >= 60`). */
  targetsQuery?: string;
}

interface BackendModule {
  name: string;
  transform(fx: Fixture): Uint8Array;
}

function normalise(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).replace(/\s+$/, '');
}

const FIXTURES: ReadonlyArray<Fixture> = [
  {
    label: 'plain selector + property — minified',
    input: '.foo { color: red; }',
    minify: true,
  },
  {
    label: 'redundant longhand collapses under minify',
    input: '.x { margin: 0 0 0 0; padding: 0 0; }',
    minify: true,
  },
  {
    label: 'nesting flatten for firefox60',
    input: '.btn { color: red; & .icon { padding: 4px; } &:hover { color: blue; } }',
    minify: true,
    targetsObj: { firefox: 60 << 16 },
    targetsQuery: 'firefox >= 60',
  },
  {
    label: 'lch color lowered for firefox60',
    input: '.x { color: lch(50% 100 30); }',
    minify: true,
    targetsObj: { firefox: 60 << 16 },
    targetsQuery: 'firefox >= 60',
  },
  {
    label: 'pretty-printed (no minify)',
    input: '.foo { color: red; }',
    minify: false,
  },
  {
    label: 'nested at-rule inside selector — flattened for firefox60',
    input: '.card { @media (min-width: 600px) { padding: 16px; } padding: 8px; }',
    minify: true,
    targetsObj: { firefox: 60 << 16 },
    targetsQuery: 'firefox >= 60',
  },
];

async function loadGjsBackends(): Promise<[BackendModule, BackendModule]> {
  const native = await import('@gjsify/lightningcss-native');
  if (!native.hasNativeLightningcss()) {
    throw new Error('integration-lightningcss: @gjsify/lightningcss-native prebuild not loadable on this arch');
  }
  const wasm = await import('@gjsify/lightningcss-wasm');
  await wasm.default();

  return [
    {
      name: '@gjsify/lightningcss-native',
      transform: ({ input, minify, targetsQuery }) =>
        native.transform({
          filename: 'fixture.css',
          code: input,
          minify,
          targets: targetsQuery,
        }).code,
    },
    {
      name: '@gjsify/lightningcss-wasm',
      transform: ({ input, minify, targetsObj }) =>
        wasm.transform({
          filename: 'fixture.css',
          code: new TextEncoder().encode(input),
          minify,
          targets: targetsObj,
        }).code,
    },
  ];
}

async function loadNodeBackends(): Promise<[BackendModule, BackendModule]> {
  const wasm = await import('@gjsify/lightningcss-wasm');
  await wasm.default();
  const npm = await import('lightningcss');

  return [
    {
      name: '@gjsify/lightningcss-wasm',
      transform: ({ input, minify, targetsObj }) =>
        wasm.transform({
          filename: 'fixture.css',
          code: new TextEncoder().encode(input),
          minify,
          targets: targetsObj,
        }).code,
    },
    {
      name: 'npm lightningcss',
      transform: ({ input, minify, targetsObj }) =>
        npm.transform({
          filename: 'fixture.css',
          code: new TextEncoder().encode(input),
          minify,
          targets: targetsObj,
        }).code,
    },
  ];
}

export default async () => {
  await on('Gjs', async () => {
    await describe('lightningcss byte-equality (native vs wasm) — GJS', async () => {
      const [a, b] = await loadGjsBackends();

      for (const fx of FIXTURES) {
        await it(`${fx.label}`, async () => {
          const ao = normalise(a.transform(fx));
          const bo = normalise(b.transform(fx));
          expect(ao).toBe(bo);
        });
      }
    });
  });

  await on('Node.js', async () => {
    await describe('lightningcss byte-equality (wasm vs npm) — Node', async () => {
      const [a, b] = await loadNodeBackends();

      for (const fx of FIXTURES) {
        await it(`${fx.label}`, async () => {
          const ao = normalise(a.transform(fx));
          const bo = normalise(b.transform(fx));
          expect(ao).toBe(bo);
        });
      }
    });
  });
};
