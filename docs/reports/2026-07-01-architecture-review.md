# Architecture review 2026-07-01 — findings + backlog

Condensed record of the cross-workspace architecture review (gjsify, easy6502,
pixel-rpg/map-editor, ts-for-gir, node-gi) that produced ADRs 0001–0008
([docs/adr/](../adr/README.md)). This file is the *why + priority* record; the ADRs
are the decisions; `status/open-todos.md` tracks the remaining work.

## Verdict

The core concept holds: share what fits (logic, controllers, metadata, assets),
duplicate where platforms genuinely diverge (widgets), and declare per-package
runtime reach instead of pretending universality. The four pillars are cleanly
layered (max dep depth 4–5, no cycles, `@gjsify/utils` as the single GLib/GObject
foundation), and the dual-runtime + integration-test discipline is what makes ~112
packages maintainable at this team size. The main risks are not conceptual but
surface-area risks: the self-built package manager as a daily dev tool, multi-MB
committed bundles, the tripled Adwaita widget set, and unbounded axis growth.

## What is well solved (keep, don't churn)

1. **Four-pillar layering + runtime-slot model** — `runtimes: {gjs,node,browser,
   nativescript}` per package; honest declared reach, enforced by the alias layer.
2. **The bridge architecture** (`Canvas2DBridge`→DrawingArea, `WebGLBridge`→GLArea,
   `VideoBridge`→Picture, `IFrameBridge`→WebView, event-bridge) — proven by
   map-editor running unmodified Excalibur.js in-process in GTK4; the consumer audit
   found zero copy-paste polyfills or pin hacks there.
3. **Globals injection on post-tree-shake bundle output** (iterative acorn analysis
   + committed register-closure map) — the load-bearing invariant; do not regress to
   source scanning.
4. **Sharing altitude** — easy6502: core 100 % shared, common-ui shared GTK+Android,
   design identity unified at metadata/asset level with 3-renderer screenshot parity.
5. **Testing as scale substitute** — dual-runtime specs, curated upstream
   integration suites, Autobahn fuzzing, Playwright browser axis, affected-only CI.
6. **Optional native bridges with graceful degradation** (terminal/tls/sab/webrtc).

## What to reconsider → decisions

| # | Finding | Decision | Priority |
|---|---|---|---|
| 1 | `gjsify install` incidents (artifact deletion history, concurrent-install hang, first-match dedup) — invariant never stated as policy | [ADR 0001](../adr/0001-install-clean-separation.md) non-destructive install + e2e guard + lock + dedup | **P1** |
| 2 | ~10 MB committed bundles; staleness = top failure source in parallel PR pipelines | [ADR 0002](../adr/0002-bootstrap-bundle-minimization.md) minimal bootstrap bundle, full CLI/tsc from registry | **P1** |
| 3 | 112 packages / many axes, no declared support levels; experiments ossify into obligations | [ADR 0003](../adr/0003-package-tiering.md) Tier 1/2/3 + dependency-direction audit + promotion gates | **P1** |
| 4 | Adwaita behavior implemented 2× (web + NS); fixes cost double, divergence caught late | [ADR 0004](../adr/0004-headless-adwaita-core.md) `@gjsify/adwaita-core`, storybook-core pattern, opportunistic migration | P2 |
| 5 | node-gi could silently double the matrix if it becomes first-class | [ADR 0005](../adr/0005-node-gi-scope.md) experimental tier, dependency isolation, graduation gate | P2 (mostly codification) |
| 6 | ~27 min CI build — Rolldown re-bundles every package every run | [ADR 0006](../adr/0006-per-package-build-artifacts.md) CLI-owned content-hash build cache; source-direct spike | **P1** (phase 1) |
| 7 | easy6502 app-web re-implements the UI; "web is different" never actually tested against adwaita-web | [ADR 0007](../adr/0007-web-pillar-common-ui.md) bounded DebuggerView spike in app-web | P3 |
| 8 | Release-train compatibility is implicit; mixed-version consumers untested | [ADR 0008](../adr/0008-release-versioning-policy.md) framework-style versioning stated as policy; `@girs/*` caret after ts-for-gir #432 | P2 (docs-cheap) |

## Suggested execution order

1. **ADR 0001 step 1** (`tests/e2e/install-non-destructive`) — small, immediately
   closes the worst failure class. Then the install file-lock.
2. **ADR 0006 phase 1** (build cache) — biggest CI-time ROI; independent of the rest.
3. **ADR 0003** (tier declarations + audit) — one mechanical PR + audit extension;
   unblocks the ADR-0005 isolation check.
4. **ADR 0002** (bootstrap bundle) — after 0006's cache exists (the bootstrap e2e
   benefits from it); the highest-payoff structural change, land carefully behind
   its fresh-clone e2e.
5. **ADR 0008** (policy docs) — cheap, anytime; `@girs/*` relaxation waits on
   ts-for-gir #432.
6. **ADR 0004 seed** (breakpoint + color-scheme move) — first core extraction,
   low-risk re-export.
7. **ADR 0007 spike** (easy6502) — when app-web is next touched.
8. **ADR 0005** — codification lands with 0003; engine work continues on its own
   roadmap.

## Cross-repo notes

- ADR 0007's work item lives in easy6502; ADR 0008's `@girs/*` step depends on
  ts-for-gir (#432). Gitlink bumps at the workspace level follow the usual rules.
- map-editor needs nothing from this review (healthiest consumer signal in the
  audit); ts-for-gir's version-scheme fix was already in flight before the review.
