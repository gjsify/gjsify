# AGENTS.md — `packages/infra/*` (build, CLI, resolver)

> Scope: this directory tree. Repo-wide rules live in the [root AGENTS.md](../../AGENTS.md) — read that first.

The three packages that carry their own rules:

| Package | Owns | Rules |
|---|---|---|
| `cli/` | `gjsify <cmd>`, install invariants, the committed `dist/*.gjs.mjs` bootstrap bundles | [cli/AGENTS.md](cli/AGENTS.md) |
| `rolldown-plugin-gjsify/` | the `--app <target>` build orchestrators + platform plugins | [rolldown-plugin-gjsify/AGENTS.md](rolldown-plugin-gjsify/AGENTS.md) |
| `resolve-npm/` | slot routing — how `--app <target>` resolves `@gjsify/<X>` | [resolve-npm/AGENTS.md](resolve-npm/AGENTS.md) |

`manifest-conformance/` is the ONE registry of "does this declaration match reality" rules —
plain committed `lib/*.mjs`, no build. Adding a `gjsify.*` manifest key without a rule fails
`field-coverage`; see the root AGENTS.md § Governance.

Committed-bundle freshness (why a green build is not evidence) is
[docs/build-artifacts.md](../../docs/build-artifacts.md); lint/format config is
[docs/lint-format.md](../../docs/lint-format.md).


