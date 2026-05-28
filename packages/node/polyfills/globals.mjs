/**
 * Meta package — `@gjsify/node-polyfills` is a dep-only umbrella that pulls
 * in every Node polyfill. It has no own value exports, so the `node` slot's
 * `globals.mjs` re-export is intentionally empty. Present only to silence
 * the resolver's "missing globals.mjs" warn-once when --app node bundles
 * happen to mention the bare specifier.
 */
export {};
