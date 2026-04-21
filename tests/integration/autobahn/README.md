# @gjsify/integration-autobahn

RFC 6455 WebSocket compliance tests for:

1. `@gjsify/websocket` — the W3C `WebSocket` class backed by
   `Soup.WebsocketConnection`
2. `@gjsify/ws` — the `ws` npm package wrapper built on top of (1)

Both are exercised by the [crossbario/autobahn-testsuite][autobahn]
fuzzingserver running in Docker. The fuzzer probes dozens of protocol
edge cases (fragmentation, control frames interleaved with data, invalid
UTF-8, oversized payloads, reserved bits, close-code handling, …) and
records a pass/fail/non-strict outcome per case.

[autobahn]: https://github.com/crossbario/autobahn-testsuite

## Why two drivers?

`@gjsify/ws` is a wrapper around `@gjsify/websocket`. If a case fails in
the ws driver but passes in the websocket driver, the bug is in the
wrapper layer (event conversion, binary-type handling, close-reason
encoding). If both fail, the bug is deeper — in our Soup integration or
in Soup itself.

## Running locally

```sh
# One-off: start Autobahn, run both drivers, validate against baseline,
# stop Autobahn.
yarn test

# Or individually:
yarn test:websocket   # @gjsify/websocket only
yarn test:ws          # @gjsify/ws only

# Open the generated HTML report:
xdg-open reports/output/clients/index.html
```

Requirements: **Podman or Docker** (for the Autobahn container), Gjs
(for the drivers), Node.js (for orchestration scripts).

`scripts/compose.mjs` auto-detects which container runtime is available
and prefers Podman (Fedora default). Override with:

```sh
CONTAINER_RUNTIME=docker yarn autobahn:up
```

## Baseline

`reports/baseline/<agent>.json` captures the expected outcome per case.
After a run, `scripts/validate-reports.mjs` compares the latest run
against the baseline and flags:

- **Regressions** — case used to pass, now fails (build fails)
- **Improvements** — case used to fail, now passes (build passes, prints
  hint to refresh the baseline)
- **Missing cases** — baseline expected a case the driver didn't run
  (build fails)

To accept an improvement as the new baseline:

```sh
cp reports/output/clients/index.json reports/baseline/gjsify-websocket.json
```

or commit only the relevant agent's section if a single library changed.

## Excluded cases

`config/fuzzingserver.json` currently excludes:

- **9.\*** — performance tests (large payloads, rapid-fire messages).
  These take 30+ minutes per run and probe throughput, not compliance.
  Revisit in a separate perf-focused PR.
- **12.\*, 13.\*** — permessage-deflate extension tests. Soup's deflate
  handling is a separate validation axis; excluding keeps this PR's
  baseline focused on core protocol.

Enable them by deleting entries from `exclude-cases` and refreshing the
baseline.

## Not wired into CI yet

Docker-in-Docker on our Fedora CI containers needs configuration before
this suite can run in GitHub Actions. Manual run + baseline commit is
the Phase 1 workflow. See STATUS.md → *Integration Test Coverage* for
rollout plan.
