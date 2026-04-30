# Phase 4b stub modules — GJS-only

These files are aliased into the `dist/cli.gjs.mjs` bundle in place of heavy
runtime-resolved npm packages that don't survive bundling on GJS. Three
patterns make these packages bundle-hostile:

1. **Eager `import.meta.url`-based filesystem reads.** `typedoc` and `prettier`
   read their own `package.json` at module-load time via
   `Path.join(fileURLToPath(import.meta.url), '../../../package.json')`. When
   bundled, `import.meta.url` resolves to the bundle file, so the relative
   path escapes the package and crashes. Marking them `--external` works on
   Node (real `node_modules` resolution) but not on GJS (`gjsify run` has no
   bare-specifier resolver yet).
2. **Eager dynamic-import enumeration.** `@inquirer/prompts` re-exports a
   handful of prompt packages that each pull in the same heavy core; bundling
   them blows up on GJS module-load.
3. **Plugin auto-discovery via dynamic `import()`.** `prettier`'s plugin
   loader walks the filesystem at start-up.

The Node bundle uses `--external typedoc,prettier,@inquirer/prompts,inquirer`
because Node's runtime resolves them from `node_modules`. The GJS bundle
swaps in the stubs in this directory via `--alias`. Result: the GJS bundle
loads cleanly and every CLI command that does NOT execute the stubbed
package's runtime code works (`--version`, `--help`, `list`, `copy`).
Commands that DO depend on the stubbed code (`doc`, the `select`/`input`
prompts inside `create` and the version-conflict resolver) fail at the
exact call site with a clear "stubbed on GJS" error.

Stubs live in-test (not as a separate workspace package) because they're
bound to one upstream pin (`@ts-for-gir/cli@4.0.0-rc.6`) and may need to
change shape with the next ts-for-gir release. Promote to a package only if
a second consumer needs them.
