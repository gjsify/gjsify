// One-line banner that captures the bundle's own module URL into a global,
// read by the module-resolve shim (shims/module-resolve.ts) as its
// `createRequire` anchor.
//
// It must run at the top of the entry chunk — the single point where
// `import.meta.url` is unambiguously the bundle's own URL, BEFORE the
// node-modules path rewriter (rewrite-node-modules-paths.ts) could have
// rewritten any per-module `import.meta.url`. `??=` keeps it idempotent and
// cheap (a second entry in the same realm is a no-op).
//
// ESM-only — uses `import.meta.url`. Orchestrators gate its inclusion on
// `format === 'esm'`, matching the `runtimeResolve` gate on the rewriter.

export const BUNDLE_URL_BANNER = 'globalThis.__gjsifyBundleUrl??=import.meta.url;';
