# AGENTS.md — `packages/infra/*` (build, CLI, resolver)

> Scope: this directory tree. Repo-wide rules live in the [root AGENTS.md](../../AGENTS.md) — read that first.

The three packages that carry their own rules:

| Package | Owns | Rules |
|---|---|---|
| `cli/` | `gjsify <cmd>`, install invariants, the committed `dist/*.gjs.mjs` bootstrap bundles | [cli/AGENTS.md](cli/AGENTS.md) |
| `rolldown-plugin-gjsify/` | the `--app <target>` build orchestrators + platform plugins | [rolldown-plugin-gjsify/AGENTS.md](rolldown-plugin-gjsify/AGENTS.md) |
| `resolve-npm/` | slot routing — how `--app <target>` resolves `@gjsify/<X>` | [resolve-npm/AGENTS.md](resolve-npm/AGENTS.md) |

`blueprint/` + `vite-plugin-blueprint/`: the parser/emitter (ADR 0053, no build step) and the
plugin every `--app` target loads a `.blp` through. A `.blp`'s exports are DERIVED from its AST,
never transcribed, and their types travel in a COMMITTED `x.d.blp.ts` sidecar beside the file —
written by the plugin or `gjsify blueprint types`, held by `scripts/check-blueprint-sidecars.mjs`.
What each export is, and why: [ADR 0088](../../docs/adr/0088-a-blp-exports-its-ids-as-typed-names.md).

`manifest-conformance/` is the ONE registry of "does this declaration match reality" rules —
plain committed `lib/*.mjs`, no build. Adding a `gjsify.*` manifest key without a rule fails
`field-coverage`; see the root AGENTS.md § Governance.

Committed-bundle freshness (why a green build is not evidence) is
[docs/build-artifacts.md](../../docs/build-artifacts.md); lint/format config is
[docs/lint-format.md](../../docs/lint-format.md).


