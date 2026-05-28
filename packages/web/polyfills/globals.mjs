/**
 * Meta package — `@gjsify/web-polyfills` is a dep-only umbrella that pulls
 * in every Web polyfill. It has no own value exports, so the `browser`
 * slot's `globals.mjs` re-export is intentionally empty. Present only to
 * silence the resolver's "missing globals.mjs" warn-once when --app browser
 * bundles happen to mention the bare specifier.
 */
export {};
