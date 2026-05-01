# Phase 4b stub modules — GJS-only

These files are aliased into the `dist/cli.gjs.mjs` bundle in place of heavy
runtime-resolved npm packages that don't survive bundling on GJS. Two
patterns make these packages bundle-hostile:

1. **Eager `import.meta.url`-based filesystem reads.** `typedoc` reads its
   own `package.json` at module-load time via
   `Path.join(fileURLToPath(import.meta.url), '../../../package.json')`. When
   bundled, `import.meta.url` resolves to the bundle file, so the relative
   path escapes the package and crashes. Marking it `--external` works on
   Node (real `node_modules` resolution) but not on GJS (`gjsify run` has no
   bare-specifier resolver yet).
2. **Eager dynamic-import enumeration.** `@inquirer/prompts` re-exports a
   handful of prompt packages that each pull in the same heavy core; bundling
   them blows up on GJS module-load.

The Node bundle uses `--external typedoc,@inquirer/prompts,inquirer` because
Node's runtime resolves them from `node_modules`. The GJS bundle swaps in
the stubs in this directory via `--alias`. Result: the GJS bundle loads
cleanly and every CLI command that does NOT execute the stubbed package's
runtime code works (`--version`, `--help`, `list`, `copy`, `generate`).
Commands that DO depend on the stubbed code (`doc`, the `select`/`input`
prompts inside `create` and the version-conflict resolver) fail at the exact
call site with a clear "stubbed on GJS" error.

`prettier` was historically in this list because `@ts-for-gir/cli` round-tripped
generated `.d.ts` files through Prettier. As of `@ts-for-gir/cli@4.0.0-rc.8`
the templates emit the desired shape directly and Prettier is no longer
imported, so the stub was removed.

Stubs live in-test (not as a separate workspace package) because they're
bound to one upstream pin (`@ts-for-gir/cli@4.0.0-rc.8`) and may need to
change shape with the next ts-for-gir release. Promote to a package only if
a second consumer needs them.
