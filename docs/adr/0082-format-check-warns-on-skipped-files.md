# 82. `gjsify format --check` warns about files skipped by oxfmt-native

- Status: **Accepted**
- Date: 2026-09-27

## Context

When running under GJS with `@gjsify/oxfmt-native`, files requiring Prettier's
ExternalFormatter (HTML, Vue, Svelte, Markdown, MDX, YAML, Handlebars, MJML,
Angular templates) are silently skipped by the native bridge. This caused
`gjsify format --check` to pass locally on GJS but fail in CI (Node), creating
a "green check that checked nothing" class of bug.

## Decision

In `--check` mode under GJS with native oxfmt, the formatter now:

1. Scans target paths for ExternalFormatter files (HTML, Vue, Svelte, Markdown,
   MDX, YAML, Handlebars, MJML, Angular templates)
2. Emits a clear warning listing skipped files grouped by parser
3. Advises running `npx oxfmt --check` on Node or using `GJSIFY_OXFMT=npm`

The check still exits 0 (the limitation itself is fine — oxfmt-native doesn't
support these file types by design). The warning prevents false confidence.

## Consequences

- Users on GJS see actionable feedback instead of silent skips
- CI/CD pipelines can detect the warning if needed
- The `GJSIFY_OXFMT=npm` escape hatch remains for users who want full parity

## References

- Fixes #1807
- Implementation: `packages/infra/cli/src/utils/oxc-resolve.ts` (`findExternalFormatterFiles`)
- Implementation: `packages/infra/cli/src/commands/format.ts` (warning emission)

