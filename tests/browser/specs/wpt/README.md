# WPT Runner

Web Platform Tests (refs/wpt/) require a dedicated WPT-compatible server (`wptserve`) to run
correctly — tests reference internal paths like `/resources/testharness.js` that depend on the
server's own directory layout.

This directory is reserved for Playwright specs that drive selected WPT tests once the WPT server
infrastructure is added.

**Status:** Planned for a follow-up PR.

## Planned tests

- `fetch.spec.ts` → refs/wpt/fetch/api/ (headers, basic, request-constructor)
- `streams.spec.ts` → refs/wpt/streams/ (queuing-strategies, readable-streams)
- `websocket.spec.ts` → refs/wpt/websockets/ (basic-auth, binary)
