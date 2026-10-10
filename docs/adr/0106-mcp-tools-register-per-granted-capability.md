# 106. MCP write tools register per granted capability, and the gate that registers them checks the call

- Status: **Accepted** (2026-10-10)
- Date: 2026-10-10
- Deciders: Pascal Garber
- Related: `packages/framework/mcp/src/read-only-gate.ts`; the first consumer is Curlew's ADR 0004
  (sending and writing, granted per capability), whose § 3 fixes the decision below

## Context

`@gjsify/mcp` ships `applyReadOnlyGate(server, allowWrite)`: default-deny on
`annotations.readOnlyHint === true`. It is a published contract with two states, all writes or none.
An app that permits one write to one target (a send to one address, an event in one calendar) has no
way to say so: it must open every write tool, or write the check into each tool by hand. A forgotten
hand-written check is the one failure that looks exactly like a working gate.

## Decision

1. **`applyReadOnlyGate` stays byte-for-byte as it is.** The new gate is an addition, not a change.
2. **`applyGrantGate(server, grants)`** takes the app's grant set, `{ capability, target }[]`. A grant
   names exactly one target. An empty capability or target throws at call time of `applyGrantGate`.
   gjsify holds no capability names and no registry; match is exact string equality, no wildcards,
   no prefixes.
3. **Registration.** A tool registers if `readOnlyHint === true`, or if it declared a capability and
   at least one grant for that capability exists. No annotations, `readOnlyHint: false` without a
   capability, or an ungranted capability: dropped, so the failure is a tool missing from `tools/list`.
4. **The call check lives in the registering wrapper.** For a capability tool the wrapper registers a
   handler that first computes `targetOf(args)` and reaches the real handler only on an exact grant
   match. Otherwise it returns an MCP error naming the capability. A `targetOf` that throws, or returns
   a non-string or empty value, is a refusal. There is no registration path without the check.
5. **Declaration is `requiresCapability(config, { capability, targetOf })`**, which returns the same
   config object. The spec is kept in a module-private `WeakMap` keyed by that object, not in `_meta`:
   `_meta` is sent to clients in `tools/list` and cannot carry a function, and a field on the SDK's
   config type would couple us to its schema. A tool with a capability and `readOnlyHint: true`
   registers regardless of grants but its call is still checked.
6. **The grant set is copied when the gate is applied.** Later edits to the caller's array do not apply.

## Consequences

- Apps get per-capability writes without a second gate-shaped mechanism of their own.
- The SDK's tool handler receives `(args, extra)` when an `inputSchema` exists and `(extra)` otherwise;
  without an `inputSchema`, `targetOf` sees `{}`, so such a tool is always refused. A target must come
  from validated input.
- A tool registered through a server the gate never wrapped is not covered; as with
  `applyReadOnlyGate`, call it before any `registerTool`.

## Alternatives rejected

- **Extend `applyReadOnlyGate` with an optional grant argument.** It would change a published
  signature and blur a two-state gate that is easy to audit.
- **The capability in `_meta`.** Visible to clients, cannot hold `targetOf`, so the check would stay
  in the tool.
- **A central capability registry in gjsify.** Every app would need a gjsify release to add a name.

## Implementation

`packages/framework/mcp/src/grant-gate.ts`, tests in `mcp.spec.ts`, README and
`packages/framework/AGENTS.md` updated in the implementing commit.
