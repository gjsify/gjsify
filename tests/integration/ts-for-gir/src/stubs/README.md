# Stub modules — GJS-only

These files are aliased into the `dist/cli.gjs.mjs` bundle in place of packages
that don't survive bundling on GJS due to eager dynamic-import enumeration.

## Active stubs

### `@inquirer/prompts` / `inquirer` → `inquirer-prompts.ts`

`@inquirer/prompts` re-exports a handful of prompt packages that each pull in
the same heavy core; bundling them blows up on GJS module-load due to the eager
dynamic-import enumeration. The stub throws a clear "stubbed on GJS" error at
the call site. Affects: interactive `create` command prompt flow and the
version-conflict resolver in `generate`/`json`/`doc`.

The Node bundle uses `--external @inquirer/prompts,inquirer` because Node's
runtime resolves them from `node_modules`.

## Previously stubbed (now removed — Phase 6)

### `typedoc`, `@ts-for-gir/generator-html-doc`, `@ts-for-gir/generator-json`

These were stubbed in Phase 4b because `typedoc` reads its own `package.json`
and locale/asset files via `import.meta.url`-relative paths at module-load
time. When bundled, `import.meta.url` resolved to the bundle file URL, causing
all relative FS paths to escape the package and crash.

**Phase 6 fix:** `esbuild-plugin-gjsify`'s `onLoad` hook now rewrites every
`import.meta.url` reference in `node_modules` files to the build-time-known
original file URL (analogous to Rollup's CJS-target `import.meta.url` polyfill).
At runtime, gjsify's GLib-backed `fs` polyfill reads `package.json`, locales,
and static assets directly from `node_modules`. The `@gjsify/module`
`createRequire` was also fixed to walk all ancestor `node_modules` directories
(Node.js resolution algorithm) instead of stopping at the nearest one.

The stubs were deleted in Phase 6. `ts-for-gir json` and `ts-for-gir doc` now
work natively on GJS.

Stubs live in-test (not as a separate workspace package) because they're
bound to one upstream pin (`@ts-for-gir/cli@4.0.0-rc.9`) and may need to
change shape with the next ts-for-gir release. Promote to a package only if
a second consumer needs them.
