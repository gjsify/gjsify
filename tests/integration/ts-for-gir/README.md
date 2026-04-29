# `@gjsify/integration-ts-for-gir`

Integration tests for [`ts-for-gir`](https://github.com/gjsify/ts-for-gir) on GJS.

## Goal

`ts-for-gir` must run unmodified on GJS. ts-for-gir publishes ~10 npm packages
(`@gi.ts/parser`, `@ts-for-gir/lib`, `@ts-for-gir/cli`, generators, language
server, reporter). This suite progressively validates them against the
`@gjsify/*` Node API polyfills.

## Phase 1: `@gi.ts/parser`

The smallest, most isolated package — one runtime dep (`fast-xml-parser`),
pure-function API: `parser.parseGir(xml: string): GirXML`.

Fixtures (`girs/`) are gjsify's own Vala-generated GIRs:

| File | Source package | Coverage |
|---|---|---|
| `Gwebgl-0.1.gir` | `@gjsify/webgl` | 3 classes, 259 methods, 20 properties, 1 enum |
| `GjsifyWebrtc-0.1.gir` | `@gjsify/webrtc-native` | 4 classes, 11 methods, 5 properties, 19 signals |
| `GjsifyHttpSoupBridge-1.0.gir` | `@gjsify/http-soup-bridge` | 3 classes, 30 methods, 15 properties, 7 signals |

Real-world parser surface — exercises enums, properties, signals, and
multi-namespace `<include>` deps without coupling to any upstream test fixture.

## Running

```bash
# From this directory:
yarn test           # node + gjs
yarn test:node
yarn test:gjs

# Or from the repo root:
yarn workspace @gjsify/integration-ts-for-gir test
```

## Out of scope (tracked in `STATUS.md` Open TODOs)

- `@ts-for-gir/lib` — `TypeExpression`, `TypeIdentifier`, `TupleType`, ...
- Generator pipeline (real GIR → `.d.ts` snapshot)
- CLI tarball end-to-end (depends on `yargs`/`inquirer`/`prettier` GJS readiness)
- Language-server vitest port (depends on `typescript` package on GJS)
